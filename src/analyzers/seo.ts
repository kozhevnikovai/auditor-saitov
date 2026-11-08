import type { BlockResult, SiteRaw } from "../types.js";
import { block, dups, f, pct } from "./util.js";

export function analyzeSeo(raw: SiteRaw): BlockResult {
  const P = raw.pages.filter((p) => p.status < 400);
  const home = raw.pages[0];
  const out = [];
  if (!home) return block([f("seo.no-pages", "fail", "Не удалось открыть ни одной страницы")], {});

  out.push(raw.https ? f("seo.https", "ok", "Сайт работает по HTTPS") : f("seo.https", "fail", "Сайт без HTTPS — Яндекс и браузеры помечают его как небезопасный"));
  out.push(raw.robotsTxt.found ? f("seo.robots", "ok", "Есть robots.txt") : f("seo.robots", "warn", "Нет robots.txt"));
  if (raw.robotsTxt.disallowedStart) out.push(f("seo.robots-block", "fail", "robots.txt запрещает Яндексу главную страницу"));
  out.push(raw.sitemap.found ? f("seo.sitemap", "ok", `Есть sitemap: ${raw.sitemap.urls} адресов`, [raw.sitemap.url!]) : f("seo.sitemap", "warn", "Не найден sitemap.xml — поисковикам сложнее находить страницы"));

  const noTitle = P.filter((p) => !p.title);
  const badTitle = P.filter((p) => p.title && (p.title.length < 10 || p.title.length > 70));
  out.push(noTitle.length ? f("seo.title-missing", "fail", `Нет title на ${noTitle.length} стр.`, noTitle.map((p) => p.url)) : f("seo.title-missing", "ok", "title есть на всех страницах"));
  if (badTitle.length) out.push(f("seo.title-length", "warn", `title короче 10 или длиннее 70 символов на ${badTitle.length} стр.`, badTitle.map((p) => `${p.url} (${p.title.length})`)));
  const dt = dups(P.map((p) => [p.title, p.url]));
  if (dt.length) out.push(f("seo.title-dup", "warn", "Одинаковые title на разных страницах", dt));

  const noDesc = P.filter((p) => !p.metaDescription);
  const badDesc = P.filter((p) => p.metaDescription && (p.metaDescription.length < 50 || p.metaDescription.length > 160));
  out.push(noDesc.length ? f("seo.desc-missing", pct(noDesc.length, P.length) > 50 ? "fail" : "warn", `Нет meta description на ${noDesc.length} из ${P.length} стр.`, noDesc.map((p) => p.url)) : f("seo.desc-missing", "ok", "meta description есть на всех страницах"));
  if (badDesc.length) out.push(f("seo.desc-length", "warn", `description короче 50 или длиннее 160 символов на ${badDesc.length} стр.`, badDesc.map((p) => p.url)));
  const dd = dups(P.map((p) => [p.metaDescription, p.url]));
  if (dd.length) out.push(f("seo.desc-dup", "warn", "Одинаковые description на разных страницах", dd));

  const h1Bad = P.filter((p) => p.h1.length !== 1);
  out.push(h1Bad.length ? f("seo.h1", h1Bad.includes(home) ? "fail" : "warn", `Не ровно один H1 на ${h1Bad.length} стр.`, h1Bad.map((p) => `${p.url} (H1: ${p.h1.length})`)) : f("seo.h1", "ok", "Ровно один H1 на каждой странице"));

  const noCanon = P.filter((p) => !p.canonical);
  out.push(noCanon.length ? f("seo.canonical", "warn", `Нет canonical на ${noCanon.length} стр.`, noCanon.map((p) => p.url)) : f("seo.canonical", "ok", "canonical указан"));
  out.push(home.lang ? f("seo.lang", "ok", `Язык страницы указан: ${home.lang}`) : f("seo.lang", "warn", "Не указан язык страницы (<html lang>)"));

  const noindex = P.filter((p) => /noindex/i.test(p.metaRobots));
  if (noindex.includes(home)) out.push(f("seo.noindex-home", "fail", "Главная закрыта от индексации (noindex)"));
  else if (noindex.length) out.push(f("seo.noindex", "info", `Закрыты от индексации: ${noindex.length} стр.`, noindex.map((p) => p.url)));

  const imgs = P.reduce((a, p) => a + p.images.total, 0);
  const noAlt = P.reduce((a, p) => a + p.images.noAlt, 0);
  if (imgs) out.push(pct(noAlt, imgs) > 30 ? f("seo.alt", "warn", `${pct(noAlt, imgs)}% изображений без alt (${noAlt} из ${imgs})`) : f("seo.alt", "ok", `alt заполнен у ${100 - pct(noAlt, imgs)}% изображений`));

  const ld = [...new Set(P.flatMap((p) => p.jsonLdTypes))];
  out.push(ld.length || P.some((p) => p.microdata) ? f("seo.schema", "ok", "Есть микроразметка", ld) : f("seo.schema", "warn", "Нет микроразметки schema.org — меньше шансов на расширенный сниппет (адрес, рейтинг, цены)"));
  out.push(home.og["og:title"] && home.og["og:image"] ? f("seo.og", "ok", "Есть Open Graph — ссылка красиво выглядит в мессенджерах") : f("seo.og", "warn", "Нет Open Graph (og:title/og:image) — ссылка в Telegram и VK без превью"));

  const broken = raw.pages.filter((p) => p.status >= 400);
  out.push(broken.length ? f("seo.broken", "fail", `Битые внутренние страницы: ${broken.length}`, broken.map((p) => `${p.url} (${p.status})`)) : f("seo.broken", "ok", "Битых страниц среди проверенных нет"));
  const thin = P.filter((p) => p.wordCount < 150 && p !== home);
  if (thin.length) out.push(f("seo.thin", "info", `Мало текста (<150 слов) на ${thin.length} стр.`, thin.map((p) => p.url)));

  // Скорость — по главной
  const pf = home.perf;
  if (pf) {
    out.push(pf.ttfbMs <= 800 ? f("seo.ttfb", "ok", `Сервер отвечает быстро: ${pf.ttfbMs} мс`) : f("seo.ttfb", pf.ttfbMs > 1800 ? "fail" : "warn", `Медленный ответ сервера: ${pf.ttfbMs} мс (норма ≤ 800)`));
    if (pf.lcpMs != null) out.push(pf.lcpMs <= 2500 ? f("seo.lcp", "ok", `LCP ${pf.lcpMs} мс`) : f("seo.lcp", pf.lcpMs > 4000 ? "fail" : "warn", `Главный блок грузится долго: LCP ${pf.lcpMs} мс (норма ≤ 2500)`));
    if (pf.cls != null) out.push(pf.cls <= 0.1 ? f("seo.cls", "ok", `Вёрстка стабильна: CLS ${pf.cls}`) : f("seo.cls", pf.cls > 0.25 ? "fail" : "warn", `Вёрстка «прыгает» при загрузке: CLS ${pf.cls} (норма ≤ 0,1)`));
    const mb = Math.round((pf.transferBytes / 1048576) * 10) / 10;
    if (pf.transferBytes) out.push(mb <= 3 ? f("seo.weight", "ok", `Вес главной ${mb} МБ, ${pf.requests} запросов`) : f("seo.weight", "warn", `Тяжёлая главная: ${mb} МБ, ${pf.requests} запросов`));
  }

  return block(out, {
    home: { url: home.url, title: home.title, description: home.metaDescription, h1: home.h1, headings: home.headings.slice(0, 25), og: home.og },
    pages: P.map((p) => ({ url: p.url, title: p.title, h1: p.h1[0] ?? "", words: p.wordCount })),
    jsonLdTypes: ld,
    perf: pf,
    sitemap: raw.sitemap,
  });
}
