// Core Web Vitals реальных посетителей из Chrome UX Report (CrUX) — только по ключу пользователя.
// Без ключа проверка не выполняется; ключ не сохраняется и не попадает в отчёт.
import { fetch as ufetch } from "undici";
import { guardedAgent } from "../egress.js";

export const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

export type Rating = "хорошо" | "нужно улучшить" | "плохо";
export interface FieldMetric { key: string; label: string; p75: number; unit: "мс" | ""; rating: Rating }
export interface FieldData { origin: string; formFactor: "PHONE" | "DESKTOP" | "ALL"; period: string | null; metrics: FieldMetric[]; note?: string }

/** Пороги Google: хорошо ≤ первого, плохо > второго */
const METRICS: Record<string, { label: string; good: number; poor: number; unit: "мс" | "" }> = {
  largest_contentful_paint: { label: "LCP — загрузка главного блока", good: 2500, poor: 4000, unit: "мс" },
  interaction_to_next_paint: { label: "INP — отклик на действия", good: 200, poor: 500, unit: "мс" },
  cumulative_layout_shift: { label: "CLS — сдвиги вёрстки", good: 0.1, poor: 0.25, unit: "" },
  first_contentful_paint: { label: "FCP — первая отрисовка", good: 1800, poor: 3000, unit: "мс" },
  experimental_time_to_first_byte: { label: "TTFB — ответ сервера", good: 800, poor: 1800, unit: "мс" },
};

export const rate = (key: string, v: number): Rating => {
  const m = METRICS[key];
  return v <= m.good ? "хорошо" : v <= m.poor ? "нужно улучшить" : "плохо";
};

export function parseCrux(json: any, origin: string, formFactor: FieldData["formFactor"]): FieldData {
  const rec = json?.record ?? {};
  const metrics: FieldMetric[] = [];
  for (const [key, m] of Object.entries(METRICS)) {
    const raw = rec.metrics?.[key]?.percentiles?.p75;
    const v = typeof raw === "string" ? Number(raw) : raw;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    metrics.push({ key, label: m.label, p75: v, unit: m.unit, rating: rate(key, v) });
  }
  const p = rec.collectionPeriod;
  const d = (x: any) => (x ? `${x.year}-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}` : "");
  return { origin, formFactor, period: p ? `${d(p.firstDate)} — ${d(p.lastDate)}` : null, metrics };
}

/** Данные CrUX по сайту (origin); 404 — у Google мало посетителей этого сайта */
export async function fetchCrux(url: string, key: string, formFactor: FieldData["formFactor"] = "PHONE"): Promise<FieldData> {
  const origin = new URL(url.includes("://") ? url : "https://" + url).origin;
  if (!/^[A-Za-z0-9_\-]{20,60}$/.test(key)) throw new Error("Ключ CrUX API выглядит неверно — проверьте его в Google Cloud Console");
  const body = JSON.stringify({ origin, ...(formFactor === "ALL" ? {} : { formFactor }) });
  const r = await ufetch(`${CRUX_ENDPOINT}?key=${encodeURIComponent(key)}`, { dispatcher: guardedAgent(false), method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) return { origin, formFactor, period: null, metrics: [], note: "У Google недостаточно данных о реальных посетителях этого сайта (мало трафика из Chrome)" };
  if (r.status === 400 || r.status === 403) throw new Error("CrUX API отклонил ключ — проверьте, что API включён в проекте Google Cloud и ключ скопирован целиком");
  if (!r.ok) throw new Error(`CrUX API ответил ${r.status}`);
  const text = await r.text();
  if (text.length > 200_000) throw new Error("Слишком большой ответ CrUX API");
  return parseCrux(JSON.parse(text), origin, formFactor);
}

export function fieldMarkdown(f: FieldData): string {
  const head = `### Реальные посетители (Chrome UX Report, ${f.formFactor === "PHONE" ? "телефоны" : f.formFactor === "DESKTOP" ? "компьютеры" : "все устройства"})`;
  if (!f.metrics.length) return `${head}\n\n${f.note ?? "Нет данных"}\n`;
  return `${head}\n\nПериод: ${f.period ?? "последние 28 дней"}. Значения — 75-й перцентиль.\n\n| Метрика | Значение | Оценка |\n|---|---|---|\n${f.metrics.map((m) => `| ${m.label} | ${m.unit ? Math.round(m.p75) + " " + m.unit : m.p75} | ${m.rating} |`).join("\n")}\n`;
}
