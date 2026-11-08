import type { Browser } from "playwright-core";
import { launchBrowser } from "./browser.js";
import { crawl } from "./crawl.js";
import { analyzeSeo } from "./analyzers/seo.js";
import { analyzeStructure } from "./analyzers/structure.js";
import { analyzeVisual } from "./analyzers/visual.js";
import { analyzeTech } from "./analyzers/tech.js";
import { analyzeCompliance } from "./analyzers/compliance.js";
import type { CollectOptions, SiteRaw, SiteReport } from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULTS: CollectOptions = {
  maxPages: 30,
  outDir: "audit-out",
  timeoutMs: 30_000,
  screenshots: true,
  userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 site-audit-ru/${VERSION} (+https://github.com/kozhevnikovai/site-audit-ru)`,
  ignoreRobots: false,
};

/** Веса блоков в общей оценке */
const WEIGHTS = { seo: 0.3, structure: 0.25, visual: 0.1, tech: 0.1, compliance: 0.25 } as const;

function emptyRaw(url: string, reason: string): SiteRaw {
  const u = url.includes("://") ? url : "https://" + url;
  return {
    startUrl: u, origin: new URL(u).origin, https: u.startsWith("https:"),
    robotsTxt: { found: false, sitemaps: [], disallowedStart: false }, sitemap: { found: false, url: null, urls: 0 },
    pages: [], requestHosts: [], cookiesOnLoad: [], globals: [], html: "",
    visual: { colors: [], fonts: [], fontSizes: [], textPairs: [], radii: [], maxContentWidth: 0, screenshots: {} },
    skipped: [{ url: u, reason }], limited: "unreachable",
  };
}

export function analyze(raw: SiteRaw): SiteReport {
  const blocks = {
    seo: analyzeSeo(raw),
    structure: analyzeStructure(raw),
    visual: analyzeVisual(raw),
    tech: analyzeTech(raw),
    compliance: analyzeCompliance(raw),
  };
  const total = Math.round(Object.entries(WEIGHTS).reduce((a, [k, w]) => a + blocks[k as keyof typeof blocks].score * w, 0));
  return {
    tool: { name: "site-audit-ru", version: VERSION },
    collectedAt: new Date().toISOString(),
    url: raw.startUrl,
    pagesCrawled: raw.pages.length,
    limited: raw.limited,
    skipped: raw.skipped,
    blocks,
    total: raw.limited === "unreachable" ? null : total,
  };
}

export async function collectSites(urls: string[], options: Partial<CollectOptions> = {}, onProgress?: (msg: string) => void): Promise<{ reports: SiteReport[]; raws: SiteRaw[] }> {
  const opt = { ...DEFAULTS, ...options };
  const browser: Browser = await launchBrowser(opt.chromePath);
  const reports: SiteReport[] = [];
  const raws: SiteRaw[] = [];
  try {
    for (const url of urls) {
      onProgress?.(`→ ${url}`);
      let raw: SiteRaw;
      try {
        raw = await crawl(browser, url, opt);
      } catch (e) {
        // сбой одного сайта не должен ронять весь прогон
        raw = emptyRaw(url, String((e as Error).message ?? e).split("\n")[0]);
      }
      raws.push(raw);
      const rep = analyze(raw);
      reports.push(rep);
      if (raw.limited === "unreachable") onProgress?.(`  не удалось открыть: ${raw.skipped[0]?.reason ?? "нет ответа"}`);
      else onProgress?.(`  ${raw.pages.length} стр., оценка ${rep.total}/100${raw.limited === "bot-protection" ? " (сайт отдал заглушку защиты от ботов — данные неполные)" : ""}`);
    }
  } finally {
    await browser.close();
  }
  return { reports, raws };
}
