import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { collectSites } from "../src/collect.js";
import { writeOutputs } from "../src/output.js";
import { diffReports, competitorGaps, topActions } from "../src/report/insights.js";
import { renderCsv } from "../src/report/csv.js";
import { webhookPayload, sendWebhook } from "../src/report/webhook.js";
import { aiReview, resolveAi, expertPrompt } from "../src/ai.js";
import type { SiteReport } from "../src/types.js";
import { serve } from "./server.js";

const fx = (n: string) => join(import.meta.dirname, "fixtures", n);
const tmp = () => mkdtempSync(join(tmpdir(), "sa-out-"));
let good: SiteReport, bad: SiteReport, goodUrl: string, badUrl: string;
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const g = await serve(fx("good"));
  const b = await serve(fx("bad"));
  closers.push(g.close, b.close);
  goodUrl = g.url;
  badUrl = b.url;
  const { reports } = await collectSites([b.url, g.url], { outDir: tmp(), timeoutMs: 10_000 });
  [bad, good] = reports;
}, 120_000);
afterAll(async () => Promise.all(closers.map((c) => c())));

describe("отчёты", () => {
  it("пишет HTML, Markdown, CSV и JSON", () => {
    const dir = tmp();
    const { files } = writeOutputs([bad, good], { outDir: dir, formats: ["html", "md", "csv"] });
    for (const k of ["html", "md", "csv", "summaryCsv", "json"]) expect(existsSync(files[k]), k).toBe(true);
    const html = readFileSync(files.html, "utf8");
    expect(html).toContain("Сравнение сайтов");
    expect(html).toContain("Где конкуренты сильнее");
    expect(html).toContain("data:image/jpeg;base64"); // скриншоты встроены
    expect(html).toContain("font/woff2"); // шрифты встроены, без внешних запросов
    expect(html).not.toMatch(/fonts\.googleapis|<script src/);
    expect(html).toContain("Три главные проблемы");
    expect(html).toContain("Скачать HTML");
    const md = readFileSync(files.md, "utf8");
    expect(md).toContain("| **Итог** |");
    expect(md).toContain("Что сделать в первую очередь");
  });
  it("CSV открывается в русском Excel: BOM и точка с запятой", () => {
    const csv = renderCsv([bad]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")[0]).toBe("Сайт;Блок;Оценка блока;Уровень;Код;Находка;Как исправить;Подтверждение");
  });
  it("главные действия начинаются с ошибок и содержат подсказки", () => {
    const a = topActions(bad);
    expect(a[0].level).toBe("fail");
    expect(a.some((x) => x.hint)).toBe(true);
  });
  it("находит, где конкурент сильнее", () => {
    const gaps = competitorGaps(bad, [good]);
    expect(gaps.map((g) => g.block)).toEqual(expect.arrayContaining(["compliance", "seo"]));
  });
});

describe("мониторинг изменений", () => {
  it("diff показывает исправленное и появившееся", () => {
    const fake: SiteReport = JSON.parse(JSON.stringify(good));
    fake.url = bad.url;
    fake.total = 99;
    const d = diffReports([fake], [bad])[0];
    expect(d.total.before).toBe(99);
    expect(d.appeared.length).toBeGreaterThan(3);
  });
});

describe("интеграции", () => {
  it("webhook отправляет сводку", async () => {
    let body = "";
    const srv = createServer((req, res) => {
      req.on("data", (c) => (body += c));
      req.on("end", () => res.end("ok"));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    const status = await sendWebhook(`http://127.0.0.1:${port}/hook`, webhookPayload([bad, good]));
    srv.close();
    expect(status).toBe(200);
    const j = JSON.parse(body);
    expect(j.sites).toHaveLength(2);
    expect(j.sites[0].topIssues.length).toBeGreaterThan(0);
  });

  it("ИИ: OpenAI-совместимый API получает промпт экспертов и данные", async () => {
    let got: { model: string; messages: { role: string; content: string }[] } | null = null;
    const srv = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        got = JSON.parse(b);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "## Главное\nВсё хорошо." } }] }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    const cfg = resolveAi({ provider: "openai", apiKey: "test", baseUrl: `http://127.0.0.1:${port}/v1`, model: "test-model" })!;
    const text = await aiReview([bad, good], cfg);
    srv.close();
    expect(text).toContain("Главное");
    expect(got!.model).toBe("test-model");
    expect(got!.messages[0].content).toBe(expertPrompt());
    expect(got!.messages[1].content).toContain("сайт клиента");
  });
});

describe("MCP-сервер", () => {
  it("отдаёт инструменты и проводит аудит через audit_sites", async () => {
    execFileSync("npx", ["tsc", "-p", "."], { cwd: join(import.meta.dirname, "..") });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "node", args: [join(import.meta.dirname, "..", "dist", "cli.js"), "mcp"], env: { ...process.env } as Record<string, string> }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["audit_sites", "get_details"]));
    const out = tmp();
    const r = (await client.callTool({ name: "audit_sites", arguments: { urls: [goodUrl, badUrl], max_pages: 5, out_dir: out } }, undefined, { timeout: 120_000 })) as { content: { text: string }[]; structuredContent: { reportPath: string } };
    expect(r.content[0].text).toContain("| **Итог** |");
    expect(r.content[0].text).toContain("Отчёты сохранены");
    const d = (await client.callTool({ name: "get_details", arguments: { report_path: r.structuredContent.reportPath, block: "compliance" } })) as { content: { text: string }[] };
    expect(d.content[0].text).toContain("law.policy");
    const prompts = await client.listPrompts();
    expect(prompts.prompts[0].name).toBe("site_audit_expert");
    await client.close();
  }, 150_000);
});
