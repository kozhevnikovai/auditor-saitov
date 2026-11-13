import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SiteReport } from "./types.js";
import { renderHtml } from "./report/html.js";
import { renderMarkdown } from "./report/md.js";
import { renderCsv, renderSummaryCsv } from "./report/csv.js";
import { renderXlsx } from "./report/xlsx.js";
import { diffReports, type Diff } from "./report/insights.js";

export const FORMATS = ["html", "md", "csv", "xlsx", "json", "pdf"] as const;
export type Format = (typeof FORMATS)[number];

export function parseFormats(s: string): Format[] {
  const list = s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((x) => !(FORMATS as readonly string[]).includes(x));
  if (bad.length) throw new Error(`Неизвестный формат: ${bad.join(", ")}. Доступно: ${FORMATS.join(", ")}`);
  return list as Format[];
}

export function loadReports(path: string): SiteReport[] {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const sites = Array.isArray(j) ? j : j.sites;
  if (!Array.isArray(sites)) throw new Error(`В ${path} нет результатов site-audit-ru`);
  return sites as SiteReport[];
}

export interface WriteOptions {
  outDir: string;
  formats: Format[];
  baseline?: string;
  ai?: string;
}

export function writeOutputs(sites: SiteReport[], o: WriteOptions): { files: Record<string, string>; diffs: Diff[] } {
  mkdirSync(o.outDir, { recursive: true });
  const diffs = o.baseline && existsSync(o.baseline) ? diffReports(loadReports(o.baseline), sites) : [];
  const files: Record<string, string> = {};
  const put = (name: string, content: string | Buffer) => {
    const p = resolve(join(o.outDir, name));
    writeFileSync(p, content);
    return p;
  };
  // JSON сохраняется всегда: он нужен для сравнения в следующий раз (--baseline) и команды report
  files.json = put("audit.json", JSON.stringify({ sites, diffs, ai: o.ai ?? null }, null, 2));
  if (o.formats.includes("html")) files.html = put("report.html", renderHtml({ sites, diffs, ai: o.ai }));
  if (o.formats.includes("md")) files.md = put("report.md", renderMarkdown(sites, diffs, o.ai));
  if (o.formats.includes("csv")) {
    files.csv = put("findings.csv", renderCsv(sites));
    files.summaryCsv = put("summary.csv", renderSummaryCsv(sites));
  }
  if (o.formats.includes("xlsx")) files.xlsx = put("report.xlsx", renderXlsx(sites));
  return { files, diffs };
}

/** PDF печатается из HTML-отчёта установленным браузером (асинхронно, после остальных форматов) */
export async function writePdf(sites: SiteReport[], o: { outDir: string; files: Record<string, string>; ai?: string; chromePath?: string }): Promise<string> {
  const { htmlToPdf } = await import("./extras/pdf.js");
  const html = o.files.html ?? resolve(join(o.outDir, "report.html"));
  if (!o.files.html) writeFileSync(html, renderHtml({ sites, diffs: [], ai: o.ai }));
  return htmlToPdf(html, resolve(join(o.outDir, "report.pdf")), o.chromePath);
}
