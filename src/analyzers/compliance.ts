import type { BlockResult, SiteRaw } from "../types.js";
import { detectTech } from "./tech.js";
import { block, f } from "./util.js";

export const DISCLAIMER =
  "Это автоматические сигналы, а не юридическое заключение. Перед изменениями сверьтесь с юристом и актуальной редакцией законов.";

const POLICY_RE = /(политик|положени)[^\n]{0,40}(конфиденц|персональн|обработк)|privacy|politika|konfidenc|policy/i;
const CONSENT_DOC_RE = /согласи[ея][^\n]{0,40}(персональн|обработк)|soglasie|consent/i;
const ANALYTICS_COOKIES = /^(_ym_|_ga|_gid|_fbp|_tmr|roistat|_ct|_hj|tmr_)/i;

export function analyzeCompliance(raw: SiteRaw): BlockResult {
  const P = raw.pages.filter((p) => p.status < 400);
  if (!P.length) return block([f("law.no-pages", "fail", "Нет доступных страниц")], {});
  const out = [];
  const allLinks = P.flatMap((p) => [...p.internalLinks, ...p.externalLinks]);

  const policy = allLinks.find((l) => POLICY_RE.test(l.text + " " + decodeURIComponent(l.href)));
  out.push(policy ? f("law.policy", "ok", "Есть политика обработки персональных данных", [policy.href]) : f("law.policy", "fail", "Не найдена политика обработки персональных данных (152-ФЗ, ст. 18.1: её нужно опубликовать)"));

  const consentDoc = allLinks.find((l) => CONSENT_DOC_RE.test(l.text + " " + decodeURIComponent(l.href)) && l.href !== policy?.href);
  const forms = P.flatMap((p) => p.forms.filter((x) => x.personalFields).map((x) => ({ ...x, page: p.url })));
  if (!forms.length) out.push(f("law.forms", "info", "Форм со сбором персональных данных не найдено"));
  else {
    const noConsent = forms.filter((x) => !x.consentText && !x.consentCheckbox);
    out.push(noConsent.length ? f("law.consent", "fail", `Формы без согласия на обработку ПДн: ${noConsent.length} из ${forms.length}`, noConsent.map((x) => x.page)) : f("law.consent", "ok", "Во всех формах есть согласие на обработку ПДн"));
    const pre = forms.filter((x) => x.consentPrechecked);
    if (pre.length) out.push(f("law.prechecked", "warn", "Галочка согласия стоит заранее — согласие должно быть активным действием", pre.map((x) => x.page)));
    out.push(consentDoc ? f("law.consent-doc", "ok", "Согласие на обработку ПДн оформлено отдельным документом", [consentDoc.href]) : f("law.consent-doc", "warn", "Не найден отдельный документ согласия на обработку ПДн — с 1 сентября 2025 согласие оформляется отдельно от иных документов (152-ФЗ)"));
    if (!raw.https) out.push(f("law.https-forms", "fail", "Персональные данные из форм передаются без HTTPS"));
  }

  const analyticsCookies = raw.cookiesOnLoad.filter((c) => ANALYTICS_COOKIES.test(c.name) || c.thirdParty);
  const banner = P[0].cookieBanner;
  if (banner) out.push(f("law.cookie-banner", "ok", "Есть уведомление о cookie"));
  else if (analyticsCookies.length) out.push(f("law.cookie-banner", "warn", `Нет уведомления о cookie, а при загрузке ставятся cookie аналитики/третьих лиц: ${analyticsCookies.length}`, analyticsCookies.map((c) => `${c.name} (${c.domain})`)));
  else out.push(f("law.cookie-banner", "info", "Нет уведомления о cookie, но и cookie аналитики при загрузке не обнаружены"));

  const foreign = detectTech(raw).filter((s) => s.foreign).map((s) => s.name);
  out.push(foreign.length ? f("law.foreign", "warn", "Зарубежные сервисы получают данные посетителей (IP, cookie) — это может считаться трансграничной передачей ПДн, о которой нужно уведомлять Роскомнадзор", foreign) : f("law.foreign", "ok", "Зарубежных сервисов, получающих данные посетителей, не найдено"));

  const text = P.map((p) => p.footerText + " " + p.bodyText).join(" ");
  const inn = text.match(/ИНН[:\s№]*(\d{10}|\d{12})\b/i);
  const ogrn = text.match(/ОГРН(ИП)?[:\s№]*(\d{13}|\d{15})\b/i);
  out.push(inn || ogrn ? f("law.requisites", "ok", "На сайте указаны реквизиты", [inn?.[0], ogrn?.[0]].filter(Boolean) as string[]) : f("law.requisites", "warn", "Не найдены ИНН/ОГРН — при продаже товаров и услуг онлайн продавец обязан раскрыть сведения о себе (Закон о защите прав потребителей, ст. 8–9, 26.1)"));

  const erid = [...new Set(P.flatMap((p) => p.eridLinks))];
  if (erid.length) out.push(f("law.erid", "info", "Есть ссылки с маркировкой рекламы (erid)", erid));

  return block(out, {
    disclaimer: DISCLAIMER,
    policyUrl: policy?.href ?? null,
    consentDocUrl: consentDoc?.href ?? null,
    forms: forms.map((x) => ({ page: x.page, consentText: x.consentText, consentCheckbox: x.consentCheckbox, prechecked: x.consentPrechecked, policyLink: x.policyLink })),
    cookiesOnLoad: raw.cookiesOnLoad,
    foreignServices: foreign,
  });
}
