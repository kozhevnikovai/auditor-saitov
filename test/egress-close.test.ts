import { describe, expect, it } from "vitest";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { startEgressProxy } from "../src/egress.js";

describe("прокси проверки", () => {
  it("при закрытии обрывает открытые туннели к сайту — процесс не зависает", async () => {
    const held: Socket[] = [];
    const site = createServer((s) => held.push(s));
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
    const port = (site.address() as AddressInfo).port;
    const proxy = await startEgressProxy({ allowPrivate: true });
    const u = new URL(proxy.url);
    const client = connect(Number(u.port), u.hostname, () => client.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\n`));
    await new Promise((r) => client.once("data", r));
    expect(held.length).toBe(1);
    const closed = new Promise((r) => held[0].once("close", r));
    await proxy.close();
    await closed; // соединение к сайту закрыто вместе с прокси
    client.destroy();
    await new Promise<void>((r) => site.close(() => r()));
  });
});
