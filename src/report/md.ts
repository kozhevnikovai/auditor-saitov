import { fieldMarkdown } from "../extras/crux.js";
import type { SiteReport } from "../types.js";
import { DISCLAIMER } from "../analyzers/compliance.js";
import { BLOCK_KEYS, BLOCKS, competitorGaps, type Diff, HINTS, hostOf, topActions } from "./insights.js";

const MARK = { fail: "**Ошибка**", warn: "**Внимание**", info: "Инфо", ok: "Норма" } as const;

/** Markdown — для Notion, Obsidian, GitHub, Telegram и вставки в чат с ИИ */
export function renderMarkdown(sites: SiteReport[], diffs: Diff[] = [], ai?: string): string {
  const own = sites[0];
  const L: string[] = [];
  L.push(`# ${sites.length > 1 ? "Сравнение сайтов" : `Аудит сайта ${hostOf(own.url)}`}`, "");
  L.push(`site-audit-ru ${own.tool.version} · ${new Date(own.collectedAt).toLocaleString("ru-RU")}`, "");
  L.push(`| | ${sites.map((s, i) => hostOf(s.url) + (i === 0 && sites.length > 1 ? " (вы)" : "")).join(" | ")} |`);
  L.push(`|---|${sites.map(() => "---:").join("|")}|`);
  for (const k of BLOCK_KEYS) L.push(`| ${BLOCKS[k]} | ${sites.map((s) => (s.total === null ? "—" : s.blocks[k].score)).join(" | ")} |`);
  L.push(`| **Итог** | ${sites.map((s) => `**${s.total ?? "—"}**`).join(" | ")} |`, "");
  for (const s of sites.filter((x) => x.limited)) L.push(`> ${hostOf(s.url)}: ${s.limited === "unreachable" ? "сайт не открылся — " + (s.skipped[0]?.reason ?? "") : "закрыт защитой от ботов, проверка неполная"}`, "");

  if (sites.length > 1 && own.total !== null) {
    const gaps = competitorGaps(own, sites.slice(1));
    if (gaps.length) {
      L.push("## Где конкуренты сильнее", "");
      for (const g of gaps) L.push(`- **${BLOCKS[g.block]}** — у ${g.competitor}: ${g.theirs}. У вас: ${g.yours}`);
      L.push("");
    }
  }
  if (own.total !== null) {
    L.push(`## Что сделать в первую очередь${sites.length > 1 ? ` — ${hostOf(own.url)}` : ""}`, "");
    topActions(own).forEach((a, i) => L.push(`${i + 1}. **${a.message}** _(${BLOCKS[a.block]})_${a.hint ? `  \n   ${a.hint}` : ""}`));
    L.push("");
  }
  if (ai) L.push("## Заключение эксперта (ИИ)", "", ai.trim(), "");
  for (const d of diffs) {
    L.push(`## Изменения: ${hostOf(d.url)} (${d.total.before ?? "—"} → ${d.total.after ?? "—"})`, "");
    for (const f of d.fixed) L.push(`- Исправлено: ${f.message}`);
    for (const f of d.appeared) L.push(`- Появилось: ${f.message}`);
    if (!d.fixed.length && !d.appeared.length) L.push("- Без изменений");
    L.push("");
  }
  for (const s of sites.filter((x) => x.total !== null)) {
    L.push(`## ${hostOf(s.url)} — подробно`, "");
    if (s.field) L.push(fieldMarkdown(s.field));
    for (const k of BLOCK_KEYS) {
      L.push(`### ${BLOCKS[k]} — ${s.blocks[k].score}/100`, "");
      for (const f of s.blocks[k].findings) {
        L.push(`- ${MARK[f.level]}: ${f.message}${f.evidence?.length ? ` — \`${f.evidence.slice(0, 3).join("`, `")}\`` : ""}`);
        if ((f.level === "fail" || f.level === "warn") && HINTS[f.id]) L.push(`  - Как исправить: ${HINTS[f.id]}`);
      }
      L.push("");
    }
  }
  L.push(`---`, `_${DISCLAIMER}_`, "");
  return L.join("\n");
}
