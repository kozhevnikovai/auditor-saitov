import robotsParserMod from "robots-parser";
const robotsParser = robotsParserMod as unknown as (url: string, body: string) => { isAllowed(u: string, ua?: string): boolean | undefined; getSitemaps(): string[] };
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import type { CollectOptions, PageData, SiteRaw } from "./types.js";
import { extractGlobals, extractPage, extractPerf, extractVisual, mobileOverflow, PERF_INIT } from "./extract.js";

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
  const origin = new URL(start).origin;
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
  const sitemapLocs = sm.text ? Array.from(sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).flatMap((m) => { try { return [new URL(m[1], origin).toString()]; } catch { return []; } }) : [];

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
    visual: { colors: [], fonts: [], fontSizes: [], radii: [], maxContentWidth: 0, screenshots: {} },
    skipped: [],
  };

  const hosts = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
  const seen = new Set([start]);
  // Из sitemap добавляем верхние страницы, чтобы покрыть разделы, до которых нет ссылок
  for (const u of sitemapLocs.slice(0, 200)) {
    try {
      const n = normalizeUrl(u);
      if (n.startsWith(origin) && !seen.has(n)) {
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
      const resp = await page.goto(url, { waitUntil: "load", timeout: opt.timeoutMs });
      await page.waitForTimeout(1200);
      const finalUrl = normalizeUrl(page.url());
      if (!finalUrl.startsWith(origin)) {
        raw.skipped.push({ url, reason: "редирект на другой домен: " + finalUrl });
        continue;
      }
      const data = await page.evaluate(extractPage);
      const perf = await page.evaluate(extractPerf);
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
      raw.pages.push(pd);
      for (const l of data.internalLinks) {
        try {
          const n = normalizeUrl(l.href);
          if (!n.startsWith(origin) || SKIP_EXT.test(n) || seen.has(n)) continue;
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
  raw.requestHosts = [...hosts].sort();
  await ctx.close();
  return raw;
}
