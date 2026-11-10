import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { fetch as ufetch } from "undici";
import { guardedAgent, guardedLookup, startEgressProxy } from "../src/egress.js";

type Addr = { address: string; family: number };
const fixed = (map: Record<string, string[]>) => (host: string, cb: (e: NodeJS.ErrnoException | null, a: Addr[]) => void) =>
  cb(null, (map[host] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

const look = (allow: boolean, host: string, resolver?: Parameters<typeof guardedLookup>[1]) =>
  new Promise<string>((res, rej) => guardedLookup(allow, resolver)(host, {}, (e, a) => (e ? rej(e) : res(a as string))));

/** CONNECT через прокси; возвращает строку статуса */
const tunnel = (proxyUrl: string, target: string) =>
  new Promise<string>((res, rej) => {
    const u = new URL(proxyUrl);
    const s = connect(Number(u.port), u.hostname, () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.once("data", (d) => { res(d.toString().split("\r\n")[0]); s.destroy(); });
    s.on("error", rej);
  });

/** Обычный http-запрос через прокси */
const viaProxy = (proxyUrl: string, target: string) =>
  new Promise<number>((res, rej) => {
    const u = new URL(proxyUrl);
    const r = request({ host: u.hostname, port: u.port, path: target, headers: { host: new URL(target).host } }, (m) => { m.resume(); res(m.statusCode ?? 0); });
    r.on("error", rej);
    r.end();
  });

let site: Server;
let port = 0;
beforeAll(async () => {
  site = createServer((_q, r) => r.end("ok"));
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  port = (site.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => site.close(() => r())));

describe("DNS rebinding: проверка в момент соединения", () => {
  it("имя, ведущее на 127.0.0.1, блокируется", async () => {
    await expect(look(false, "evil.test", fixed({ "evil.test": ["127.0.0.1"] }))).rejects.toThrow(/локальную сеть/);
  });
  it("смесь публичного и локального адреса блокируется целиком", async () => {
    await expect(look(false, "mix.test", fixed({ "mix.test": ["93.184.216.34", "192.168.1.1"] }))).rejects.toThrow(/локальную сеть/);
  });
  it("служебные адреса и имена: 169.254.169.254, ::1, ::ffff:10.0.0.1, *.localhost", async () => {
    for (const h of ["169.254.169.254", "::1", "::ffff:10.0.0.1", "admin.localhost", "nas.local"]) await expect(look(false, h)).rejects.toThrow(/локальную сеть/);
  });
  it("публичный адрес проходит; с --allow-private проходит и локальный", async () => {
    await expect(look(false, "ok.test", fixed({ "ok.test": ["93.184.216.34"] }))).resolves.toBe("93.184.216.34");
    await expect(look(true, "lan.test", fixed({ "lan.test": ["192.168.1.10"] }))).resolves.toBe("192.168.1.10");
  });
  it("имя, которое не резолвится, — ошибка, а не пропуск", async () => {
    await expect(look(false, "none.test", fixed({}))).rejects.toThrow(/Не удалось найти/);
  });
});

describe("Прокси браузера", () => {
  it("CONNECT на имя, перерезолвленное в 127.0.0.1, — 403", async () => {
    const p = await startEgressProxy({ allowPrivate: false, resolver: fixed({ "rebind.test": ["127.0.0.1"] }) });
    try {
      expect(await tunnel(p.url, `rebind.test:${port}`)).toMatch(/403/);
      expect(await tunnel(p.url, `127.0.0.1:${port}`)).toMatch(/403/);
      expect(await tunnel(p.url, `[::1]:${port}`)).toMatch(/403/);
      expect(await viaProxy(p.url, `http://rebind.test:${port}/`)).toBe(403);
    } finally { await p.close(); }
  });
  it("решение принимается при каждом соединении: «сначала публичный, потом локальный» не проходит", async () => {
    let n = 0;
    const flip = (_h: string, cb: (e: null, a: Addr[]) => void) => cb(null, [{ address: n++ === 0 ? "93.184.216.34" : "127.0.0.1", family: 4 }]);
    const p = await startEgressProxy({ allowPrivate: false, resolver: flip });
    try {
      // предварительная проверка видит публичный адрес…
      await expect(look(false, "flip.test", flip)).resolves.toBe("93.184.216.34");
      // …а в момент соединения имя уже ведёт на 127.0.0.1 — соединение не устанавливается
      expect(await tunnel(p.url, `flip.test:${port}`)).toMatch(/403/);
    } finally { await p.close(); }
  });
  it("с --allow-private туннель до внутреннего сайта работает", async () => {
    const p = await startEgressProxy({ allowPrivate: true, resolver: fixed({ "intranet.test": ["127.0.0.1"] }) });
    try {
      expect(await tunnel(p.url, `intranet.test:${port}`)).toMatch(/200/);
      expect(await viaProxy(p.url, `http://intranet.test:${port}/`)).toBe(200);
    } finally { await p.close(); }
  });
  it("мусор вместо адреса — 400, прокси не падает", async () => {
    const p = await startEgressProxy({ allowPrivate: false });
    try {
      expect(await tunnel(p.url, "::::")).toMatch(/400/);
      expect(await tunnel(p.url, "host:99999")).toMatch(/400/);
      expect(await viaProxy(p.url, "file:///etc/passwd")).toBe(400);
    } finally { await p.close(); }
  });
  it("прокси слушает только 127.0.0.1", async () => {
    const p = await startEgressProxy({ allowPrivate: false });
    try { expect(new URL(p.url).hostname).toBe("127.0.0.1"); } finally { await p.close(); }
  });
});

describe("Запросы Node (robots, sitemap, webhook)", () => {
  it("соединение на локальный адрес обрывается даже без предварительной проверки", async () => {
    await expect(ufetch(`http://127.0.0.1:${port}/`, { dispatcher: guardedAgent(false) })).rejects.toThrow();
  });
  it("с --allow-private — проходит", async () => {
    const r = await ufetch(`http://127.0.0.1:${port}/`, { dispatcher: guardedAgent(true) });
    expect(await r.text()).toBe("ok");
  });
});
