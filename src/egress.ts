// Защита от DNS rebinding: адрес сайта проверяется в момент соединения, а не заранее.
// Иначе сайт мог бы сначала ответить «публичным» IP на проверку, а через секунду —
// адресом из локальной сети на сам запрос. Здесь проверенный IP и есть тот, куда идёт соединение:
// - запросы Node (robots.txt, sitemap, webhook) — через Agent с проверяющим lookup;
// - браузер — через локальный прокси, который сам резолвит имя и соединяется с проверенным IP.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { connect as netConnect, isIP, type AddressInfo, type LookupFunction, type Socket } from "node:net";
import { Agent, buildConnector } from "undici";
import { isPrivateIp } from "./guard.js";

type Resolver = (host: string, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void) => void;
const systemResolver: Resolver = (host, cb) => dnsLookup(host, { all: true, verbatim: true }, (e, a) => cb(e, (a as LookupAddress[]) ?? []));

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/i;

export class EgressBlocked extends Error {
  code = "EBLOCKED";
}

/** lookup для net/tls/undici: отдаёт только публичные адреса; хотя бы один служебный — отказ */
export function guardedLookup(allowPrivate: boolean, resolver: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    const host = hostname.replace(/^\[|\]$/g, "");
    const wantAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    const done = (addrs: LookupAddress[]) => {
      if (wantAll) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addrs);
      else callback(null, addrs[0].address, addrs[0].family);
    };
    if (!allowPrivate && BLOCKED_NAMES.test(host)) return callback(new EgressBlocked(`Адрес ${host} ведёт в локальную сеть — запрос заблокирован`), "", 0);
    const v = isIP(host);
    if (v) {
      if (!allowPrivate && isPrivateIp(host)) return callback(new EgressBlocked(`Адрес ${host} ведёт в локальную сеть — запрос заблокирован`), "", 0);
      return done([{ address: host, family: v }]);
    }
    resolver(host, (err, addrs) => {
      if (err) return callback(err, "", 0);
      if (!addrs.length) return callback(Object.assign(new Error(`Не удалось найти адрес ${host}`), { code: "ENOTFOUND" }), "", 0);
      if (!allowPrivate && addrs.some((a) => isPrivateIp(a.address))) return callback(new EgressBlocked(`Адрес ${host} ведёт в локальную сеть — запрос заблокирован`), "", 0);
      done(addrs);
    });
  };
}

/** net.connect не вызывает lookup для IP-адресов в чистом виде — их проверяем отдельно */
export function literalBlocked(host: string, allowPrivate: boolean): boolean {
  if (allowPrivate) return false;
  const h = host.replace(/^\[|\]$/g, "");
  return BLOCKED_NAMES.test(h) || (isIP(h) !== 0 && isPrivateIp(h));
}

const agents = new Map<boolean, Agent>();
/** Dispatcher для undici.fetch с проверкой адреса в момент соединения */
export function guardedAgent(allowPrivate: boolean): Agent {
  if (!agents.has(allowPrivate)) {
    const base = buildConnector({ lookup: guardedLookup(allowPrivate) });
    const connect: buildConnector.connector = (opts, cb) => {
      if (literalBlocked(opts.hostname, allowPrivate)) return cb(new EgressBlocked(`Адрес ${opts.hostname} ведёт в локальную сеть — запрос заблокирован`), null);
      return base(opts, cb);
    };
    agents.set(allowPrivate, new Agent({ connect }));
  }
  return agents.get(allowPrivate)!;
}

export interface EgressProxy {
  url: string;
  close(): Promise<void>;
}

function parseHostPort(s: string, defPort: number): { host: string; port: number } | null {
  const m = s.match(/^\[([^\]]+)\](?::(\d+))?$/) ?? s.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : defPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1], port };
}

/**
 * Локальный прокси для браузера проверки. Слушает только 127.0.0.1 на случайном порту.
 * CONNECT (https, wss) и обычные http-запросы уходят строго на адрес, прошедший проверку.
 */
export async function startEgressProxy(o: { allowPrivate: boolean; resolver?: Resolver }): Promise<EgressProxy> {
  const lookup = guardedLookup(o.allowPrivate, o.resolver);
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    // обычный http через прокси: абсолютный адрес в строке запроса
    let target: URL;
    try { target = new URL(req.url ?? ""); } catch { res.writeHead(400).end(); return; }
    if (target.protocol !== "http:") { res.writeHead(400).end(); return; }
    if (literalBlocked(target.hostname, o.allowPrivate)) { res.writeHead(403).end(); return; }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const up = httpRequest({ host: target.hostname.replace(/^\[|\]$/g, ""), port: target.port || 80, path: target.pathname + target.search, method: req.method, headers, lookup }, (r: IncomingMessage) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { if (!res.headersSent) res.writeHead((e as { code?: string }).code === "EBLOCKED" ? 403 : 502); res.end(); });
    req.pipe(up);
  });
  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    const hp = parseHostPort(req.url ?? "", 443);
    if (!hp) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    if (literalBlocked(hp.host, o.allowPrivate)) { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const up = netConnect({ host: hp.host, port: hp.port, lookup });
    up.setTimeout(30_000, () => up.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    up.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) up.write(head);
      up.setTimeout(0);
      up.pipe(client);
      client.pipe(up);
    });
    up.on("error", (e) => {
      if (client.writable) client.end(`HTTP/1.1 ${(e as { code?: string }).code === "EBLOCKED" ? "403 Forbidden" : "502 Bad Gateway"}\r\n\r\n`);
      else client.destroy();
    });
    client.on("error", () => up.destroy());
  });
  server.on("connection", (s: Socket) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}
