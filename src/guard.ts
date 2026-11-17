// Защита от SSRF: инструмент ходит только на публичные адреса в интернете.
// Чужой сайт не должен заставить его обращаться к localhost, домашнему роутеру,
// внутренним сервисам компании или облачным метаданным (169.254.169.254).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fetch as ufetch } from "undici";
import { guardedAgent } from "./egress.js";

function privateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

/** IPv6 в 8 групп по 16 бит; любая запись: сокращённая, с IPv4 в конце, с зоной (%eth0). null — не IPv6 */
export function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (isIP(s) !== 6) return null;
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1].split(".").map(Number);
    s = s.slice(0, -tail[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, rest] = s.includes("::") ? s.split("::") : [s, null];
  const h = head ? head.split(":") : [];
  const r = rest ? rest.split(":") : [];
  const fill = rest === null ? [] : Array(8 - h.length - r.length).fill("0");
  const groups = [...h, ...fill, ...r].map(x => parseInt(x, 16));
  return groups.length === 8 && groups.every(g => g >= 0 && g <= 0xffff) ? groups : null;
}

const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** Адрес из частной, служебной или зарезервированной сети. IPv6 разбирается в числа, поэтому эквивалентные записи одного адреса дают одинаковый ответ. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip.replace(/^\[|\]$/g, "").replace(/%.*$/, ""));
  if (v === 4) return privateV4(ip);
  if (v !== 6) return false;
  const g = parseIPv6(ip);
  if (!g) return true; // не смогли разобрать — считаем опасным
  const zero = (from: number, to: number) => g.slice(from, to).every(x => x === 0);
  if (zero(0, 8)) return true; // ::
  if (zero(0, 7) && g[7] === 1) return true; // ::1
  // IPv4 внутри IPv6: ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), ::ffff:0:a.b.c.d (translated) — проверяем сам IPv4
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return privateV4(v4of(g[6], g[7]));
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return privateV4(v4of(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 и 64:ff9b:1::/48
  if (g[0] === 0x2002) return privateV4(v4of(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // документация
  if (g[0] === 0x100 && zero(1, 4)) return true; // discard 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 — частные
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export class BlockedError extends Error {}

const cache = new Map<string, Promise<boolean>>();
/** true — хост ведёт только на публичные адреса */
export function isPublicHost(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!cache.has(h)) {
    cache.set(h, (async () => {
      if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return false;
      if (isIP(h)) return !isPrivateIp(h);
      try {
        const all = await lookup(h, { all: true, verbatim: true });
        return all.length > 0 && all.every((a) => !isPrivateIp(a.address));
      } catch {
        return true; // не резолвится — запрос всё равно не пройдёт; не путаем с блокировкой
      }
    })());
  }
  return cache.get(h)!;
}

/** Проверяет адрес перед запросом. allowPrivate — для аудита внутренних сайтов (флаг --allow-private). */
export async function assertPublicUrl(url: string, allowPrivate = process.env.SITE_AUDIT_ALLOW_PRIVATE === "1"): Promise<URL> {
  let u: URL;
  try { u = new URL(url); } catch { throw new BlockedError(`Некорректный адрес: ${url}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedError(`Разрешены только http и https: ${url}`);
  if (u.username || u.password) throw new BlockedError("Адреса с логином и паролем не поддерживаются");
  if (!allowPrivate && !(await isPublicHost(u.hostname))) throw new BlockedError(`Адрес ${u.hostname} ведёт в локальную или служебную сеть — запрос заблокирован. Для аудита внутреннего сайта добавьте --allow-private`);
  return u;
}

/** Тот же сайт: совпадает хост без www или это его поддомен */
export function sameSite(a: string, b: string): boolean {
  const h = (x: string) => new URL(x).hostname.toLowerCase().replace(/^www\./, "");
  const x = h(a), y = h(b);
  return x === y || x.endsWith("." + y) || y.endsWith("." + x);
}

export const LIMITS = { textBytes: 5 * 1024 * 1024, sitemapUrls: 50_000, redirects: 5 };

/**
 * GET текста (robots.txt, sitemap) с ручными редиректами — каждый шаг проверяется,
 * и с ограничением размера: «бомба» на гигабайт не съест память.
 */
export async function safeGetText(url: string, o: { timeoutMs: number; userAgent: string; allowPrivate?: boolean; maxBytes?: number }): Promise<{ status: number; text: string; url: string }> {
  let cur = url;
  for (let i = 0; i <= LIMITS.redirects; i++) {
    try { await assertPublicUrl(cur, o.allowPrivate); } catch { return { status: 0, text: "", url: cur }; }
    let r: Awaited<ReturnType<typeof ufetch>>;
    try {
      // адрес проверяется ещё раз в момент соединения (защита от DNS rebinding)
      r = await ufetch(cur, { dispatcher: guardedAgent(!!o.allowPrivate || process.env.SITE_AUDIT_ALLOW_PRIVATE === "1"), redirect: "manual", headers: { "user-agent": o.userAgent, accept: "text/plain,application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(o.timeoutMs) });
    } catch {
      return { status: 0, text: "", url: cur };
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      cur = new URL(r.headers.get("location")!, cur).toString();
      await r.body?.cancel().catch(() => {});
      continue;
    }
    if (!r.ok || !r.body) { await r.body?.cancel().catch(() => {}); return { status: r.status, text: "", url: cur }; }
    const max = o.maxBytes ?? LIMITS.textBytes;
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { await reader.cancel().catch(() => {}); break; }
      parts.push(value);
    }
    return { status: r.status, text: Buffer.concat(parts).toString("utf8"), url: cur };
  }
  return { status: 0, text: "", url: cur };
}
