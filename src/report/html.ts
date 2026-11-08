import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Level, SiteReport } from "../types.js";
import { DISCLAIMER } from "../analyzers/compliance.js";
import { BLOCK_KEYS, BLOCKS, competitorGaps, type Diff, HINTS, hostOf, topActions } from "./insights.js";

const require = createRequire(import.meta.url);

export interface ReportInput {
  sites: SiteReport[];
  diffs?: Diff[];
  /** Заключение ИИ в Markdown (необязательно) */
  ai?: string;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LEVEL: Record<Level, string> = { fail: "Ошибка", warn: "Внимание", info: "Инфо", ok: "Норма" };

function font(pkg: string, file: string): string {
  try {
    return readFileSync(require.resolve(`${pkg}/files/${file}`)).toString("base64");
  } catch {
    return "";
  }
}

function fontFaces(): string {
  const faces: [string, string, string, number, string][] = [
    ["Geologica", "@fontsource/geologica", "geologica-cyrillic-400-normal.woff2", 400, "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
    ["Geologica", "@fontsource/geologica", "geologica-latin-400-normal.woff2", 400, "U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2190-2193"],
    ["Geologica", "@fontsource/geologica", "geologica-cyrillic-600-normal.woff2", 600, "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
    ["Geologica", "@fontsource/geologica", "geologica-latin-600-normal.woff2", 600, "U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2190-2193"],
    ["Martian Mono", "@fontsource/martian-mono", "martian-mono-cyrillic-400-normal.woff2", 400, "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
    ["Martian Mono", "@fontsource/martian-mono", "martian-mono-latin-400-normal.woff2", 400, "U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2190-2193"],
  ];
  return faces
    .map(([fam, pkg, file, w, range]) => {
      const b = font(pkg, file);
      return b ? `@font-face{font-family:"${fam}";font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b}) format("woff2");unicode-range:${range}}` : "";
    })
    .join("\n");
}

function img(path?: string): string {
  if (!path || !existsSync(path)) return "";
  const type = path.endsWith(".png") ? "png" : "jpeg";
  return `data:image/${type};base64,${readFileSync(path).toString("base64")}`;
}

/** Мини-Markdown для заключения ИИ: заголовки, списки, жирный, абзацы */
export function mdToHtml(md: string): string {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) {
      close();
      out.push(`<h4>${inline(h[2])}</h4>`);
    } else if (ul || ol) {
      const t = ul ? "ul" : "ol";
      if (list !== t) {
        close();
        out.push(`<${t}>`);
        list = t;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (line.trim()) {
      close();
      out.push(`<p>${inline(line)}</p>`);
    } else close();
  }
  close();
  return out.join("\n");
}

const LOGO = `<svg class="logo" viewBox="0 0 512 512" aria-hidden="true"><path d="M186 146 V366 M186 276 L320 146 M226 237 L330 366" fill="none" stroke="#161616" stroke-width="36" stroke-linecap="square"/><circle cx="352" cy="146" r="22" fill="#FF5A1F"/></svg>`;

/** Размерная шкала 0–100: тонкая линия, засечки, отметка значения */
function gauge(score: number | null): string {
  if (score === null) return `<span class="mono muted">—</span>`;
  return `<span class="gauge" title="${score}/100"><span class="track"></span><span class="fill" style="width:${score}%"></span><span class="tick" style="left:50%"></span><span class="tick" style="left:80%"></span></span><span class="mono num">${score}</span>`;
}

function siteCard(r: SiteReport, idx: number): string {
  const s = r.blocks.visual.data.screenshots as { desktop?: string; mobile?: string } | undefined;
  const d = img(s?.desktop);
  const m = img(s?.mobile);
  const limited = r.limited === "unreachable" ? `Сайт не открылся: ${esc(r.skipped[0]?.reason ?? "нет ответа")}` : r.limited === "bot-protection" ? "Сайт закрыт защитой от ботов — проверка неполная, оценка не ставится." : "";
  return `<section class="card">
  <div class="card-head"><span class="mono label">Деталь ${String(idx + 1).padStart(2, "0")}${idx === 0 ? " · ваш сайт" : ""}</span><h2>${esc(hostOf(r.url))}</h2><a class="mono small" href="${esc(r.url)}">${esc(r.url)}</a></div>
  ${limited ? `<p class="warnline">${limited}</p>` : ""}
  <div class="card-body">
    <div class="total"><span class="mono label">Итог</span><span class="mono big">${r.total ?? "—"}</span><span class="mono small muted">из 100 · ${r.pagesCrawled} стр.</span></div>
    <table class="bars">${BLOCK_KEYS.map((k) => `<tr><td>${BLOCKS[k]}</td><td>${gauge(r.total === null ? null : r.blocks[k].score)}</td></tr>`).join("")}</table>
  </div>
  ${d || m ? `<div class="shots">${d ? `<figure><img src="${d}" alt="Компьютер"><figcaption class="mono small">1440 × 900</figcaption></figure>` : ""}${m ? `<figure class="m"><img src="${m}" alt="Телефон"><figcaption class="mono small">390 × 844</figcaption></figure>` : ""}</div>` : ""}
</section>`;
}

function findingRow(level: Level, message: string, evidence?: string[], hint?: string): string {
  return `<li class="f ${level}"><span class="mono lvl">${LEVEL[level]}</span><div><div>${esc(message)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}${evidence?.length ? `<div class="ev mono">${evidence.slice(0, 6).map(esc).join("<br>")}</div>` : ""}</div></li>`;
}

export function renderHtml(input: ReportInput): string {
  const { sites } = input;
  const own = sites[0];
  const ok = sites.filter((s) => s.total !== null);
  const compare = sites.length > 1;
  const date = new Date(own?.collectedAt ?? Date.now()).toLocaleDateString("ru-RU");
  const title = compare ? `Сравнение сайтов: ${sites.map((s) => hostOf(s.url)).join(", ")}` : `Аудит сайта ${hostOf(own.url)}`;
  const best = (k: string) => Math.max(...ok.map((s) => (k === "total" ? (s.total ?? 0) : s.blocks[k as keyof SiteReport["blocks"]].score)));

  const compareTable = compare
    ? `<section><h3><span class="mono n">01</span>Сравнение</h3><div class="scroll"><table class="cmp"><thead><tr><th></th>${sites.map((s, i) => `<th>${esc(hostOf(s.url))}${i === 0 ? '<span class="mono small muted"> · вы</span>' : ""}</th>`).join("")}</tr></thead><tbody>
${BLOCK_KEYS.map((k) => `<tr><td>${BLOCKS[k]}</td>${sites.map((s) => (s.total === null ? `<td class="mono muted">—</td>` : `<td class="mono${s.blocks[k].score === best(k) && ok.length > 1 ? " best" : ""}">${s.blocks[k].score}</td>`)).join("")}</tr>`).join("\n")}
<tr class="sum"><td>Итог</td>${sites.map((s) => `<td class="mono${s.total !== null && s.total === best("total") && ok.length > 1 ? " best" : ""}">${s.total ?? "—"}</td>`).join("")}</tr>
</tbody></table></div>
${(() => {
  const gaps = own.total === null ? [] : competitorGaps(own, sites.slice(1));
  return gaps.length ? `<h4>Где конкуренты сильнее</h4><ul class="list">${gaps.map((g) => `<li><span class="mono small tag">${BLOCKS[g.block]}</span> У <b>${esc(g.competitor)}</b>: ${esc(g.theirs)}. <span class="muted">У вас: ${esc(g.yours)}</span></li>`).join("")}</ul>` : "";
})()}</section>`
    : "";

  const actions = own.total === null ? [] : topActions(own, 10);
  const n = (i: number) => String(i + (compare ? 2 : 1)).padStart(2, "0");
  const actionsHtml = actions.length ? `<section><h3><span class="mono n">${n(0)}</span>Что сделать в первую очередь${compare ? ` — ${esc(hostOf(own.url))}` : ""}</h3><ol class="actions">${actions.map((a) => `<li><span class="mono small tag">${BLOCKS[a.block]}</span><b>${esc(a.message)}</b>${a.hint ? `<div class="hint">${esc(a.hint)}</div>` : ""}</li>`).join("")}</ol></section>` : "";

  const diffHtml = input.diffs?.length
    ? `<section><h3><span class="mono n">Δ</span>Изменения с прошлой проверки</h3>${input.diffs
        .map((d) => {
          const dt = d.total.before !== null && d.total.after !== null ? d.total.after - d.total.before : null;
          return `<div class="diff"><h4>${esc(hostOf(d.url))} <span class="mono">${d.total.before ?? "—"} → ${d.total.after ?? "—"}${dt ? ` (${dt > 0 ? "+" : ""}${dt})` : ""}</span></h4>${d.fixed.length ? `<p class="muted">Исправлено:</p><ul class="list">${d.fixed.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul>` : ""}${d.appeared.length ? `<p class="muted">Появилось:</p><ul class="list">${d.appeared.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul>` : ""}${!d.fixed.length && !d.appeared.length ? `<p class="muted">Без изменений в ошибках и замечаниях.</p>` : ""}</div>`;
        })
        .join("")}</section>`
    : "";

  const aiHtml = input.ai ? `<section class="ai"><h3><span class="mono n">ИИ</span>Заключение эксперта</h3>${mdToHtml(input.ai)}</section>` : "";

  const details = sites
    .filter((s) => s.total !== null)
    .map(
      (s) => `<section class="details"><h3><span class="mono n">${esc(hostOf(s.url))}</span>Подробно</h3>
${BLOCK_KEYS.map((k) => {
  const fs = [...s.blocks[k].findings].sort((a, b) => ["fail", "warn", "info", "ok"].indexOf(a.level) - ["fail", "warn", "info", "ok"].indexOf(b.level));
  return `<details${k === "compliance" || k === "seo" ? " open" : ""}><summary><span>${BLOCKS[k]}</span><span class="mono">${s.blocks[k].score}</span></summary><ul class="findings">${fs.map((x) => findingRow(x.level, x.message, x.evidence, x.level === "fail" || x.level === "warn" ? HINTS[x.id] : undefined)).join("")}</ul>${k === "compliance" ? `<p class="small muted">${esc(DISCLAIMER)}</p>` : ""}${k === "seo" ? `<p class="small muted">Скорость измерена с компьютера, на котором запускалась проверка, и зависит от его сети.</p>` : ""}${k === "visual" ? palette(s) : ""}</details>`;
}).join("\n")}</section>`,
    )
    .join("\n");

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>${fontFaces()}
:root{--ink:#161616;--pencil:#5C5C5C;--axis:#9C9C9C;--plate:#E6E6E6;--signal:#FF5A1F;--signal-text:#C8410F}
*{box-sizing:border-box}html{background:#fff}body{margin:0;color:var(--ink);font:400 15px/1.55 Geologica,system-ui,-apple-system,"Segoe UI",sans-serif}
.mono,code{font-family:"Martian Mono",ui-monospace,Consolas,monospace;font-size:.86em}.small{font-size:12px}.muted{color:var(--pencil)}
.sheet{max-width:1180px;margin:24px auto;border:3px solid var(--ink);padding:0}
header.top{display:flex;align-items:center;gap:16px;padding:20px 28px;border-bottom:1px solid var(--ink)}.logo{width:44px;height:44px}
header.top h1{font-size:26px;line-height:1.2;margin:0;font-weight:600}header.top .meta{margin-left:auto;text-align:right;color:var(--pencil)}
main{padding:8px 28px 28px}section{margin:28px 0}h3{font-size:20px;font-weight:600;margin:0 0 14px;display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--ink);padding-bottom:8px}
h3 .n{color:var(--signal-text);font-size:13px}h4{font-size:16px;font-weight:600;margin:18px 0 8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:0;border-top:1px solid var(--ink);border-left:1px solid var(--ink)}
.card{margin:0;padding:18px;border-right:1px solid var(--ink);border-bottom:1px solid var(--ink)}.card-head h2{margin:2px 0;font-size:22px;font-weight:600}.card-head a{color:var(--pencil);text-decoration:none;word-break:break-all}
.label{color:var(--pencil);text-transform:uppercase;letter-spacing:.04em;font-size:11px}
.card-body{display:flex;gap:20px;margin-top:14px;align-items:flex-start}.total{display:flex;flex-direction:column;min-width:88px}.big{font-size:44px;line-height:1.1}
.bars{border-collapse:collapse;flex:1}.bars td{padding:3px 0;font-size:13px;vertical-align:middle}.bars td:first-child{padding-right:10px;color:var(--pencil);white-space:nowrap}
.gauge{position:relative;display:inline-block;width:120px;height:10px;vertical-align:middle;margin-right:8px}.gauge .track{position:absolute;left:0;right:0;top:5px;border-top:1px solid var(--axis)}
.gauge .fill{position:absolute;left:0;top:3px;height:4px;background:var(--ink)}.gauge .tick{position:absolute;top:1px;height:9px;border-left:1px solid var(--axis)}.num{display:inline-block;width:28px;text-align:right}
.shots{display:flex;gap:12px;margin-top:14px;align-items:flex-end}.shots figure{margin:0;flex:1}.shots figure.m{flex:0 0 26%}.shots img{width:100%;display:block;border:1px solid var(--ink)}figcaption{color:var(--pencil);margin-top:4px}
.warnline{border-left:3px solid var(--signal);padding:6px 10px;background:#fff;margin:10px 0 0}
.scroll{overflow-x:auto}table.cmp{border-collapse:collapse;width:100%}table.cmp th,table.cmp td{border:1px solid var(--ink);padding:8px 10px;text-align:left}table.cmp th{font-weight:600;background:var(--plate)}
table.cmp td.best{color:var(--signal-text);font-weight:600}table.cmp tr.sum td{font-weight:600;border-top:3px solid var(--ink)}
.tag{display:inline-block;background:var(--plate);padding:1px 6px;margin-right:8px;color:var(--ink)}
.list{padding-left:18px}.list li{margin:6px 0}ol.actions{padding-left:0;list-style:none;counter-reset:a}ol.actions li{counter-increment:a;position:relative;padding:10px 0 10px 44px;border-bottom:1px dashed var(--axis)}
ol.actions li::before{content:counter(a,decimal-leading-zero);position:absolute;left:0;top:10px;font-family:"Martian Mono",monospace;color:var(--signal-text)}
.hint{color:var(--pencil);font-size:13px;margin-top:3px}
details{border-top:1px solid var(--ink)}details:last-of-type{border-bottom:1px solid var(--ink)}summary{cursor:pointer;display:flex;justify-content:space-between;padding:10px 0;font-weight:600;list-style:none}summary::-webkit-details-marker{display:none}
summary span:first-child::before{content:"+ ";font-family:"Martian Mono",monospace;color:var(--pencil)}details[open] summary span:first-child::before{content:"− "}
ul.findings{list-style:none;padding:0;margin:0 0 12px}li.f{display:flex;gap:14px;padding:7px 0;border-top:1px solid var(--plate)}li.f .lvl{flex:0 0 88px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding-top:3px}
li.f.fail .lvl{color:var(--signal-text);font-weight:600}li.f.warn .lvl{color:var(--ink)}li.f.ok .lvl,li.f.info .lvl{color:var(--axis)}li.f.ok>div,li.f.info>div{color:var(--pencil)}
.ev{color:var(--pencil);font-size:11px;margin-top:4px;word-break:break-all}.swatches{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px}.sw{display:flex;align-items:center;gap:6px;font-size:11px}.sw i{width:22px;height:22px;border:1px solid var(--ink);display:inline-block}
.ai{border:1px solid var(--ink);padding:16px 20px}.ai h3{border:0}
footer.stamp{display:grid;grid-template-columns:repeat(6,1fr);border-top:3px solid var(--ink)}footer.stamp div{padding:8px 12px;border-right:1px solid var(--ink)}footer.stamp div:last-child{border-right:0}footer.stamp b{display:block;font-weight:400;color:var(--pencil);font-size:11px}footer.stamp span{font-family:"Martian Mono",monospace;font-size:12px}
@media (max-width:720px){main{padding:4px 14px 20px}header.top{padding:14px}.card-body{flex-direction:column}footer.stamp{grid-template-columns:repeat(2,1fr)}footer.stamp div{border-bottom:1px solid var(--ink)}}
@media print{.sheet{margin:0;border-width:2px}details{break-inside:avoid}details:not([open])>*:not(summary){display:block}a{color:inherit}}
</style></head><body><div class="sheet">
<header class="top">${LOGO}<div><div class="mono label">site-audit-ru · № 002</div><h1>${compare ? "Сравнение сайтов" : "Аудит сайта"}</h1></div><div class="meta mono small">${esc(date)}<br>${sites.length} ${sites.length === 1 ? "сайт" : sites.length < 5 ? "сайта" : "сайтов"}</div></header>
<main>
<section><div class="cards">${sites.map(siteCard).join("")}</div></section>
${compareTable}
${actionsHtml}
${aiHtml}
${diffHtml}
${details}
</main>
<footer class="stamp"><div><b>Разработчик</b><span>kozhevnikovai</span></div><div><b>Номер</b><span>№ 002</span></div><div><b>Объект</b><span>${esc(sites.map((s) => hostOf(s.url)).join(", ")).slice(0, 80)}</span></div><div><b>Дата</b><span>${esc(date)}</span></div><div><b>Версия</b><span>${esc(own?.tool.version ?? "")}</span></div><div><b>Лицензия</b><span>MIT</span></div></footer>
</div></body></html>`;
}

function palette(s: SiteReport): string {
  const d = s.blocks.visual.data as { palette?: { hex: string; role: string }[]; fonts?: { family: string }[] };
  if (!d.palette?.length) return "";
  const uniq = [...new Map(d.palette.map((p) => [p.hex, p])).values()].slice(0, 14);
  return `<div class="swatches">${uniq.map((p) => `<span class="sw"><i style="background:${esc(p.hex)}"></i><span class="mono">${esc(p.hex)}</span></span>`).join("")}</div>${d.fonts?.length ? `<p class="small muted">Шрифты: ${d.fonts.map((f) => esc(f.family)).join(", ")}</p>` : ""}`;
}
