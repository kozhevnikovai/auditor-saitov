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

export function fontFaces(): string {
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

// ───────────────────────────── вспомогательное ─────────────────────────────

type Counts = { fail: number; warn: number; ok: number; info: number };
const KEYS = BLOCK_KEYS;

function counts(r: SiteReport, block?: (typeof KEYS)[number]): Counts {
  const c: Counts = { fail: 0, warn: 0, ok: 0, info: 0 };
  for (const k of block ? [block] : KEYS) for (const f of r.blocks[k].findings) c[f.level]++;
  return c;
}

const verdict = (s: number) => (s >= 85 ? ["Хорошо", "good"] : s >= 70 ? ["Средне", "warn"] : ["Слабо", "fail"]);

/** Выделяет цифры и величины в тексте находки */
function hl(text: string): string {
  return esc(text).replace(/\d+(?:[.,]\d+)?\s?(?:мс|МБ|px|%|стр\.|:1|символов|пунктов|запросов|адресов)|\d+ из \d+/g, (m) => `<b class="v">${m}</b>`);
}

function gauge(score: number | null): string {
  if (score === null) return `<span class="gauge"></span><span class="mono num muted">—</span>`;
  const st = verdict(score)[1];
  return `<span class="gauge" title="${score}/100"><span class="track"></span><span class="fill ${st}" style="width:${score}%"></span><span class="tick" style="left:70%"></span><span class="tick" style="left:85%"></span></span><span class="mono num">${score}</span>`;
}

/** Полоса из трёх отрезков: ошибки / замечания / норма */
function stack(c: Counts, wide = false): string {
  const t = c.fail + c.warn + c.ok || 1;
  const seg = (n: number, cls: string) => (n ? `<span class="${cls}" style="flex:${n / t}"></span>` : "");
  return `<span class="stack${wide ? " wide" : ""}">${seg(c.fail, "fail")}${seg(c.warn, "warn")}${seg(c.ok, "good")}</span>`;
}

/** Радар по пяти блокам: ваш сайт — тушь, конкуренты — серые штрихи */
function radar(sites: SiteReport[]): string {
  const ok = sites.filter((s) => s.total !== null);
  if (ok.length < 2) return "";
  const cx = 250, cy = 175, R = 118, n = KEYS.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)];
  };
  const ring = (v: number) => KEYS.map((_, i) => pt(i, v).join(",")).join(" ");
  const dashes = ["7 4", "2 3", "10 3 2 3", "4 4"];
  const grays = ["#5C5C5C", "#9C9C9C", "#5C5C5C", "#9C9C9C"];
  const polys = ok
    .map((s, j) => {
      const pts = KEYS.map((k, i) => pt(i, s.blocks[k].score).join(",")).join(" ");
      const own = s === sites[0];
      return `<polygon points="${pts}" fill="none" stroke="${own ? "#161616" : grays[(j - 1) % 4]}" stroke-width="${own ? 2.5 : 1.5}" ${own ? "" : `stroke-dasharray="${dashes[(j - 1) % 4]}"`}/>` +
        (own ? KEYS.map((k, i) => { const [x, y] = pt(i, s.blocks[k].score); return `<circle cx="${x}" cy="${y}" r="3.5" fill="#FF5A1F"/>`; }).join("") : "");
    })
    .join("");
  const labels = KEYS.map((k, i) => {
    const [x, y] = pt(i, 122);
    const anchor = Math.abs(x - cx) < 10 ? "middle" : x > cx ? "start" : "end";
    const short = { seo: "SEO", structure: "Структура", visual: "Стиль", tech: "Технологии", compliance: "Законы РФ" }[k];
    return `<text x="${x}" y="${y + (y > cy ? 14 : -4)}" text-anchor="${anchor}" font-size="13" fill="#5C5C5C">${short}</text>`;
  }).join("");
  const legend = ok
    .map((s, j) => `<span class="lg"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="${s === sites[0] ? "#161616" : grays[(j - 1) % 4]}" stroke-width="${s === sites[0] ? 2.5 : 1.5}" ${s === sites[0] ? "" : `stroke-dasharray="${dashes[(j - 1) % 4]}"`}/></svg>${esc(hostOf(s.url))}</span>`)
    .join("");
  return `<figure class="radar"><svg viewBox="0 0 500 350" role="img" aria-label="Сравнение по блокам">
${[25, 50, 75, 100].map((v) => `<polygon points="${ring(v)}" fill="none" stroke="#E6E6E6" stroke-width="1"/>`).join("")}
${KEYS.map((_, i) => { const [x, y] = pt(i, 100); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#9C9C9C" stroke-width="1" stroke-dasharray="26 6 3 6"/>`; }).join("")}
${polys}${labels}</svg><figcaption>${legend}</figcaption></figure>`;
}

// ───────────────────────────── блоки отчёта ─────────────────────────────

function keyPanel(sites: SiteReport[]): string {
  const own = sites[0];
  if (own.total === null)
    return `<section id="main" class="key"><h3><span class="mono n">00</span>Главное</h3><p class="warnline">${own.limited === "bot-protection" ? "Ваш сайт закрыт защитой от ботов — автоматическая проверка неполная. Добавьте адрес проверки в белый список или запустите с компьютера, где сайт открывается." : `Ваш сайт не открылся: ${esc(own.skipped[0]?.reason ?? "нет ответа")}`}</p></section>`;
  const c = counts(own);
  const [word, st] = verdict(own.total);
  const ranked = sites.filter((s) => s.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const place = ranked.indexOf(own) + 1;
  const byScore = [...KEYS].sort((a, b) => own.blocks[b].score - own.blocks[a].score);
  const top = topActions(own, 3);
  return `<section id="main" class="key">
<div class="key-grid">
  <div class="k-score"><span class="mono label">Итог ${esc(hostOf(own.url))}</span><div class="big-wrap"><span class="mono huge">${own.total}</span><span class="mono muted">/100</span></div><span class="badge ${st}">${word}</span></div>
  <div class="k-counts"><span class="mono label">Находки</span>
    <div class="cnt"><span class="mark fail"></span><b class="mono">${c.fail}</b> ошибок</div>
    <div class="cnt"><span class="mark warn"></span><b class="mono">${c.warn}</b> замечаний</div>
    <div class="cnt"><span class="mark good"></span><b class="mono">${c.ok}</b> в норме</div>
    ${stack(c, true)}
  </div>
  <div class="k-pos"><span class="mono label">${sites.length > 1 ? "Место среди сайтов" : "Блоки"}</span>
    ${sites.length > 1 ? `<div class="place"><span class="mono huge2">${place}</span><span class="muted"> из ${ranked.length}</span></div>` : ""}
    <div class="small">Сильнее всего: <b>${BLOCKS[byScore[0]]}</b> <span class="mono">${own.blocks[byScore[0]].score}</span></div>
    <div class="small">Слабее всего: <b>${BLOCKS[byScore[byScore.length - 1]]}</b> <span class="mono">${own.blocks[byScore[byScore.length - 1]].score}</span></div>
  </div>
</div>
${top.length ? `<div class="k-top"><span class="mono label">Три главные проблемы</span><ol>${top.map((a) => `<li><span class="chip ${a.level === "fail" ? "fail" : "warn"}">${LEVEL[a.level]}</span><span>${hl(a.message)}</span></li>`).join("")}</ol></div>` : ""}
</section>`;
}

function siteCard(r: SiteReport, idx: number): string {
  const s = r.blocks.visual.data.screenshots as { desktop?: string; mobile?: string } | undefined;
  const d = img(s?.desktop);
  const m = img(s?.mobile);
  const limited = r.limited === "unreachable" ? `Сайт не открылся: ${esc(r.skipped[0]?.reason ?? "нет ответа")}` : r.limited === "bot-protection" ? "Сайт закрыт защитой от ботов — проверка неполная, оценка не ставится." : "";
  const c = counts(r);
  const st = r.total === null ? "" : verdict(r.total)[1];
  return `<section class="card">
  <div class="card-head"><span class="mono label">Деталь ${String(idx + 1).padStart(2, "0")}${idx === 0 ? " · ваш сайт" : " · конкурент"}</span><h2>${esc(hostOf(r.url))}</h2><a class="mono small" href="${esc(r.url)}">${esc(r.url)}</a></div>
  ${limited ? `<p class="warnline">${limited}</p>` : ""}
  <div class="card-body">
    <div class="total"><span class="mono big ${st}">${r.total ?? "—"}</span><span class="mono small muted">из 100 · ${r.pagesCrawled} стр.</span>${r.total !== null ? `<span class="mini mono small"><span class="mark fail"></span>${c.fail} <span class="mark warn"></span>${c.warn} <span class="mark good"></span>${c.ok}</span>` : ""}</div>
    <div class="bars">${KEYS.map((k) => `<span class="bl">${BLOCKS[k]}</span>${gauge(r.total === null ? null : r.blocks[k].score)}`).join("")}</div>
  </div>
  ${d || m ? `<div class="shots">${d ? `<figure><img src="${d}" alt="Компьютер"><figcaption class="mono small">1440 × 900</figcaption></figure>` : ""}${m ? `<figure class="m"><img src="${m}" alt="Телефон"><figcaption class="mono small">390 × 844</figcaption></figure>` : ""}</div>` : ""}
</section>`;
}

function findingRow(level: Level, message: string, evidence?: string[], hint?: string): string {
  return `<li class="f ${level}"><span class="chip ${level === "ok" ? "good" : level}">${LEVEL[level]}</span><div><div class="msg">${hl(message)}</div>${hint ? `<div class="hint"><span class="mono">→</span> ${esc(hint)}</div>` : ""}${evidence?.length ? `<div class="ev mono">${evidence.slice(0, 6).map(esc).join("<br>")}</div>` : ""}</div></li>`;
}

function palette(s: SiteReport): string {
  const d = s.blocks.visual.data as { palette?: { hex: string; role: string }[]; fonts?: { family: string }[] };
  if (!d.palette?.length) return "";
  const uniq = [...new Map(d.palette.map((p) => [p.hex, p])).values()].slice(0, 14);
  return `<div class="swatches">${uniq.map((p) => `<span class="sw"><i style="background:${esc(p.hex)}"></i><span class="mono">${esc(p.hex)}</span></span>`).join("")}</div>${d.fonts?.length ? `<p class="small muted">Шрифты: ${d.fonts.map((f) => esc(f.family)).join(", ")}</p>` : ""}`;
}

const SCRIPT = `<script>
(function(){
  var b=document.body;
  var t=document.getElementById('only-issues');
  if(t)t.addEventListener('click',function(){b.classList.toggle('only-issues');t.classList.toggle('on');t.textContent=b.classList.contains('only-issues')?'Показать всё':'Только проблемы';});
  var d=document.getElementById('dl');
  if(d)d.addEventListener('click',function(){var h='<!doctype html>\\n'+document.documentElement.outerHTML;var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([h],{type:'text/html'}));a.download=d.getAttribute('data-name');document.body.appendChild(a);a.click();a.remove();});
  var p=document.getElementById('pr');
  if(p)p.addEventListener('click',function(){document.querySelectorAll('details').forEach(function(x){x.open=true});window.print();});
})();
</script>`;

export function renderHtml(input: ReportInput): string {
  const { sites } = input;
  const own = sites[0];
  const ok = sites.filter((s) => s.total !== null);
  const compare = sites.length > 1;
  const date = new Date(own?.collectedAt ?? Date.now()).toLocaleDateString("ru-RU");
  const title = compare ? `Сравнение сайтов: ${sites.map((s) => hostOf(s.url)).join(", ")}` : `Аудит сайта ${hostOf(own.url)}`;
  const val = (s: SiteReport, k: string) => (k === "total" ? (s.total ?? 0) : s.blocks[k as keyof SiteReport["blocks"]].score);
  // подсвечиваем только единственного лидера
  const best = (k: string) => {
    const vals = ok.map((s) => val(s, k));
    const m = Math.max(...vals);
    return vals.filter((v) => v === m).length === 1 ? m : -1;
  };
  let sec = 0;
  const num = () => String(++sec).padStart(2, "0");
  const toc: [string, string][] = [["main", "Главное"]];

  const cards = `<section id="sites"><div class="cards">${sites.map(siteCard).join("")}</div></section>`;

  let compareHtml = "";
  if (compare) {
    toc.push(["compare", "Сравнение"]);
    const gaps = own.total === null ? [] : competitorGaps(own, sites.slice(1));
    compareHtml = `<section id="compare"><h3><span class="mono n">${num()}</span>Сравнение</h3><div class="cmp-grid">${radar(sites)}<div class="scroll"><table class="cmp"><thead><tr><th></th>${sites.map((s, i) => `<th>${esc(hostOf(s.url))}${i === 0 ? '<span class="mono small muted"> · вы</span>' : ""}</th>`).join("")}</tr></thead><tbody>
${KEYS.map((k) => `<tr><td>${BLOCKS[k]}</td>${sites.map((s) => (s.total === null ? `<td class="mono muted">—</td>` : `<td class="mono${s.blocks[k].score === best(k) ? " best" : ""}"><span class="mark ${verdict(s.blocks[k].score)[1]}"></span>${s.blocks[k].score}</td>`)).join("")}</tr>`).join("\n")}
<tr class="sum"><td>Итог</td>${sites.map((s) => `<td class="mono${s.total !== null && s.total === best("total") ? " best" : ""}">${s.total ?? "—"}</td>`).join("")}</tr>
</tbody></table></div></div>
${gaps.length ? `<h4>Где конкуренты сильнее</h4><ul class="gaps">${gaps.map((g) => `<li><span class="tag">${BLOCKS[g.block]}</span><div><div>У <b>${esc(g.competitor)}</b>: ${hl(g.theirs)}</div><div class="muted small">У вас: ${hl(g.yours)}</div></div></li>`).join("")}</ul>` : ""}</section>`;
  }

  const actions = own.total === null ? [] : topActions(own, 10);
  let actionsHtml = "";
  if (actions.length) {
    toc.push(["plan", "План действий"]);
    actionsHtml = `<section id="plan"><h3><span class="mono n">${num()}</span>Что сделать в первую очередь${compare ? ` — ${esc(hostOf(own.url))}` : ""}</h3><ol class="actions">${actions
      .map((a) => `<li class="${a.level}"><div class="a-head"><span class="chip ${a.level}">${LEVEL[a.level]}</span><span class="tag">${BLOCKS[a.block]}</span></div><b>${hl(a.message)}</b>${a.hint ? `<div class="hint"><span class="mono">→</span> ${esc(a.hint)}</div>` : ""}</li>`)
      .join("")}</ol></section>`;
  }

  let aiHtml = "";
  if (input.ai) {
    toc.push(["ai", "Заключение ИИ"]);
    aiHtml = `<section id="ai" class="ai"><h3><span class="mono n">${num()}</span>Заключение экспертов (ИИ)</h3>${mdToHtml(input.ai)}</section>`;
  }

  let diffHtml = "";
  if (input.diffs?.length) {
    toc.push(["diff", "Изменения"]);
    diffHtml = `<section id="diff"><h3><span class="mono n">${num()}</span>Изменения с прошлой проверки</h3>${input.diffs
      .map((d) => {
        const dt = d.total.before !== null && d.total.after !== null ? d.total.after - d.total.before : null;
        return `<div class="diff"><h4>${esc(hostOf(d.url))} <span class="mono">${d.total.before ?? "—"} → ${d.total.after ?? "—"}</span>${dt ? ` <span class="badge ${dt > 0 ? "good" : "fail"}">${dt > 0 ? "+" : ""}${dt}</span>` : ""}</h4>${d.fixed.length ? `<ul class="findings">${d.fixed.map((f) => findingRow("ok", "Исправлено: " + f.message)).join("")}</ul>` : ""}${d.appeared.length ? `<ul class="findings">${d.appeared.map((f) => findingRow(f.level, "Появилось: " + f.message)).join("")}</ul>` : ""}${!d.fixed.length && !d.appeared.length ? `<p class="muted">Без изменений в ошибках и замечаниях.</p>` : ""}</div>`;
      })
      .join("")}</section>`;
  }

  const detailSites = sites.filter((s) => s.total !== null);
  if (detailSites.length) toc.push(["details", "Подробно"]);
  const details = detailSites
    .map(
      (s, si) => `<section class="details"${si === 0 ? ' id="details"' : ""}><h3><span class="mono n">${num()}</span>Подробно — ${esc(hostOf(s.url))}</h3>
${KEYS.map((k) => {
  const order = ["fail", "warn", "info", "ok"];
  const fs = [...s.blocks[k].findings].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const c = counts(s, k);
  return `<details${si === 0 && (c.fail || k === "compliance") ? " open" : ""}><summary><span class="s-name">${BLOCKS[k]}</span><span class="s-meta">${stack(c)}<span class="mono small muted">${c.fail ? `${c.fail} ош. · ` : ""}${c.warn ? `${c.warn} зам. · ` : ""}${c.ok} норм</span><span class="mono s-score ${verdict(s.blocks[k].score)[1]}">${s.blocks[k].score}</span></span></summary><ul class="findings">${fs.map((x) => findingRow(x.level, x.message, x.evidence, x.level === "fail" || x.level === "warn" ? HINTS[x.id] : undefined)).join("")}</ul>${k === "compliance" ? `<p class="small muted note">${esc(DISCLAIMER)}</p>` : ""}${k === "seo" ? `<p class="small muted note">Скорость измерена с компьютера, на котором запускалась проверка, и зависит от его сети.</p>` : ""}${k === "visual" ? palette(s) : ""}</details>`;
}).join("\n")}</section>`,
    )
    .join("\n");

  const fileName = `site-audit-${hostOf(own.url)}-${(own.collectedAt ?? "").slice(0, 10)}.html`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>${fontFaces()}
:root{--ink:#161616;--pencil:#5C5C5C;--axis:#9C9C9C;--plate:#E6E6E6;--signal:#FF5A1F;--signal-text:#C8410F;--warn:#B07A00;--warn-bg:#FFF6DD;--good:#2F7A4B;--bad-bg:#FFF0EA}
*{box-sizing:border-box}html{background:#fff;scroll-behavior:smooth}body{margin:0;color:var(--ink);font:400 15px/1.55 Geologica,system-ui,-apple-system,"Segoe UI",sans-serif}
.mono,code{font-family:"Martian Mono",ui-monospace,Consolas,monospace;font-size:.86em}.small{font-size:12.5px}.muted{color:var(--pencil)}b.v{font-weight:600;font-family:"Martian Mono",ui-monospace,monospace;font-size:.9em}
.sheet{max-width:1180px;margin:24px auto;border:3px solid var(--ink)}
header.top{display:flex;align-items:center;gap:16px;padding:20px 28px;border-bottom:1px solid var(--ink)}.logo{width:44px;height:44px}
header.top h1{font-size:26px;line-height:1.2;margin:0;font-weight:600}header.top .meta{margin-left:auto;text-align:right;color:var(--pencil)}
.toolbar{position:sticky;top:0;z-index:5;background:#fff;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;padding:10px 28px;border-bottom:1px solid var(--ink)}
.toolbar nav{display:flex;flex-wrap:wrap;gap:4px 16px}.toolbar nav a{color:var(--ink);text-decoration:none;font-size:13.5px;border-bottom:1px solid transparent}.toolbar nav a:hover{border-color:var(--ink)}
.toolbar .btns{margin-left:auto;display:flex;gap:8px}.btn{font:400 12px "Martian Mono",monospace;background:#fff;color:var(--ink);border:1px solid var(--ink);padding:7px 12px;cursor:pointer}.btn:hover,.btn.on{background:var(--ink);color:#fff}
main{padding:8px 28px 28px}section{margin:28px 0;scroll-margin-top:60px}h3{font-size:20px;font-weight:600;margin:0 0 14px;display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--ink);padding-bottom:8px}
h3 .n{color:var(--signal-text);font-size:13px}h4{font-size:16px;font-weight:600;margin:20px 0 10px}
.label{color:var(--pencil);text-transform:uppercase;letter-spacing:.04em;font-size:11px;display:block}
.mark{display:inline-block;width:9px;height:9px;margin-right:6px;vertical-align:0}.mark.fail{background:var(--signal)}.mark.warn{background:var(--warn)}.mark.good{background:var(--good)}
.chip{display:inline-block;font:400 10.5px "Martian Mono",monospace;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border:1px solid currentColor;white-space:nowrap}
.chip.fail{color:var(--signal-text);background:var(--bad-bg)}.chip.warn{color:var(--warn);background:var(--warn-bg)}.chip.good{color:var(--good)}.chip.info{color:var(--axis)}
.badge{display:inline-block;font:600 13px Geologica;padding:3px 10px;border:2px solid currentColor}.badge.good{color:var(--good)}.badge.warn{color:var(--warn)}.badge.fail{color:var(--signal-text)}
.fail.big,.fail.s-score{color:var(--signal-text)}.warn.big,.warn.s-score{color:var(--warn)}.good.big,.good.s-score{color:var(--good)}
/* Главное */
.key{border:3px solid var(--ink);padding:22px 24px;margin-top:22px}.key-grid{display:grid;grid-template-columns:1.1fr 1.2fr 1fr;gap:0}.key-grid>div{padding:0 22px;border-left:1px solid var(--ink)}.key-grid>div:first-child{padding-left:0;border-left:0}
.big-wrap{display:flex;align-items:baseline;gap:6px;margin:4px 0 8px}.huge{font-size:64px;line-height:1}.huge2{font-size:40px;line-height:1.1}.place{margin:4px 0 10px}
.cnt{font-size:15px;margin:6px 0}.cnt b{font-size:17px;margin-right:4px}
.stack{display:flex;height:8px;width:100%;max-width:220px;background:var(--plate);margin-top:6px}.stack.wide{max-width:none;height:10px;margin-top:12px}.stack span{display:block;height:100%}.stack .fail{background:var(--signal)}.stack .warn{background:var(--warn)}.stack .good{background:var(--good)}
.k-top{margin-top:20px;border-top:1px solid var(--ink);padding-top:14px}.k-top ol{margin:8px 0 0;padding:0;list-style:none;counter-reset:k}.k-top li{display:flex;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--axis)}.k-top li:last-child{border:0}
/* карточки */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));border-top:1px solid var(--ink);border-left:1px solid var(--ink)}
.card{margin:0;padding:18px;border-right:1px solid var(--ink);border-bottom:1px solid var(--ink)}.card-head h2{margin:2px 0;font-size:22px;font-weight:600}.card-head a{color:var(--pencil);text-decoration:none;word-break:break-all}
.card-body{margin-top:14px}.total{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap}.big{font-size:44px;line-height:1.1}.mini{margin-left:auto;color:var(--pencil)}.mini .mark{margin-left:6px}
.bars{display:grid;grid-template-columns:auto minmax(60px,1fr) 34px;gap:6px 12px;align-items:center}.bl{font-size:13px;color:var(--pencil);white-space:nowrap}
.gauge{position:relative;display:block;height:10px;overflow:hidden}.gauge .track{position:absolute;left:0;right:0;top:5px;border-top:1px solid var(--axis)}
.gauge .fill{position:absolute;left:0;top:3px;height:4px;background:var(--ink)}.gauge .fill.fail{background:var(--signal)}.gauge .fill.warn{background:var(--warn)}.gauge .fill.good{background:var(--ink)}.gauge .tick{position:absolute;top:1px;height:9px;border-left:1px solid var(--axis)}.num{text-align:right}
.shots{display:flex;gap:12px;margin-top:14px;align-items:flex-end}.shots figure{margin:0;flex:1}.shots figure.m{flex:0 0 26%}.shots img{width:100%;display:block;border:1px solid var(--ink)}figcaption{color:var(--pencil);margin-top:4px}
.warnline{border-left:4px solid var(--signal);background:var(--bad-bg);padding:8px 12px;margin:10px 0 0}
/* сравнение */
.cmp-grid{display:grid;grid-template-columns:440px 1fr;gap:24px;align-items:start}.radar{margin:0}.radar svg{width:100%;height:auto;font-family:Geologica}.radar figcaption{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px}.lg{display:inline-flex;align-items:center;gap:6px}.lg svg{display:block}
.scroll{overflow-x:auto}table.cmp{border-collapse:collapse;width:100%}table.cmp th,table.cmp td{border:1px solid var(--ink);padding:8px 10px;text-align:left}table.cmp th{font-weight:600;background:var(--plate)}
table.cmp td.best{font-weight:600;box-shadow:inset 0 -3px 0 var(--signal)}table.cmp tr.sum td{font-weight:600;border-top:3px solid var(--ink)}
.tag{display:inline-block;background:var(--plate);padding:1px 7px;font:400 11px "Martian Mono",monospace;color:var(--ink);white-space:nowrap}
ul.gaps{list-style:none;padding:0;margin:0}ul.gaps li{display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px dashed var(--axis)}
/* план */
ol.actions{padding-left:0;list-style:none;counter-reset:a;margin:0}ol.actions li{counter-increment:a;position:relative;padding:12px 0 12px 52px;border-bottom:1px dashed var(--axis)}
ol.actions li::before{content:counter(a,decimal-leading-zero);position:absolute;left:0;top:11px;font:400 20px "Martian Mono",monospace;color:var(--ink)}ol.actions li.fail::before{color:var(--signal-text)}
.a-head{display:flex;gap:8px;margin-bottom:4px}.hint{color:var(--pencil);font-size:13.5px;margin-top:4px}
/* подробно */
details{border-top:1px solid var(--ink)}details:last-of-type{border-bottom:1px solid var(--ink)}summary{cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;list-style:none}summary::-webkit-details-marker{display:none}
.s-name{font-weight:600}.s-name::before{content:"+ ";font-family:"Martian Mono",monospace;color:var(--pencil)}details[open] .s-name::before{content:"− "}.s-meta{display:flex;align-items:center;gap:14px}.s-meta .stack{width:140px;margin:0}.s-score{font-size:18px;min-width:34px;text-align:right}
ul.findings{list-style:none;padding:0;margin:0 0 12px}li.f{display:flex;gap:14px;padding:9px 0;border-top:1px solid var(--plate);align-items:baseline}li.f .chip{flex:0 0 92px;text-align:center}
li.f.ok .msg,li.f.info .msg{color:var(--pencil)}li.f.fail .msg{font-weight:600}
.ev{color:var(--pencil);font-size:11px;margin-top:4px;word-break:break-all}.note{margin:6px 0 14px}.swatches{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px}.sw{display:flex;align-items:center;gap:6px;font-size:11px}.sw i{width:22px;height:22px;border:1px solid var(--ink);display:inline-block}
.ai{border:1px solid var(--ink);padding:16px 20px}.ai h3{border:0}
body.only-issues li.f.ok,body.only-issues li.f.info{display:none}
p.soon{font-size:12px;color:var(--pencil);margin:10px 0 0;text-align:center}@media print{p.soon{display:none}}footer.stamp{display:grid;grid-template-columns:repeat(6,1fr);border-top:3px solid var(--ink)}footer.stamp div{padding:8px 12px;border-right:1px solid var(--ink)}footer.stamp div:last-child{border-right:0}footer.stamp b{display:block;font-weight:400;color:var(--pencil);font-size:11px}footer.stamp span{font-family:"Martian Mono",monospace;font-size:12px}
@media (max-width:860px){.key-grid{grid-template-columns:1fr}.key-grid>div{border-left:0;padding:12px 0;border-top:1px solid var(--plate)}.cmp-grid{grid-template-columns:1fr}}
@media (max-width:720px){main{padding:4px 14px 20px}header.top,.toolbar{padding:12px 14px}.s-meta .stack,.s-meta .small{display:none}li.f{flex-direction:column;gap:4px}footer.stamp{grid-template-columns:repeat(2,1fr)}footer.stamp div{border-bottom:1px solid var(--ink)}}
@media print{.toolbar{display:none}.sheet{margin:0;border-width:2px}details{break-inside:avoid}section{break-inside:avoid-page}a{color:inherit}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="sheet">
<header class="top">${LOGO}<div><span class="mono label">site-audit-ru · № 002</span><h1>${compare ? "Сравнение сайтов" : "Аудит сайта"}</h1></div><div class="meta mono small">${esc(date)}<br>${sites.length} ${sites.length === 1 ? "сайт" : sites.length < 5 ? "сайта" : "сайтов"}</div></header>
<div class="toolbar"><nav>${toc.map(([id, t]) => `<a href="#${id}">${t}</a>`).join("")}</nav><div class="btns"><button class="btn" id="only-issues" type="button">Только проблемы</button><button class="btn" id="dl" type="button" data-name="${esc(fileName)}">Скачать HTML</button><button class="btn" id="pr" type="button">Печать / PDF</button></div></div>
<main>
${keyPanel(sites)}
${cards}
${compareHtml}
${actionsHtml}
${aiHtml}
${diffHtml}
${details}
</main>
<footer class="stamp"><div><b>Разработчик</b><span>kozhevnikovai</span></div><div><b>Номер</b><span>№ 002</span></div><div><b>Объект</b><span>${esc(sites.map((s) => hostOf(s.url)).join(", ").slice(0, 80))}</span></div><div><b>Дата</b><span>${esc(date)}</span></div><div><b>Версия</b><span>${esc(own?.tool.version ?? "")}</span></div><div><b>Лицензия</b><span>MIT</span></div></footer>
<p class="soon">Скоро в платной версии: проверка по расписанию с уведомлениями, отчёт под брендом агентства, весь сайт целиком. <a href="https://github.com/kozhevnikovai/site-audit-ru#скоро" target="_blank" rel="noopener">Подробнее</a></p>
</div>${SCRIPT}</body></html>`;
}
