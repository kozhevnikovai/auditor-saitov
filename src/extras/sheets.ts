// Выгрузка в Google Таблицу без аккаунта и OAuth в программе: пользователь один раз вставляет в свою таблицу
// скрипт (docs/google-sheets.gs) и публикует его как веб-приложение. Аудитор отправляет строки на этот адрес.
import type { SiteReport } from "../types.js";
import { BLOCK_KEYS, hostOf } from "../report/insights.js";
import { sendWebhook } from "../report/webhook.js";

const LEVEL: Record<string, string> = { fail: "ошибка", warn: "внимание", ok: "хорошо", info: "инфо" };
const BLOCK: Record<string, string> = { seo: "SEO и скорость", structure: "Структура", visual: "Стиль", tech: "Технологии", compliance: "Законы РФ" };

/** Адрес веб-приложения Apps Script: только script.google.com/macros/s/…/exec */
export function assertSheetUrl(url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("Адрес Google Таблицы не похож на ссылку"); }
  if (u.protocol !== "https:" || u.hostname !== "script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_\-]{20,}\/exec$/.test(u.pathname)) {
    throw new Error("Нужен адрес веб-приложения Apps Script вида https://script.google.com/macros/s/…/exec — см. инструкцию «Выгрузка в Google Таблицу»");
  }
  return u;
}

/** Ячейки, похожие на формулы, отправляются текстом: таблица не выполнит чужую формулу со страницы сайта */
export const cell = (v: unknown) => { const t = String(v ?? ""); return /^[=+\-@\t\r]/.test(t) ? "'" + t : t; };

export function sheetPayload(sites: SiteReport[]) {
  const at = sites[0]?.collectedAt?.slice(0, 16).replace("T", " ") ?? "";
  return {
    tool: "site-audit-ru",
    summary: sites.map((s) => [at, hostOf(s.url), s.total ?? "", ...BLOCK_KEYS.map((k) => (s.total === null ? "" : s.blocks[k].score))].map((v) => (typeof v === "number" ? v : cell(v)))),
    summaryHeader: ["Дата", "Сайт", "Итог", ...BLOCK_KEYS.map((k) => BLOCK[k])],
    findings: sites.flatMap((s) => (s.total === null ? [] : BLOCK_KEYS.flatMap((k) => s.blocks[k].findings.filter((f) => f.level === "fail" || f.level === "warn").map((f) => [at, hostOf(s.url), BLOCK[k], LEVEL[f.level], f.message, (f.evidence ?? []).slice(0, 3).join("; ")].map(cell))))).slice(0, 2000),
    findingsHeader: ["Дата", "Сайт", "Блок", "Уровень", "Находка", "Где"],
  };
}

export async function sendToSheet(url: string, sites: SiteReport[]): Promise<number> {
  assertSheetUrl(url);
  const status = await sendWebhook(url, sheetPayload(sites));
  // Apps Script отвечает перенаправлением на результат — запись к этому моменту уже сделана
  if (status >= 400) throw new Error(`Таблица ответила ${status}: проверьте, что веб-приложение опубликовано с доступом «Все»`);
  return status;
}
