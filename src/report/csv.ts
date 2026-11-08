import type { SiteReport } from "../types.js";
import { BLOCK_KEYS, BLOCKS, HINTS, hostOf } from "./insights.js";

const LEVEL = { fail: "Ошибка", warn: "Внимание", info: "Инфо", ok: "Норма" } as const;
const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV для Excel и Google Таблиц: точка с запятой, UTF-8 с BOM — открывается двойным кликом в русском Excel */
export function renderCsv(sites: SiteReport[]): string {
  const rows: unknown[][] = [["Сайт", "Блок", "Оценка блока", "Уровень", "Код", "Находка", "Как исправить", "Подтверждение"]];
  for (const s of sites) {
    if (s.total === null) {
      rows.push([hostOf(s.url), "—", "", "Ошибка", "site.limited", s.limited === "unreachable" ? `Сайт не открылся: ${s.skipped[0]?.reason ?? ""}` : "Сайт закрыт защитой от ботов", "", ""]);
      continue;
    }
    for (const k of BLOCK_KEYS)
      for (const f of s.blocks[k].findings) rows.push([hostOf(s.url), BLOCKS[k], s.blocks[k].score, LEVEL[f.level], f.id, f.message, f.level === "fail" || f.level === "warn" ? HINTS[f.id] ?? "" : "", (f.evidence ?? []).join(" | ")]);
  }
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Сводная таблица оценок: одна строка — один сайт (удобно копить историю в таблице) */
export function renderSummaryCsv(sites: SiteReport[]): string {
  const rows: unknown[][] = [["Дата", "Сайт", "Итог", ...BLOCK_KEYS.map((k) => BLOCKS[k]), "Страниц"]];
  for (const s of sites) rows.push([s.collectedAt.slice(0, 10), hostOf(s.url), s.total ?? "", ...BLOCK_KEYS.map((k) => (s.total === null ? "" : s.blocks[k].score)), s.pagesCrawled]);
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
