import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir, tmpdir } from "node:os";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { collectSites } from "./collect.js";
import { aiContext, expertPrompt } from "./ai.js";
import { BLOCK_KEYS, hostOf } from "./report/insights.js";
import { renderMarkdown } from "./report/md.js";
import { loadReports, parseFormats, writeOutputs, writePdf } from "./output.js";
import { localStamp, VERSION } from "./version.js";

const BLOCK = z.enum(["seo", "structure", "visual", "tech", "compliance"]);

/** Папка отчётов из MCP — только внутри домашней папки пользователя (не системные каталоги) */
export function safeOutDir(dir?: string): string | undefined {
  if (!dir) return undefined;
  const abs = resolve(dir);
  const inside = (root: string) => { const rel = relative(resolve(root), abs); return !!rel && !rel.startsWith("..") && !isAbsolute(rel); };
  if (!inside(homedir()) && !inside(tmpdir())) throw new Error("Папка для отчётов должна быть внутри домашней папки пользователя");
  return abs;
}
/** Читаем только audit.json — модель не должна открывать через инструмент произвольные файлы */
export function safeReportPath(p: string): string {
  const abs = resolve(p);
  if (basename(abs) !== "audit.json" || !existsSync(abs) || !statSync(abs).isFile()) throw new Error("Нужен путь к файлу audit.json из результата audit_sites");
  return abs;
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "site-audit-ru", version: VERSION });

  server.registerTool(
    "audit_sites",
    {
      title: "Аудит сайтов и конкурентов",
      description:
        "Проверяет 1–5 сайтов: SEO и скорость, структура и конверсия, визуальный стиль, технологии, соответствие законам РФ (152-ФЗ, cookie, реквизиты). Первый адрес — сайт пользователя, остальные — конкуренты. Сохраняет отчёты (HTML, Markdown, CSV, JSON) и возвращает сводку с оценками, главными проблемами и сравнением. Проверка занимает 30–120 секунд на сайт. Audits 1–5 websites and competitors.",
      inputSchema: {
        urls: z.array(z.string()).min(1).max(5).describe("Адреса сайтов: свой первым, затем конкуренты"),
        max_pages: z.number().int().min(1).max(50).default(12).describe("Сколько страниц обойти на каждом сайте (по умолчанию 12)"),
        formats: z.string().default("html,md,csv").describe("Форматы отчётов через запятую: html, md, csv, xlsx, json, pdf"),
        out_dir: z.string().optional().describe("Папка для отчётов (по умолчанию ~/site-audit/<дата>-<сайт>)"),
      },
    },
    async ({ urls, max_pages, formats, out_dir }) => {
      const first = hostOf(urls[0].includes("://") ? urls[0] : "https://" + urls[0]);
      const outDir = safeOutDir(out_dir) ?? join(homedir(), "site-audit", `${localStamp()}-${first.replace(/[:\\/]/g, "_")}`);
      const { reports } = await collectSites(urls, { maxPages: max_pages, outDir, timeoutMs: 25_000 });
      const fmts = parseFormats(formats);
      const cruxKey = process.env.SITE_AUDIT_CRUX_KEY;
      if (cruxKey) {
        const { fetchCrux } = await import("./extras/crux.js");
        for (const r of reports) if (r.total !== null) r.field = await fetchCrux(r.url, cruxKey).catch(() => undefined);
      }
      const { files } = writeOutputs(reports, { outDir, formats: fmts });
      if (fmts.includes("pdf")) files.pdf = await writePdf(reports, { outDir, files }).catch(() => "PDF не создан: не найден браузер");
      const summary = renderMarkdown(reports)
        .split(/\n(?=## [^\n]+ — подробно)/)[0]
        .trim();
      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\nОтчёты сохранены:\n${Object.values(files).map((f) => "- " + f).join("\n")}\n\nДля подробностей по блоку вызови get_details с report_path=${files.json}. Интерпретируй результаты по инструкции из промпта site_audit_expert (или используй её как ориентир: эксперты SEO, UX/CRO, арт-директор, техдиректор, юрист 152-ФЗ).`,
          },
        ],
        structuredContent: { reportPath: files.json, files, sites: reports.map((r) => ({ url: r.url, total: r.total, limited: r.limited, scores: Object.fromEntries(BLOCK_KEYS.map((k) => [k, r.blocks[k].score])) })) },
      };
    },
  );

  server.registerTool(
    "get_details",
    {
      title: "Подробности проверки",
      description: "Возвращает все находки и собранные данные (заголовки, меню, формы, палитра, технологии, cookie и т. д.) по сохранённому отчёту audit.json — для глубокого анализа одного блока или сайта.",
      inputSchema: {
        report_path: z.string().describe("Путь к audit.json из результата audit_sites"),
        site: z.string().optional().describe("Домен сайта; по умолчанию все"),
        block: BLOCK.optional().describe("Блок: seo, structure, visual, tech, compliance; по умолчанию все"),
      },
    },
    async ({ report_path, site, block }) => {
      let sites = loadReports(safeReportPath(report_path));
      if (site) sites = sites.filter((s) => hostOf(s.url).includes(site.replace(/^www\./, "")));
      const text = block
        ? JSON.stringify(sites.map((s) => ({ url: s.url, block, ...s.blocks[block] })), null, 1).slice(0, 80_000)
        : aiContext(sites, 80_000);
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "export_pdf",
    {
      title: "Отчёт в PDF",
      description: "Печатает сохранённый отчёт (audit.json из audit_sites) в PDF рядом с ним — для отправки клиенту или руководителю.",
      inputSchema: { report_path: z.string().describe("Путь к audit.json из результата audit_sites") },
    },
    async ({ report_path }) => {
      const path = safeReportPath(report_path);
      const sites = loadReports(path);
      const dir = dirname(path);
      const pdf = await writePdf(sites, { outDir: dir, files: existsSync(join(dir, "report.html")) ? { html: join(dir, "report.html") } : {} });
      return { content: [{ type: "text", text: `PDF: ${pdf}` }] };
    },
  );

  server.registerTool(
    "field_vitals",
    {
      title: "Скорость у реальных посетителей",
      description: "Core Web Vitals реальных посетителей сайта (LCP, INP, CLS, FCP, TTFB, 75-й перцентиль за 28 дней) из Chrome UX Report Google. Нужен бесплатный ключ CrUX API в настройках расширения (SITE_AUDIT_CRUX_KEY); без ключа инструмент сообщит, как его получить.",
      inputSchema: { url: z.string().describe("Адрес сайта"), device: z.enum(["phone", "desktop"]).default("phone") },
    },
    async ({ url, device }) => {
      const key = process.env.SITE_AUDIT_CRUX_KEY;
      if (!key) return { content: [{ type: "text", text: "Ключ CrUX API не задан. Получите бесплатный ключ: Google Cloud Console → APIs & Services → включить «Chrome UX Report API» → Credentials → API key, и укажите его в настройках расширения «Аудитор сайтов»." }] };
      const { fetchCrux, fieldMarkdown } = await import("./extras/crux.js");
      return { content: [{ type: "text", text: fieldMarkdown(await fetchCrux(url, key, device === "desktop" ? "DESKTOP" : "PHONE")) }] };
    },
  );

  server.registerPrompt(
    "site_audit_expert",
    {
      title: "Экспертное заключение по аудиту",
      description: "Инструкция для ИИ: как пять экспертов интерпретируют результаты site-audit-ru",
      argsSchema: { urls: z.string().describe("Адреса сайтов через пробел: свой первым") },
    },
    ({ urls }) => ({
      messages: [{ role: "user", content: { type: "text", text: `${expertPrompt()}\n\nПроверь сайты инструментом audit_sites: ${urls}. Затем дай заключение в указанном формате.` } }],
    }),
  );
  return server;
}

export async function startMcp(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
