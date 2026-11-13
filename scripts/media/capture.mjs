// Съёмка настоящего отчёта для README и роликов. Сайты реальные; домены, названия и логотипы замыливаются.
// node scripts/media/capture.mjs <папка отчёта> <терминал.log> "термин1,термин2,…"
import { chromium } from "playwright-core";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const [dir, termLog, terms] = process.argv.slice(2);
const OUT = "media"; mkdirSync(OUT, { recursive: true });
const words = terms.split(",").map(s => s.trim()).filter(Boolean);
const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
const mask = rx => {
  const r = new RegExp(rx, "gi"), walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), nodes = [];
  while (walk.nextNode()) if (r.test(walk.currentNode.nodeValue)) nodes.push(walk.currentNode), (r.lastIndex = 0);
  for (const n of nodes) { const s = document.createElement("span"); s.innerHTML = n.nodeValue.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(r, m => `<span style="filter:blur(6px);background:#E6E6E6">${m}</span>`); n.replaceWith(s); }
  for (const a of document.querySelectorAll("a[href]")) if (r.test(a.href)) a.removeAttribute("href");
  // логотип обычно в шапке сайта — замыливаем верх скриншотов сайта
  for (const img of document.querySelectorAll(".shots img")) { const f = img.parentElement; f.style.position = "relative"; const d = document.createElement("div"); d.style.cssText = "position:absolute;left:0;right:0;top:0;height:14%;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)"; f.append(d); }
  document.querySelectorAll("link[rel*=icon], img[src*=favicon]").forEach(e => e.remove());
};
const html = readdirSync(dir).find(f => f.endsWith(".html"));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT + "/raw", size: { width: 1280, height: 800 } } });
await p.goto("file://" + join(process.cwd(), dir, html)); await p.waitForTimeout(800);
await p.evaluate(mask, re.source);
await p.screenshot({ path: `${OUT}/report.png` });
// разделы отчёта по заголовкам
const heads = await p.$$eval("h2, h3", hs => hs.map((h, i) => ({ i, t: h.textContent.trim() })));
writeFileSync(`${OUT}/sections.json`, JSON.stringify(heads, null, 1));
const want = { compare: /сравнен|конкурент/i, speed: /скорост|CrUX|посетител/i, law: /закон|152|cookie/i, findings: /находк|исправ|что делать/i };
for (const [name, rx] of Object.entries(want)) {
  const h = heads.find(x => rx.test(x.t)); if (!h) continue;
  await p.evaluate(i => document.querySelectorAll("h2, h3")[i].scrollIntoView({ block: "start" }), h.i);
  await p.evaluate(() => window.scrollBy(0, -24)); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/report-${name}.png` });
}
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400);
for (let i = 0; i < 24; i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(350); }
const v = p.video(); await p.close();
// PDF — первая страница
const pdf = readdirSync(dir).find(f => f.endsWith(".pdf"));
if (pdf) { const q = await b.newPage({ viewport: { width: 1000, height: 1300 } }); await q.goto("file://" + join(process.cwd(), dir, pdf)).catch(() => {}); await q.waitForTimeout(1500); await q.screenshot({ path: `${OUT}/pdf.png` }).catch(() => {}); }
await b.close();
// лог терминала — с замыливанием
writeFileSync(`${OUT}/terminal.txt`, readFileSync(termLog, "utf8").replace(re, m => "█".repeat(Math.min(m.length, 12))));
console.log("ok", await v.path());
