export type Level = "ok" | "warn" | "fail" | "info";

export interface Finding {
  id: string;
  level: Level;
  /** Короткое описание на русском */
  message: string;
  /** Подтверждение: адреса страниц, значения */
  evidence?: string[];
}

export interface BlockResult {
  /** 0–100, считается только по ok/warn/fail */
  score: number;
  findings: Finding[];
  /** Сырые данные блока для экспертов-ИИ */
  data: Record<string, unknown>;
}

export interface FormInfo {
  action: string;
  fields: { type: string; name: string; required: boolean }[];
  personalFields: boolean;
  consentText: boolean;
  consentCheckbox: boolean;
  consentPrechecked: boolean;
  policyLink: boolean;
  submitText: string;
}

export interface PageData {
  url: string;
  status: number;
  depth: number;
  title: string;
  metaDescription: string;
  metaRobots: string;
  canonical: string;
  lang: string;
  viewport: string;
  h1: string[];
  headings: { level: number; text: string }[];
  og: Record<string, string>;
  jsonLdTypes: string[];
  microdata: boolean;
  images: { total: number; noAlt: number };
  internalLinks: { href: string; text: string }[];
  externalLinks: { href: string; text: string }[];
  navLinks: { href: string; text: string }[];
  forms: FormInfo[];
  ctas: { text: string; top: number }[];
  contacts: { phones: string[]; emails: string[]; messengers: string[]; phoneInHeader: boolean };
  scripts: string[];
  iframes: string[];
  bodyText: string;
  footerText: string;
  wordCount: number;
  cookieBanner: boolean;
  eridLinks: string[];
  horizontalOverflowMobile?: boolean;
  perf?: PerfData;
}

export interface PerfData {
  ttfbMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  lcpMs: number | null;
  cls: number | null;
  transferBytes: number;
  requests: number;
}

export interface VisualData {
  colors: { value: string; count: number; role: "text" | "background" | "border" }[];
  fonts: { family: string; count: number }[];
  fontSizes: { px: number; count: number }[];
  textPairs: { color: string; background: string; count: number }[];
  radii: { value: string; count: number }[];
  maxContentWidth: number;
  screenshots: { desktop?: string; mobile?: string };
}

export interface SiteRaw {
  startUrl: string;
  origin: string;
  https: boolean;
  robotsTxt: { found: boolean; sitemaps: string[]; disallowedStart: boolean };
  sitemap: { found: boolean; url: string | null; urls: number };
  pages: PageData[];
  requestHosts: string[];
  cookiesOnLoad: { name: string; domain: string; thirdParty: boolean }[];
  globals: string[];
  html: string;
  visual: VisualData;
  skipped: { url: string; reason: string }[];
  /** Сайт не открылся или отдал заглушку защиты от ботов */
  limited: null | "unreachable" | "bot-protection";
}

export interface SiteReport {
  tool: { name: "site-audit-ru"; version: string };
  collectedAt: string;
  url: string;
  pagesCrawled: number;
  /** null — данные полные; иначе причина, почему оценки неполные */
  limited: SiteRaw["limited"];
  skipped: SiteRaw["skipped"];
  blocks: {
    seo: BlockResult;
    structure: BlockResult;
    visual: BlockResult;
    tech: BlockResult;
    compliance: BlockResult;
  };
  /** null, если сайт не удалось проверить */
  total: number | null;
}

export interface CollectOptions {
  maxPages: number;
  outDir: string;
  timeoutMs: number;
  screenshots: boolean;
  userAgent: string;
  ignoreRobots: boolean;
  chromePath?: string;
  /** Разрешить локальные и внутренние адреса (аудит сайта в локальной сети) */
  allowPrivate?: boolean;
}
