import type { SiteReport } from "../types.js";
import { BLOCK_KEYS, hostOf, topActions, type Diff } from "./insights.js";

/** Краткая сводка для автоматизаций: n8n, Make, Zapier, Albato, Битрикс24, свой бот */
export function webhookPayload(sites: SiteReport[], diffs: Diff[] = []) {
  return {
    tool: "site-audit-ru",
    version: sites[0]?.tool.version,
    collectedAt: sites[0]?.collectedAt,
    sites: sites.map((s) => ({
      host: hostOf(s.url),
      url: s.url,
      total: s.total,
      limited: s.limited,
      scores: Object.fromEntries(BLOCK_KEYS.map((k) => [k, s.total === null ? null : s.blocks[k].score])),
      topIssues: s.total === null ? [] : topActions(s, 5).map((a) => ({ block: a.block, level: a.level, message: a.message })),
    })),
    changes: diffs.map((d) => ({ host: hostOf(d.url), before: d.total.before, after: d.total.after, fixed: d.fixed.map((f) => f.message), appeared: d.appeared.map((f) => f.message) })),
    text: sites.map((s) => `${hostOf(s.url)}: ${s.total ?? "—"}/100`).join("\n"),
  };
}

export async function sendWebhook(url: string, payload: unknown): Promise<number> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return r.status;
}
