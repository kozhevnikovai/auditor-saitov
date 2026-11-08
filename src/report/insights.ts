import type { Finding, Level, SiteReport } from "../types.js";

export const BLOCKS = {
  seo: "SEO и скорость",
  structure: "Структура и конверсия",
  visual: "Визуальный стиль",
  tech: "Технологии",
  compliance: "Законы РФ",
} as const;
export type BlockKey = keyof typeof BLOCKS;
export const BLOCK_KEYS = Object.keys(BLOCKS) as BlockKey[];

const WEIGHT: Record<BlockKey, number> = { compliance: 5, seo: 4, structure: 4, tech: 2, visual: 2 };
const RANK: Record<Level, number> = { fail: 0, warn: 1, info: 2, ok: 3 };

/** Короткие подсказки «как исправить» для частых находок */
export const HINTS: Record<string, string> = {
  "seo.https": "Подключите бесплатный сертификат Let's Encrypt у хостинга и настройте 301-редирект на https.",
  "seo.sitemap": "Сгенерируйте sitemap.xml (в CMS обычно есть настройка) и укажите его в robots.txt и Яндекс Вебмастере.",
  "seo.robots": "Создайте robots.txt с директивой Sitemap.",
  "seo.title-missing": "Пропишите уникальный title для каждой страницы: ключевая фраза + город/бренд, до 70 символов.",
  "seo.title-dup": "Сделайте title уникальными — одинаковые заголовки мешают поисковику различать страницы.",
  "seo.desc-missing": "Добавьте meta description 120–160 символов с выгодой и призывом — это текст сниппета в поиске.",
  "seo.h1": "На каждой странице должен быть ровно один H1, отражающий её суть.",
  "seo.canonical": "Добавьте <link rel=\"canonical\"> — защищает от дублей с UTM-метками и фильтрами.",
  "seo.schema": "Добавьте микроразметку Organization/LocalBusiness (адрес, телефон, часы работы) в JSON-LD.",
  "seo.og": "Добавьте og:title, og:description и og:image 1200×630 — ссылка будет с превью в Telegram и VK.",
  "seo.broken": "Исправьте или уберите ссылки на несуществующие страницы, настройте 301-редиректы.",
  "seo.ttfb": "Включите кэширование страниц на сервере/CDN, проверьте тариф хостинга.",
  "seo.lcp": "Сожмите главное изображение первого экрана (WebP/AVIF), уберите тяжёлые слайдеры, подключайте скрипты с defer.",
  "seo.cls": "Задайте размеры изображениям и баннерам, чтобы вёрстка не сдвигалась при загрузке.",
  "seo.weight": "Сожмите изображения и видео, уберите неиспользуемые скрипты и шрифты.",
  "seo.alt": "Заполните alt у изображений — это и SEO, и доступность.",
  "seo.noindex-home": "Уберите noindex с главной — сейчас она не попадает в поиск.",
  "structure.viewport": "Добавьте <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> и адаптивную вёрстку.",
  "structure.mobile-overflow": "Найдите блок шире экрана (часто таблицы и картинки) и ограничьте max-width: 100%.",
  "structure.cta-fold": "Поставьте на первый экран одну заметную кнопку с конкретным действием: «Рассчитать стоимость», «Записаться».",
  "structure.forms": "Добавьте короткую форму заявки на главную или в 1 клик от неё.",
  "structure.form-long": "Сократите форму до 2–3 полей (имя, телефон) — остальное уточнит менеджер.",
  "structure.phone": "Оформите телефон ссылкой tel:+7… — с мобильного позвонят в одно касание.",
  "structure.phone-header": "Выведите телефон в шапку сайта.",
  "structure.nav": "Оставьте в меню 5–7 главных разделов, остальное — в подвал.",
  "structure.contacts-page": "Сделайте страницу контактов: адрес, карта, телефон, мессенджеры, реквизиты.",
  "visual.fonts": "Оставьте 1–2 шрифта: один для заголовков, один для текста.",
  "visual.sizes": "Сведите размеры текста к шкале из 5–7 значений (например 14/16/20/28/40).",
  "visual.accents": "Оставьте 1–2 акцентных цвета, остальное — оттенки серого.",
  "visual.contrast": "Затемните серый текст до контраста 4,5:1 и выше (проверка: webaim.org/resources/contrastchecker).",
  "visual.small-text": "Основной текст — не меньше 16px на телефоне.",
  "tech.metrika": "Установите Яндекс Метрику с целями на заявки и звонки — без неё не понять, откуда клиенты.",
  "tech.jquery-old": "Обновите jQuery до 3.7+ или уберите его, если не используется.",
  "law.policy": "Опубликуйте политику обработки персональных данных и дайте ссылку в подвале и у каждой формы.",
  "law.consent": "Добавьте у каждой формы неотмеченную галочку согласия со ссылкой на текст согласия.",
  "law.prechecked": "Уберите галочку по умолчанию — согласие должно ставить сам посетитель.",
  "law.consent-doc": "Вынесите согласие на обработку ПДн в отдельный документ (не внутри политики или оферты).",
  "law.cookie-banner": "Добавьте уведомление о cookie и подгружайте аналитику после согласия.",
  "law.foreign": "Замените зарубежные сервисы на российские (Google Fonts → свои файлы шрифтов, reCAPTCHA → SmartCaptcha, GA → Метрика) или уведомите РКН о трансграничной передаче.",
  "law.requisites": "Укажите в подвале наименование, ИНН и ОГРН/ОГРНИП.",
  "law.https-forms": "Переведите сайт на HTTPS — формы с персональными данными нельзя отправлять открытым текстом.",
};

export interface Action {
  site: string;
  block: BlockKey;
  level: Level;
  id: string;
  message: string;
  hint?: string;
  evidence?: string[];
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Главные действия по сайту: сначала ошибки, затем замечания; внутри — по весу блока */
export function topActions(r: SiteReport, limit = 10): Action[] {
  const all: Action[] = [];
  for (const b of BLOCK_KEYS)
    for (const x of r.blocks[b].findings)
      if (x.level === "fail" || x.level === "warn") all.push({ site: r.url, block: b, level: x.level, id: x.id, message: x.message, hint: HINTS[x.id], evidence: x.evidence });
  return all.sort((a, b) => RANK[a.level] - RANK[b.level] || WEIGHT[b.block] - WEIGHT[a.block]).slice(0, limit);
}

export interface Gap {
  block: BlockKey;
  competitor: string;
  theirs: string;
  yours: string;
}

/** Где конкуренты сильнее: у вас ошибка/замечание, у конкурента по той же проверке — норма */
export function competitorGaps(own: SiteReport, others: SiteReport[], limit = 12): Gap[] {
  const gaps: Gap[] = [];
  for (const b of BLOCK_KEYS)
    for (const mine of own.blocks[b].findings) {
      if (mine.level !== "fail" && mine.level !== "warn") continue;
      for (const o of others) {
        if (o.total === null) continue;
        const t = o.blocks[b].findings.find((x) => x.id === mine.id);
        if (t && t.level === "ok") {
          gaps.push({ block: b, competitor: hostOf(o.url), theirs: t.message, yours: mine.message });
          break;
        }
      }
    }
  return gaps.sort((a, b) => WEIGHT[b.block] - WEIGHT[a.block]).slice(0, limit);
}

export interface Diff {
  url: string;
  total: { before: number | null; after: number | null };
  blocks: Record<BlockKey, { before: number; after: number }>;
  fixed: Finding[];
  appeared: Finding[];
}

/** Изменения относительно прошлого прогона (мониторинг своего сайта и конкурентов) */
export function diffReports(before: SiteReport[], after: SiteReport[]): Diff[] {
  const out: Diff[] = [];
  for (const a of after) {
    const b = before.find((x) => hostOf(x.url) === hostOf(a.url));
    if (!b) continue;
    const key = (f: Finding) => f.id;
    const bad = (r: SiteReport) => BLOCK_KEYS.flatMap((k) => r.blocks[k].findings.filter((f) => f.level === "fail" || f.level === "warn"));
    const was = new Map(bad(b).map((f) => [key(f), f]));
    const now = new Map(bad(a).map((f) => [key(f), f]));
    out.push({
      url: a.url,
      total: { before: b.total, after: a.total },
      blocks: Object.fromEntries(BLOCK_KEYS.map((k) => [k, { before: b.blocks[k].score, after: a.blocks[k].score }])) as Diff["blocks"],
      fixed: [...was.entries()].filter(([k]) => !now.has(k)).map(([, f]) => f),
      appeared: [...now.entries()].filter(([k]) => !was.has(k)).map(([, f]) => f),
    });
  }
  return out;
}
