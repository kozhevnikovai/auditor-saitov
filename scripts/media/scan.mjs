// Сцена «как Аудитор читает сайт»: настоящая главная страница + рамки блоков, которые он проверяет,
// с результатом из audit.json того же прогона. node scripts/media/scan.mjs <audit.json> <url>
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [auditPath, url, terms = ""] = process.argv.slice(2);
const OUT = "media/scan"; mkdirSync(OUT, { recursive: true });
const site = JSON.parse(readFileSync(auditPath, "utf8")).sites[0];
const all = Object.entries(site.blocks).flatMap(([block, b]) => b.findings.map(f => ({ ...f, block })));
const pick = ids => { for (const id of ids) { const f = all.find(x => x.id === id); if (f) return f; } return null; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url, { waitUntil: "networkidle", timeout: 60e3 }).catch(() => {}); await p.waitForTimeout(2500);
// замыливаем название, домен, телефоны и логотип (картинки и svg в шапке)
await p.evaluate(rx => {
  const r = new RegExp(rx, "gi"), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n = [];
  while (w.nextNode()) { r.lastIndex = 0; if (r.test(w.currentNode.nodeValue)) n.push(w.currentNode); }
  for (const t of n) { const s = document.createElement("span"); s.style.cssText = "filter:blur(6px)"; s.textContent = t.nodeValue; t.replaceWith(s); }
  const hd = document.querySelector("header") || document.body;
  hd.querySelectorAll('img, svg, [class*="logo" i]').forEach(e => { if (e.getBoundingClientRect().top < 200) e.style.filter = "blur(10px)"; });
}, [String.raw`\+?[78][\s\-(]*\d{3}[\s\-)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}`, ...terms.split(",").filter(Boolean)].join("|"));
const H = Math.min(2700, await p.evaluate(() => document.documentElement.scrollHeight));
const boxes = await p.evaluate(H => {
  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 20 && r.height > 10 && s.visibility !== "hidden" && s.display !== "none" && r.top + scrollY < H; };
  const box = (e, key) => { if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); return { key, rect: [r.left, r.top + scrollY, r.width, r.height].map(Math.round) }; };
  const q = s => [...document.querySelectorAll(s)].find(vis);
  const cta = [...document.querySelectorAll("a,button")].find(e => vis(e) && /заказ|купить|остав|получ|записат|консульт|заявк|начать|попробов|связат/i.test(e.textContent));
  const imgs = [...document.querySelectorAll("img")].filter(i => vis(i) && !i.getAttribute("alt")).slice(0, 2);
  const cookie = [...document.querySelectorAll("div,section,aside")].find(e => { const s = getComputedStyle(e); return (s.position === "fixed" || s.position === "sticky") && /cookie|куки/i.test(e.textContent) && e.getBoundingClientRect().height < 400; });
  const policy = [...document.querySelectorAll("a")].find(a => vis(a) && /политик|персональн|конфиденц/i.test(a.textContent));
  return [box(q("header") || q("nav"), "header"), box(q("h1"), "h1"), box(cta, "cta"), box(q('a[href^="tel:"]'), "phone"), box(q("form"), "form"),
    ...imgs.map(i => box(i, "img")), box(cookie, "cookie"), box(policy, "policy"), box(q("footer"), "footer")].filter(Boolean);
}, H);
const map = { header: ["structure.nav", "structure.phone-header"], h1: ["seo.h1"], cta: ["structure.cta-fold"], phone: ["structure.tel-type", "structure.phone"], form: ["law.consent", "structure.forms", "structure.labels"],
  img: ["seo.alt"], cookie: ["law.cookie-banner"], policy: ["law.policy"], footer: ["law.requisites", "law.policy"] };
const name = { header: "Шапка и меню", h1: "Заголовок H1", cta: "Кнопка заявки", phone: "Телефон", form: "Форма", img: "Картинка", cookie: "Cookie", policy: "Политика ПДн", footer: "Подвал и реквизиты" };
const out = boxes.map(x => { const f = pick(map[x.key]); return { ...x, name: name[x.key], level: f?.level ?? "info", message: f?.message ?? "" }; });
// финдинги, у которых нет элемента на странице (например, нет cookie-баннера) — отдельным списком
const missing = ["law.cookie-banner", "law.policy", "structure.forms", "structure.phone-header"].map(id => all.find(f => f.id === id && f.level !== "ok")).filter(Boolean).filter(f => !out.some(o => map[o.key].includes(f.id)));
await p.screenshot({ path: `${OUT}/page.jpg`, type: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1440, height: H }, fullPage: true });
writeFileSync(`${OUT}/scan.json`, JSON.stringify({ url, size: [1440, H], total: site.total, blocks: Object.fromEntries(Object.entries(site.blocks).map(([k, v]) => [k, v.score])), boxes: out, missing: missing.map(f => ({ id: f.id, level: f.level, message: f.message })) }, null, 1));
await b.close(); console.log(out.length, "блоков", missing.length, "без элемента");
