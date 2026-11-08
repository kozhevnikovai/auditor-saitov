import type { BlockResult, SiteRaw } from "../types.js";
import { block, f } from "./util.js";

const TYPES: [string, RegExp][] = [
  ["Контакты", /contact|kontakt|контакт/i],
  ["О компании", /about|o-kompanii|o-nas|company|о-компании|о-нас/i],
  ["Услуги", /service|uslug|услуг/i],
  ["Каталог", /catalog|katalog|shop|product|tovar|каталог/i],
  ["Цены", /price|ceny|tseny|prais|цены|прайс/i],
  ["Кейсы/портфолио", /case|portfolio|keys|proekt|project|работы|кейс/i],
  ["Отзывы", /review|otzyv|testimonial|отзыв/i],
  ["Блог/новости", /blog|news|novost|article|stat[ia]|статьи|новости/i],
  ["Вопросы", /faq|vopros|вопрос/i],
  ["Доставка/оплата", /delivery|dostavk|oplat|payment|доставк|оплат/i],
  ["Вакансии", /vacanc|career|vakans|rabota|вакан/i],
  ["Политика ПДн", /privacy|policy|politika|konfiden|персональн|политик/i],
];

export function pageType(url: string, title: string): string {
  const path = decodeURIComponent(new URL(url).pathname);
  if (path === "/" || path === "") return "Главная";
  const hit = TYPES.find(([, re]) => re.test(path)) ?? TYPES.find(([, re]) => re.test(title));
  return hit ? hit[0] : "Прочее";
}

export function analyzeStructure(raw: SiteRaw): BlockResult {
  const P = raw.pages.filter((p) => p.status < 400);
  const home = P[0];
  if (!home) return block([f("structure.no-pages", "fail", "Нет доступных страниц")], {});
  const out = [];

  out.push(home.viewport.includes("width=device-width") ? f("structure.viewport", "ok", "Есть мобильная адаптация (viewport)") : f("structure.viewport", "fail", "Нет meta viewport — сайт не адаптирован под телефоны"));
  if (home.horizontalOverflowMobile) out.push(f("structure.mobile-overflow", "warn", "На телефоне появляется горизонтальная прокрутка — что-то не помещается в экран"));
  else if (home.horizontalOverflowMobile === false) out.push(f("structure.mobile-overflow", "ok", "На телефоне нет горизонтальной прокрутки"));

  const nav = [...new Map(home.navLinks.map((l) => [l.text, l])).values()];
  out.push(nav.length >= 3 ? f("structure.nav", nav.length > 12 ? "warn" : "ok", `Меню: ${nav.length} пунктов${nav.length > 12 ? " — перегружено" : ""}`, nav.map((l) => l.text)) : f("structure.nav", "warn", "Меню не найдено или в нём меньше 3 пунктов"));

  const fold = home.ctas.filter((c) => c.top < 900);
  out.push(fold.length ? f("structure.cta-fold", "ok", "Призыв к действию есть на первом экране", fold.map((c) => c.text)) : f("structure.cta-fold", "warn", "На первом экране нет явной кнопки действия (заявка, звонок, купить)"));

  const formPages = P.filter((p) => p.forms.some((x) => x.fields.length >= 1));
  const minDepth = formPages.length ? Math.min(...formPages.map((p) => (p.depth < 0 ? 99 : p.depth))) : null;
  if (minDepth === null) out.push(f("structure.forms", "warn", "Не найдено ни одной формы заявки"));
  else out.push(minDepth <= 1 ? f("structure.forms", "ok", minDepth === 0 ? "Форма заявки есть на главной" : "До формы заявки — 1 клик") : f("structure.forms", "warn", `До формы заявки — ${minDepth} клика`));
  const fieldsCount = formPages.flatMap((p) => p.forms.map((x) => x.fields.length));
  if (fieldsCount.some((n) => n > 6)) out.push(f("structure.form-long", "warn", "Есть формы больше 6 полей — каждое лишнее поле снижает конверсию"));

  const phones = [...new Set(P.flatMap((p) => p.contacts.phones))];
  const emails = [...new Set(P.flatMap((p) => p.contacts.emails))];
  const msg = [...new Set(P.flatMap((p) => p.contacts.messengers))];
  out.push(phones.length ? f("structure.phone", "ok", "Телефон кликабельный", phones) : f("structure.phone", "warn", "Нет кликабельного телефона (tel:) — с мобильного неудобно позвонить"));
  out.push(home.contacts.phoneInHeader ? f("structure.phone-header", "ok", "Телефон в шапке") : f("structure.phone-header", "warn", "В шапке нет телефона"));
  out.push(msg.length ? f("structure.messengers", "ok", "Есть мессенджеры/соцсети", msg) : f("structure.messengers", "info", "Нет ссылок на мессенджеры (Telegram, WhatsApp, VK, MAX)"));
  if (emails.length) out.push(f("structure.email", "info", "Email", emails));

  const types = new Map<string, string[]>();
  for (const p of P) types.set(pageType(p.url, p.title), [...(types.get(pageType(p.url, p.title)) ?? []), p.url]);
  const has = (t: string) => types.has(t);
  out.push(has("Контакты") ? f("structure.contacts-page", "ok", "Есть страница контактов") : f("structure.contacts-page", "warn", "Не найдена страница контактов"));
  for (const t of ["Цены", "Отзывы", "Кейсы/портфолио", "Вопросы"]) if (!has(t)) out.push(f(`structure.missing.${t}`, "info", `Не найден раздел «${t}» — часто влияет на доверие и конверсию`));

  const deep = P.filter((p) => p.depth >= 4);
  if (deep.length) out.push(f("structure.deep", "warn", `${deep.length} стр. глубже 3 кликов от главной`, deep.map((p) => p.url)));
  const orphan = P.filter((p) => p.depth === -1);
  if (orphan.length) out.push(f("structure.orphan", "info", `${orphan.length} стр. есть в sitemap, но на них не ведут ссылки с проверенных страниц`, orphan.map((p) => p.url)));

  return block(out, {
    pageTypes: Object.fromEntries([...types.entries()].map(([k, v]) => [k, v.length])),
    nav: nav.map((l) => l.text),
    homeHeadings: home.headings.slice(0, 25),
    ctas: home.ctas.slice(0, 15),
    forms: formPages.map((p) => ({ url: p.url, forms: p.forms.map((x) => ({ fields: x.fields.map((y) => y.name || y.type), submit: x.submitText })) })),
    contacts: { phones, emails, messengers: msg },
    homeTextSample: home.bodyText.slice(0, 1500),
  });
}
