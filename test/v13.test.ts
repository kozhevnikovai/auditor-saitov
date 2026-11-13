import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchCrux, fieldMarkdown, parseCrux, rate } from "../src/extras/crux.js";
import { assertSheetUrl, cell, sheetPayload } from "../src/extras/sheets.js";
import { auditArgs, cronLine, listCron, mergeCrontab, safeUrl, taskName, windowsScript, windowsTask } from "../src/extras/schedule.js";
import { htmlToPdf } from "../src/extras/pdf.js";
import { renderMarkdown } from "../src/report/md.js";
import { parseFormats } from "../src/output.js";
import type { SiteReport } from "../src/types.js";

const crux = { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 3100 } }, interaction_to_next_paint: { percentiles: { p75: 150 } }, cumulative_layout_shift: { percentiles: { p75: "0.31" } } }, collectionPeriod: { firstDate: { year: 2026, month: 10, day: 14 }, lastDate: { year: 2026, month: 11, day: 10 } } } };

describe("CrUX: реальные посетители", () => {
  it("пороги Google и разбор ответа", () => {
    expect(rate("largest_contentful_paint", 2500)).toBe("хорошо");
    expect(rate("interaction_to_next_paint", 300)).toBe("нужно улучшить");
    const f = parseCrux(crux, "https://a.ru", "PHONE");
    expect(f.metrics.map((m) => [m.key, m.rating])).toEqual([["largest_contentful_paint", "нужно улучшить"], ["interaction_to_next_paint", "хорошо"], ["cumulative_layout_shift", "плохо"]]);
    expect(f.period).toBe("2026-10-14 — 2026-11-10");
    expect(fieldMarkdown(f)).toContain("| LCP — загрузка главного блока | 3100 мс | нужно улучшить |");
    expect(fieldMarkdown({ origin: "x", formFactor: "PHONE", period: null, metrics: [], note: "мало данных" })).toContain("мало данных");
  });
  it("кривой ключ не уходит в сеть", async () => {
    await expect(fetchCrux("a.ru", "ключ с пробелами")).rejects.toThrow(/Ключ CrUX/);
  });
  it("в отчёте Markdown — раздел реальных посетителей", () => {
    const site = { tool: { name: "site-audit-ru", version: "1" }, collectedAt: "2026-11-13T10:00:00Z", url: "https://a.ru/", pagesCrawled: 1, limited: null, skipped: [], total: 80, field: parseCrux(crux, "https://a.ru", "PHONE"), blocks: Object.fromEntries(["seo", "structure", "visual", "tech", "compliance"].map((k) => [k, { score: 80, findings: [], data: {} }])) } as unknown as SiteReport;
    expect(renderMarkdown([site])).toContain("Реальные посетители (Chrome UX Report, телефоны)");
  });
});

describe("Google Таблица через Apps Script", () => {
  it("принимает только адрес веб-приложения Apps Script", () => {
    expect(() => assertSheetUrl("https://script.google.com/macros/s/AKfycbx1234567890abcdefghij/exec")).not.toThrow();
    for (const bad of ["http://script.google.com/macros/s/AKfycbx1234567890abcdefghij/exec", "https://evil.ru/macros/s/AKfycbx1234567890abcdefghij/exec", "https://script.google.com/macros/s/x/exec", "https://script.google.com.evil.ru/macros/s/AKfycbx1234567890abcdefghij/exec", "не ссылка"]) expect(() => assertSheetUrl(bad)).toThrow();
  });
  it("формулы со страниц сайта уходят текстом", () => {
    expect(cell("=IMPORTXML(\"http://x\")")).toBe("'=IMPORTXML(\"http://x\")");
    expect(cell("Нет политики")).toBe("Нет политики");
    const site = { collectedAt: "2026-11-13T10:00:00Z", url: "https://a.ru/", total: 70, blocks: Object.fromEntries(["seo", "structure", "visual", "tech", "compliance"].map((k) => [k, { score: 70, findings: [{ id: "x", level: "fail", message: "=1+1", evidence: ["/"] }, { id: "y", level: "ok", message: "ок" }], data: {} }])) } as unknown as SiteReport;
    const p = sheetPayload([site]);
    expect(p.summary[0]).toEqual(["2026-11-13 10:00", "a.ru", 70, 70, 70, 70, 70, 70]);
    expect(p.findings).toHaveLength(5);
    expect(p.findings[0][4]).toBe("'=1+1");
  });
  it("скрипт для таблицы лежит в репозитории", () => {
    expect(readFileSync(join(import.meta.dirname, "..", "docs", "google-sheets.gs"), "utf8")).toContain("function doPost");
  });
});

describe("проверка по расписанию", () => {
  const o = { urls: ["shop.ru", "https://rival.ru/catalog/"], every: "week" as const, at: "9:05", dir: "/home/u/site-audit" };
  it("безопасные адреса: ни кавычек, ни &, ни %, ни параметров", () => {
    expect(safeUrl("shop.ru")).toBe("https://shop.ru");
    for (const bad of ["a.ru/?x=1", "a.ru/&calc", "a.ru/%PATH%", "a.ru/\"x", "a.ru/$(id)", "a.ru/`id`", "a.ru/a b", "a.ru;rm -rf /", "file:///etc/passwd", "a.ru/'x"]) expect(() => safeUrl(bad)).toThrow(/нельзя поставить/);
  });
  it("аргументы проверки и ограничения", () => {
    expect(auditArgs(o)).toEqual(["-y", "site-audit-ru", "https://shop.ru", "https://rival.ru/catalog/", "--compare-last", "-f", "html,md,csv,xlsx"]);
    expect(() => auditArgs({ ...o, urls: Array(6).fill("a.ru") })).toThrow();
    expect(() => cronLine({ ...o, at: "25:00" })).toThrow(/ЧЧ:ММ/);
    expect(taskName(o.urls)).toBe("site-audit-ru-shop.ru");
  });
  it("cron: строка с меткой, повторное добавление заменяет старую, удаление", () => {
    const line = cronLine(o);
    expect(line).toBe("5 9 * * 1 cd '/home/u/site-audit' && npx -y site-audit-ru https://shop.ru https://rival.ru/catalog/ --compare-last -f html,md,csv,xlsx >> '/home/u/site-audit/schedule.log' 2>&1 # site-audit-ru:site-audit-ru-shop.ru");
    let tab = mergeCrontab("0 1 * * * backup\n", "site-audit-ru-shop.ru", line);
    tab = mergeCrontab(tab, "site-audit-ru-shop.ru", cronLine({ ...o, every: "day" }));
    expect(tab.split("\n").filter(Boolean)).toHaveLength(2);
    expect(listCron(tab)).toEqual(["site-audit-ru-shop.ru"]);
    expect(mergeCrontab(tab, "site-audit-ru-shop.ru")).toBe("0 1 * * * backup\n");
    expect(() => cronLine({ ...o, dir: "/home/u/$(id)" })).toThrow();
  });
  it("Windows: задание запускает .cmd, путь с пробелом в кавычках", () => {
    const w = { ...o, dir: "C:\\Users\\Sreda Pass\\site-audit" };
    expect(windowsScript(w)).toContain('cd /d "C:\\Users\\Sreda Pass\\site-audit"');
    expect(windowsTask(w, "C:\\Users\\Sreda Pass\\site-audit\\t.cmd")).toEqual(["/Create", "/F", "/SC", "WEEKLY", "/D", "MON", "/ST", "09:05", "/TN", "site-audit-ru-shop.ru", "/TR", '"C:\\Users\\Sreda Pass\\site-audit\\t.cmd"']);
    expect(() => windowsScript({ ...w, dir: "C:\\a&calc" })).toThrow();
  });
});

describe("PDF", () => {
  it("формат pdf принимается", () => expect(parseFormats("html,pdf")).toEqual(["html", "pdf"]));
  it("печать отчёта без сети", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-pdf-"));
    const html = join(dir, "report.html");
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><h1>Отчёт</h1><details><summary>Подробно</summary><p>Текст</p></details><img src="https://tracker.example/x.png">`);
    const out = await htmlToPdf(html, join(dir, "report.pdf"));
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});
