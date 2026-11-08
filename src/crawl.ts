import robotsParserMod from "robots-parser";
const robotsParser = robotsParserMod as unknown as (url: string, body: string) => { isAllowed(u: string, ua?: string): boolean | undefined; getSitemaps(): string[] };
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import type { CollectOptions, PageData, SiteRaw } from "./types.js";
import { extractGlobals, extractPage, extractPerf, extractVisual, mobileOverflow, PERF_INIT } from "./extract.js";

/** Служебные страницы: вход, корзина, личный кабинет — их не оцениваем */
export const SKIP_PATH = /\/(login|logout|signin|sign-in|signup|sign-up|register|registration|auth|oauth|account|cabinet|lk|profile|cart|basket|korzina|checkout|order\/|wishlist|compare|search|cms\/system|wp-admin|wp-login|bitrix\/admin)(\/|\?|$|\.)/i;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|avi|ico|xml|json|txt)(\?|$)/i;

export function normalizeUrl(u: string): string {
  const url = new URL(u);
  url.hash = "";
  for (const p of [...url.searchParams.keys()]) if (/^(utm_|yclid|gclid|fbclid|from|ref|_openstat|erid)/i.test(p)) url.searchParams.delete(p);
  let s = url.toString();
  if (s.endsWith("/") && url.pathname !== "/") s = s.slice(0, -1);
  return s;
}

async function fetchText(ctx: BrowserContext, url: string, timeout: number): Promise<{ status: number; text: string }> {
  try {
    const r = await ctx.request.get(url, { timeout, failOnStatusCode: false, maxRedirects: 5 });
    return { status: r.status(), text: r.ok() ? await r.text() : "" };
  } catch {
    return { status: 0, text: "" };
  }
}

export async function crawl(browser: Browser, startUrl: string, opt: CollectOptions): Promise<SiteRaw> {
  const start = normalizeUrl(startUrl.includes("://") ? startUrl : "https://" + startUrl);
  let origin = new URL(start).origin;
  const ctx = await browser.newContext({ userAgent: opt.userAgent, viewport: { width: 1440, height: 900 }, locale: "ru-RU", ignoreHTTPSErrors: true });
  ctx.setDefaultTimeout(opt.timeoutMs);
  await ctx.addInitScript(PERF_INIT);

  // robots.txt и sitemap
  const robotsRes = await fetchText(ctx, origin + "/robots.txt", opt.timeoutMs);
  const robots = robotsParser(origin + "/robots.txt", robotsRes.text);
  const allowed = (u: string) => opt.ignoreRobots || robots.isAllowed(u, "site-audit-ru") !== false;
  const sitemaps = robots.getSitemaps().map((s) => { try { return new URL(s, origin).toString(); } catch { return s; } });
  const sitemapUrl = sitemaps[0] ?? origin + "/sitemap.xml";
  const sm = await fetchText(ctx, sitemapUrl, opt.timeoutMs);
  let smText = sm.text;
  if (/<sitemapindex/i.test(smText)) {
    // индекс sitemap — берём первый вложенный файл
    const child = smText.match(/<loc>\s*([^<\s]+)\s*<\/loc>/);
    smText = child ? (await fetchText(ctx, new URL(child[1], origin).toString(), opt.timeoutMs)).text : "";
  }
  const sitemapLocs = smText ? Array.from(smText.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).flatMap((m) => { try { return [new URL(m[1], origin).toString()]; } catch { return []; } }) : [];

  const raw: SiteRaw = {
    startUrl: start,
    origin,
    https: origin.startsWith("https:"),
    robotsTxt: { found: robotsRes.status === 200 && robotsRes.text.length > 0, sitemaps, disallowedStart: !robots.isAllowed(start, "Yandex") && robotsRes.text.length > 0 },
    sitemap: { found: sitemapLocs.length > 0, url: sitemapLocs.length ? sitemapUrl : null, urls: sitemapLocs.length },
    pages: [],
    requestHosts: [],
    cookiesOnLoad: [],
    globals: [],
    html: "",
    visual: { colors: [], fonts: [], fontSizes: [], textPairs: [], radii: [], maxContentWidth: 0, screenshots: {} },
    skipped: [],
    limited: null,
  };
  const done = new Set<string>();

  const hosts = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
  const seen = new Set([start]);
  // Из sitemap добавляем верхние страницы, чтобы покрыть разделы, до которых нет ссылок
  for (const u of sitemapLocs.slice(0, 200)) {
    try {
      const n = normalizeUrl(u);
      if (n.startsWith(origin) && !seen.has(n) && !SKIP_PATH.test(new URL(n).pathname + "/") && !new URL(n).search) {
        seen.add(n);
        queue.push({ url: n, depth: 9 });
      }
    } catch {
      /* мусор в sitemap */
    }
  }
  const sitemapOnly = new Set(queue.filter((q) => q.depth === 9).map((q) => q.url));

  if (opt.screenshots) mkdirSync(opt.outDir, { recursive: true });
  const slug = new URL(start).host.replace(/[^a-z0-9.-]/gi, "_");

  while (queue.length && raw.pages.length < opt.maxPages) {
    // сначала ссылки по глубине, страницы только из sitemap — в конце
    queue.sort((a, b) => a.depth - b.depth);
    const { url, depth } = queue.shift()!;
    if (!allowed(url)) {
      raw.skipped.push({ url, reason: "robots.txt" });
      continue;
    }
    const page = await ctx.newPage();
    let transfer = 0;
    let requests = 0;
    page.on("request", (r) => {
      requests++;
      try {
        hosts.add(new URL(r.url()).hostname);
      } catch {
        /* data: и т.п. */
      }
    });
    page.on("response", async (r) => {
      const len = Number(r.headers()["content-length"] ?? 0);
      transfer += Number.isFinite(len) ? len : 0;
    });
    try {
      let lastNav = Date.now();
      page.on("framenavigated", (fr) => {
        if (fr === page.mainFrame()) lastNav = Date.now();
      });
      // сайт может перенаправить скриптом прямо во время сбора — ждём и пробуем ещё раз (до 3 раз)
      const ev = async <T>(fn: () => T): Promise<T> => {
        for (let i = 0; ; i++) {
          try {
            return await page.evaluate(fn);
          } catch (e) {
            if (i >= 2 || !/context was destroyed|navigation/i.test(String(e))) throw e;
            await page.waitForLoadState("load").catch(() => {});
            await page.waitForTimeout(2000);
          }
        }
      };
      const resp = await page.goto(url, { waitUntil: "load", timeout: opt.timeoutMs });
      // ждём, пока страница перестанет перезагружаться (JS-проверки защиты от ботов), максимум 12 с
      const t0 = Date.now();
      await page.waitForTimeout(1200);
      while (Date.now() - lastNav < 2000 && Date.now() - t0 < 12_000) await page.waitForTimeout(500);
      await page.waitForLoadState("load").catch(() => {});
      const finalUrl = normalizeUrl(page.url());
      if (!finalUrl.startsWith(origin) && raw.pages.length > 0) {
        raw.skipped.push({ url, reason: "редирект на другой домен: " + finalUrl });
        continue;
      }
      if (done.has(finalUrl)) continue; // та же страница после редиректа
      if (raw.pages.length > 0 && SKIP_PATH.test(new URL(finalUrl).pathname + "/")) {
        raw.skipped.push({ url, reason: "служебная страница (вход, корзина, кабинет)" });
        continue;
      }
      done.add(finalUrl);
      if (raw.pages.length === 0) {
        // главная: прокручиваем, чтобы догрузились ленивые скрипты и картинки
        await ev(async () => {
          for (let y = 0; y < Math.min(document.body.scrollHeight, 6000); y += 700) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 150));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(2000);
      }
      const data = await ev(extractPage);
      const perf = await ev(extractPerf);
      const pd: PageData = { url: finalUrl, status: resp?.status() ?? 0, depth: sitemapOnly.has(url) ? -1 : depth, ...data, perf: { ...perf, transferBytes: transfer, requests } };

      if (raw.pages.length === 0) {
        raw.cookiesOnLoad = (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, thirdParty: !new URL(origin).hostname.endsWith(c.domain.replace(/^\./, "")) }));
        raw.globals = await page.evaluate(extractGlobals);
        raw.html = (await page.content()).slice(0, 400_000);
        raw.visual = { ...(await page.evaluate(extractVisual)), screenshots: {} };
        if (opt.screenshots) {
          const d = join(opt.outDir, `${slug}-desktop.png`);
          await page.screenshot({ path: d, fullPage: false });
          raw.visual.screenshots.desktop = d;
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(400);
        pd.horizontalOverflowMobile = await page.evaluate(mobileOverflow);
        if (opt.screenshots) {
          const m = join(opt.outDir, `${slug}-mobile.png`);
          await page.screenshot({ path: m, fullPage: false });
          raw.visual.screenshots.mobile = m;
        }
      }
      if (raw.pages.length === 0 && !finalUrl.startsWith(origin)) {
        // главная редиректит на другой хост (например, www) — продолжаем обход на нём
        origin = new URL(finalUrl).origin;
        raw.origin = origin;
        raw.https = origin.startsWith("https:");
      }
      if (raw.pages.length === 0 && data.wordCount < 30 && data.internalLinks.length < 3) raw.limited = "bot-protection";
      raw.pages.push(pd);
      for (const l of data.internalLinks) {
        try {
          const n = normalizeUrl(l.href);
          if (!n.startsWith(origin) || SKIP_EXT.test(n) || SKIP_PATH.test(new URL(n).pathname + "/") || seen.has(n)) continue;
          if (new URL(n).search && !/^\?(page|p)=\d+$/.test(new URL(n).search)) continue; // фильтры, сортировки, модальные окна
          seen.add(n);
          queue.push({ url: n, depth: depth + 1 });
        } catch {
          /* битая ссылка */
        }
      }
      // ссылка нашлась — страница больше не «только из sitemap»
      for (const q of queue) if (sitemapOnly.has(q.url) && data.internalLinks.some((l) => normalizeUrl(l.href) === q.url)) {
        q.depth = depth + 1;
        sitemapOnly.delete(q.url);
      }
    } catch (e) {
      raw.skipped.push({ url, reason: String((e as Error).message).split("\n")[0].slice(0, 160) });
    } finally {
      await page.close();
    }
  }
  if (!raw.pages.length) raw.limited = "unreachable";
  raw.requestHosts = [...hosts].sort();
  await ctx.close();
  return raw;
}
