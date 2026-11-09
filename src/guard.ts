// Защита от SSRF: инструмент ходит только на публичные адреса в интернете.
// Чужой сайт не должен заставить его обращаться к localhost, домашнему роутеру,
// внутренним сервисам компании или облачным метаданным (169.254.169.254).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Адрес из частной, служебной или зарезервированной сети */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
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
    let r: Response;
    try {
      r = await fetch(cur, { redirect: "manual", headers: { "user-agent": o.userAgent, accept: "text/plain,application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(o.timeoutMs) });
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
