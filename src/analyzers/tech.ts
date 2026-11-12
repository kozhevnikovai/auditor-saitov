import type { BlockResult, SiteRaw } from "../types.js";
import { block, f } from "./util.js";

export interface Signature {
  name: string;
  category: "CMS/конструктор" | "Фреймворк" | "Аналитика" | "Реклама/пиксели" | "Коллтрекинг/сквозная" | "Чат/виджет" | "CRM" | "Карты/видео" | "Шрифты/CDN" | "Капча" | "Квизы/лидогенерация" | "Оплата" | "Рассылки/push" | "Онлайн-запись";
  hosts?: RegExp;
  html?: RegExp;
  globals?: RegExp;
  /** Сервис зарубежный — данные посетителей (IP, cookie) уходят за рубеж */
  foreign?: boolean;
}

export const SIGNATURES: Signature[] = [
  { name: "Tilda", category: "CMS/конструктор", hosts: /tildacdn|tilda\.ws/, html: /tildacdn|data-tilda-|class="t-records"/ },
  { name: "1С-Битрикс", category: "CMS/конструктор", html: /\/bitrix\/(js|templates|cache)/, globals: /^BX$/ },
  { name: "WordPress", category: "CMS/конструктор", html: /wp-content|wp-includes/, globals: /generator:WordPress/i },
  { name: "Joomla", category: "CMS/конструктор", html: /\/media\/jui\/|Joomla/i },
  { name: "OpenCart", category: "CMS/конструктор", html: /catalog\/view\/theme/ },
  { name: "InSales", category: "CMS/конструктор", hosts: /insales/ },
  { name: "Wix", category: "CMS/конструктор", hosts: /wixstatic|parastorage/ },
  { name: "Craftum", category: "CMS/конструктор", html: /craftum/i },
  { name: "Taplink", category: "CMS/конструктор", hosts: /taplink/ },
  { name: "Next.js", category: "Фреймворк", globals: /__NEXT_DATA__/, html: /\/_next\/static/ },
  { name: "Nuxt", category: "Фреймворк", globals: /__NUXT__/, html: /\/_nuxt\// },
  { name: "React", category: "Фреймворк", globals: /^react$/ },
  { name: "Vue", category: "Фреймворк", globals: /^(Vue|vue)$/ },
  { name: "Angular", category: "Фреймворк", globals: /^angular$/ },
  { name: "jQuery", category: "Фреймворк", globals: /^jQuery/ },
  { name: "Яндекс Метрика", category: "Аналитика", hosts: /mc\.yandex\.(ru|com)|mc\.webvisor/, globals: /^ym$/, html: /mc\.yandex\.ru\/(metrika|watch)|\bym\(\s*\d{6,}/ },
  { name: "Google Analytics", category: "Аналитика", hosts: /google-analytics\.com|analytics\.google\.com/, html: /gtag\/js\?id=G-|UA-\d{4,}/, foreign: true },
  { name: "Google Tag Manager", category: "Аналитика", hosts: /googletagmanager\.com/, foreign: true },
  { name: "Top.Mail.ru", category: "Аналитика", hosts: /top-fwz1\.mail\.ru|top\.mail\.ru/, globals: /^_tmr$/ },
  { name: "LiveInternet", category: "Аналитика", hosts: /counter\.yadro\.ru|liveinternet/ },
  { name: "Hotjar", category: "Аналитика", hosts: /hotjar/, foreign: true },
  { name: "Пиксель VK", category: "Реклама/пиксели", hosts: /vk\.com\/rtrg|top-fwz1\.mail\.ru\/js\/code/, html: /VK\.Retargeting/ },
  { name: "Пиксель Meta", category: "Реклама/пиксели", hosts: /connect\.facebook\.net/, globals: /^fbq$/, foreign: true },
  { name: "Яндекс Директ (конверсии)", category: "Реклама/пиксели", hosts: /an\.yandex\.ru|yandex\.ru\/ads/ },
  { name: "Roistat", category: "Коллтрекинг/сквозная", hosts: /roistat/, globals: /^roistat$/ },
  { name: "Calltouch", category: "Коллтрекинг/сквозная", hosts: /calltouch/, globals: /^ct$/ },
  { name: "CoMagic / UIS", category: "Коллтрекинг/сквозная", hosts: /comagic|uiscom/ },
  { name: "Callibri", category: "Коллтрекинг/сквозная", hosts: /callibri/ },
  { name: "Mango Office", category: "Коллтрекинг/сквозная", hosts: /mango-office|mangoweb/ },
  { name: "Jivo", category: "Чат/виджет", hosts: /jivosite|jivo\.ru|code\.jivo/, globals: /^jivo_api$/ },
  { name: "Carrot quest", category: "Чат/виджет", hosts: /carrotquest/, globals: /^carrotquest$/ },
  { name: "Envybox", category: "Чат/виджет", hosts: /envybox|envycrm/ },
  { name: "Битрикс24 (виджет)", category: "CRM", hosts: /bitrix24\.(ru|com)\/b\d|cdn-ru\.bitrix24|bitrix24\.ru\/crm/ },
  { name: "amoCRM", category: "CRM", hosts: /amocrm|kommo/ },
  { name: "Marquiz", category: "Квизы/лидогенерация", hosts: /marquiz/ },
  { name: "Яндекс Карты", category: "Карты/видео", hosts: /api-maps\.yandex|yandex\.ru\/map-widget/ },
  { name: "2GIS", category: "Карты/видео", hosts: /2gis/ },
  { name: "Google Maps", category: "Карты/видео", hosts: /maps\.googleapis|maps\.google/, foreign: true },
  { name: "YouTube", category: "Карты/видео", hosts: /youtube\.com|ytimg|youtube-nocookie/, foreign: true },
  { name: "VK Видео / Rutube", category: "Карты/видео", hosts: /vk\.com\/video_ext|vkvideo|rutube/ },
  { name: "Google Fonts", category: "Шрифты/CDN", hosts: /fonts\.(googleapis|gstatic)\.com/, foreign: true },
  { name: "Cloudflare CDN", category: "Шрифты/CDN", hosts: /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/, foreign: true },
  { name: "Nethouse", category: "CMS/конструктор", hosts: /nethouse/, html: /nethouse\.ru/ },
  { name: "uKit / uCoz", category: "CMS/конструктор", hosts: /ukit|ucoz|ulight/, html: /ucoz\.(ru|net)|ukit\.com/ },
  { name: "Flexbe", category: "CMS/конструктор", hosts: /flexbe/, html: /flexbe/ },
  { name: "LPgenerator", category: "CMS/конструктор", hosts: /lpgenerator/ },
  { name: "Битрикс24.Сайты", category: "CMS/конструктор", html: /bitrix24\.site|b24-site|landing-block/ },
  { name: "Ecwid", category: "CMS/конструктор", hosts: /ecwid/, globals: /^Ecwid$/ },
  { name: "Shopify", category: "CMS/конструктор", hosts: /cdn\.shopify|shopifycdn/, globals: /^Shopify$/, foreign: true },
  { name: "МойСклад (витрина)", category: "CMS/конструктор", hosts: /moysklad/ },
  { name: "SvelteKit", category: "Фреймворк", globals: /^__sveltekit/, html: /\/_app\/immutable\// },
  { name: "Microsoft Clarity", category: "Аналитика", hosts: /clarity\.ms/, foreign: true },
  { name: "myTarget", category: "Реклама/пиксели", hosts: /mytarget|ad\.mail\.ru/ },
  { name: "Ретаргетинг Яндекс Аудитории", category: "Реклама/пиксели", hosts: /audience\.yandex/ },
  { name: "Google Ads", category: "Реклама/пиксели", hosts: /googleadservices|doubleclick\.net/, html: /AW-\d{6,}/, foreign: true },
  { name: "Alloka", category: "Коллтрекинг/сквозная", hosts: /alloka/ },
  { name: "Calltracking.ru", category: "Коллтрекинг/сквозная", hosts: /calltracking\.ru/ },
  { name: "Telfin / Zadarma", category: "Коллтрекинг/сквозная", hosts: /zadarma|telfin/ },
  { name: "Битрикс24 (онлайн-чат)", category: "Чат/виджет", html: /b24-widget|bitrix24\.ru\/upload\/crm\/site_button/ },
  { name: "Talk-Me", category: "Чат/виджет", hosts: /talk-me/ },
  { name: "Verbox", category: "Чат/виджет", hosts: /verbox/ },
  { name: "LiveTex", category: "Чат/виджет", hosts: /livetex/ },
  { name: "Callback Hunter / RedConnect", category: "Чат/виджет", hosts: /callbackhunter|redconnect/ },
  { name: "Wazzup", category: "Чат/виджет", hosts: /wazzup/ },
  { name: "RetailCRM", category: "CRM", hosts: /retailcrm/ },
  { name: "Мегаплан", category: "CRM", hosts: /megaplan/ },
  { name: "Яндекс Формы", category: "Квизы/лидогенерация", hosts: /forms\.yandex/ },
  { name: "Quiz-online / Enquiz", category: "Квизы/лидогенерация", hosts: /quiz-online|enquiz/ },
  { name: "ЮKassa", category: "Оплата", hosts: /yookassa|yoomoney|yandex\.ru\/checkout/ },
  { name: "CloudPayments", category: "Оплата", hosts: /cloudpayments/ },
  { name: "Т-Касса (Тинькофф)", category: "Оплата", hosts: /securepay\.tinkoff|tbank\.ru|tinkoff\.ru\/(js|integration)/ },
  { name: "Robokassa", category: "Оплата", hosts: /robokassa/ },
  { name: "СБП / Сбер эквайринг", category: "Оплата", hosts: /securepayments\.sberbank|pay\.sber|qr\.nspk/ },
  { name: "Долями / Сплит", category: "Оплата", hosts: /dolyame|split\.yandex/ },
  { name: "Unisender", category: "Рассылки/push", hosts: /unisender/ },
  { name: "SendPulse", category: "Рассылки/push", hosts: /sendpulse/, foreign: true },
  { name: "Mindbox", category: "Рассылки/push", hosts: /mindbox/ },
  { name: "Gravitec / push4site", category: "Рассылки/push", hosts: /gravitec|push4site/ },
  { name: "YCLIENTS", category: "Онлайн-запись", hosts: /yclients/ },
  { name: "Dikidi", category: "Онлайн-запись", hosts: /dikidi/ },
  { name: "Medflex", category: "Онлайн-запись", hosts: /medflex/ },
  { name: "Google reCAPTCHA", category: "Капча", hosts: /recaptcha/, html: /grecaptcha|g-recaptcha/, foreign: true },
  { name: "Yandex SmartCaptcha", category: "Капча", hosts: /smartcaptcha/ },
];

export function detectTech(raw: SiteRaw): Signature[] {
  const html = raw.html + "\n" + raw.pages.flatMap((p) => [...p.scripts, ...p.iframes]).join("\n");
  return SIGNATURES.filter(
    (s) =>
      (s.hosts && raw.requestHosts.some((h) => s.hosts!.test(h))) ||
      (s.hosts && raw.pages.some((p) => [...p.scripts, ...p.iframes].some((u) => s.hosts!.test(u)))) ||
      (s.html && s.html.test(html)) ||
      (s.globals && raw.globals.some((g) => s.globals!.test(g))),
  );
}

export function analyzeTech(raw: SiteRaw): BlockResult {
  const found = detectTech(raw);
  const by = (c: Signature["category"]) => found.filter((s) => s.category === c).map((s) => s.name);
  const out = [];
  const cms = [...by("CMS/конструктор"), ...by("Фреймворк").filter((x) => x !== "jQuery")];
  out.push(f("tech.platform", "info", cms.length ? `Платформа: ${cms.join(", ")}` : "Платформа не определена (самописный сайт или скрыта)"));
  const an = by("Аналитика");
  out.push(an.includes("Яндекс Метрика") ? f("tech.metrika", "ok", "Установлена Яндекс Метрика") : f("tech.metrika", "warn", an.length ? "Не найдена Яндекс Метрика — в РФ это основной источник данных о трафике (если она грузится только после согласия на cookie, это нормально)" : "Не найдено систем аналитики (возможно, загружаются только после согласия на cookie)"));
  out.push(raw.https ? f("tech.https", "ok", "HTTPS") : f("tech.https", "fail", "Нет HTTPS"));
  const leadTools = [...by("Коллтрекинг/сквозная"), ...by("CRM"), ...by("Чат/виджет"), ...by("Квизы/лидогенерация"), ...by("Онлайн-запись")];
  out.push(leadTools.length ? f("tech.leads", "ok", "Инструменты работы с заявками", leadTools) : f("tech.leads", "info", "Не видно коллтрекинга, онлайн-чата или CRM-виджета"));
  const pay = by("Оплата");
  if (pay.length) out.push(f("tech.payments", "info", "Онлайн-оплата на сайте", pay));
  const book = by("Онлайн-запись");
  if (book.length) out.push(f("tech.booking", "info", "Онлайн-запись", book));
  const mail = by("Рассылки/push");
  if (mail.length) out.push(f("tech.mailing", "info", "Рассылки и push-уведомления", mail));
  const ads = by("Реклама/пиксели");
  if (ads.length) out.push(f("tech.ads", "info", "Рекламные пиксели — компания запускает рекламу", ads));
  const jq = raw.globals.find((g) => g.startsWith("jQuery@"));
  if (jq && /^jQuery@(1\.|2\.|3\.[0-4]\.)/.test(jq)) out.push(f("tech.jquery-old", "warn", `Устаревший ${jq.replace("@", " ")} — известные уязвимости`));
  out.push(f("tech.third-party", "info", `Сторонних доменов при загрузке: ${raw.requestHosts.filter((h) => !raw.origin.includes(h)).length}`));

  return block(out, {
    detected: found.map((s) => ({ name: s.name, category: s.category, foreign: !!s.foreign })),
    globals: raw.globals,
    thirdPartyHosts: raw.requestHosts.filter((h) => !raw.origin.includes(h)).slice(0, 60),
  });
}
