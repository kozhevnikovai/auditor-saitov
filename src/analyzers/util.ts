import type { BlockResult, Finding, Level } from "../types.js";

export function score(findings: Finding[]): number {
  const w: Record<Level, number | null> = { ok: 1, warn: 0.5, fail: 0, info: null };
  const vals = findings.map((f) => w[f.level]).filter((v): v is number => v !== null);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) : 100;
}

export function block(findings: Finding[], data: Record<string, unknown>): BlockResult {
  return { score: score(findings), findings, data };
}

export const f = (id: string, level: Level, message: string, evidence?: string[]): Finding =>
  evidence && evidence.length ? { id, level, message, evidence: [...new Set(evidence)].slice(0, 10) } : { id, level, message };

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function dups(values: [string, string][]): string[] {
  const m = new Map<string, string[]>();
  for (const [k, url] of values) if (k) m.set(k, [...(m.get(k) ?? []), url]);
  return [...m.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `«${k.slice(0, 60)}» — ${v.length} стр.`);
}
