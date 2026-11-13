import { fetch as ufetch } from "undici";
import { guardedAgent } from "../egress.js";
import { assertPublicUrl } from "../guard.js";
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
      ...(s.field?.metrics.length ? { field: Object.fromEntries(s.field.metrics.map((m) => [m.key, { p75: m.p75, rating: m.rating }])) } : {}),
      topIssues: s.total === null ? [] : topActions(s, 5).map((a) => ({ block: a.block, level: a.level, message: a.message })),
    })),
    changes: diffs.map((d) => ({ host: hostOf(d.url), before: d.total.before, after: d.total.after, fixed: d.fixed.map((f) => f.message), appeared: d.appeared.map((f) => f.message) })),
    text: sites.map((s) => `${hostOf(s.url)}: ${s.total ?? "—"}/100`).join("\n"),
  };
}

/** Отправка сводки: только https и только публичный адрес; редиректы не выполняются, ожидание — до 20 с */
export async function sendWebhook(url: string, payload: unknown, o: { allowPrivate?: boolean } = {}): Promise<number> {
  const allow = o.allowPrivate ?? process.env.SITE_AUDIT_ALLOW_PRIVATE === "1";
  const u = await assertPublicUrl(url, allow);
  if (u.protocol !== "https:" && !allow) throw new Error("Webhook должен начинаться с https://");
  const r = await ufetch(u, { dispatcher: guardedAgent(allow), method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  return r.status;
}
