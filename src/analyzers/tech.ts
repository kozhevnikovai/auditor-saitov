import type { BlockResult, SiteRaw } from "../types.js";
import { block, f } from "./util.js";

export interface Signature {
  name: string;
  category: "CMS/конструктор" | "Фреймворк" | "Аналитика" | "Реклама/пиксели" | "Коллтрекинг/сквозная" | "Чат/виджет" | "CRM" | "Карты/видео" | "Шрифты/CDN" | "Капча" | "Квизы/лидогенерация";
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
  const leadTools = [...by("Коллтрекинг/сквозная"), ...by("CRM"), ...by("Чат/виджет"), ...by("Квизы/лидогенерация")];
  out.push(leadTools.length ? f("tech.leads", "ok", "Инструменты работы с заявками", leadTools) : f("tech.leads", "info", "Не видно коллтрекинга, онлайн-чата или CRM-виджета"));
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
