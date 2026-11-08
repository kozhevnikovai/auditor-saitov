/**
 * Функции, которые выполняются внутри страницы (page.evaluate).
 * Должны быть самодостаточными: без импортов и замыканий.
 */

export function extractPage() {
  const q = (s: string) => Array.from(document.querySelectorAll(s));
  const meta = (sel: string) => (document.querySelector(sel) as HTMLMetaElement | null)?.content?.trim() ?? "";
  const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
  const origin = location.origin;

  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };

  const links = q("a[href]").map((a) => {
    const el = a as HTMLAnchorElement;
    return { href: el.href, text: clean(el.innerText || el.getAttribute("aria-label") || el.title).slice(0, 80) };
  });
  const internalLinks = links.filter((l) => l.href.startsWith(origin));
  const externalLinks = links.filter((l) => /^https?:/.test(l.href) && !l.href.startsWith(origin));
  const toLink = (a: Element) => ({ href: (a as HTMLAnchorElement).href, text: clean((a as HTMLElement).innerText).slice(0, 60) });
  let navLinks = q("nav a[href], header a[href], [role=navigation] a[href], [role=menubar] a[href]").filter(visible).map(toLink).filter((l) => l.text);
  if (navLinks.length < 3)
    navLinks = q('[class*="menu" i] a[href], [class*="nav" i] a[href], [class*="header" i] a[href], [id*="menu" i] a[href]')
      .filter(visible)
      .filter((a) => (a as HTMLElement).getBoundingClientRect().top + scrollY < 200)
      .map(toLink)
      .filter((l) => l.text && l.text.length < 40);
  if (navLinks.length < 3)
    navLinks = q("a[href]").filter(visible).filter((a) => { const t = (a as HTMLElement).getBoundingClientRect().top + scrollY; return t >= 0 && t < 140; }).map(toLink).filter((l) => l.text && l.text.length < 40);
  navLinks = Array.from(new Map(navLinks.map((l) => [l.text.toLowerCase(), l])).values());

  const jsonLdTypes: string[] = [];
  for (const s of q('script[type="application/ld+json"]')) {
    try {
      const walk = (o: unknown): void => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (o && typeof o === "object") {
          const t = (o as Record<string, unknown>)["@type"];
          if (typeof t === "string") jsonLdTypes.push(t);
          if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && jsonLdTypes.push(x));
          const g = (o as Record<string, unknown>)["@graph"];
          if (g) walk(g);
        }
      };
      walk(JSON.parse(s.textContent || ""));
    } catch {
      /* битый JSON-LD */
    }
  }

  const og: Record<string, string> = {};
  for (const m of q('meta[property^="og:"]')) og[m.getAttribute("property")!] = (m as HTMLMetaElement).content;

  const consentRe = /(согласи[еяю]|согласен|согласна|соглашаетесь|соглашаюсь|принимаете|принимаю|подтверждаю|подтверждаете)[^.]{0,160}(персональн|обработк|конфиденц|политик)/i;
  const context = (form: Element) => {
    let el: Element | null = form;
    let text = clean((form as HTMLElement).innerText);
    for (let i = 0; i < 3 && el?.parentElement; i++) {
      el = el.parentElement;
      const t = clean((el as HTMLElement).innerText);
      if (t.length > 4000) break;
      text = t;
    }
    return { text, el: el ?? form };
  };
  const policyRe = /(политик|положени)[^.]{0,40}(конфиденц|персональн|обработк)|privacy|policy|personal/i;
  const forms = q("form").map((f) => {
    const form = f as HTMLFormElement;
    const fields = Array.from(form.querySelectorAll("input, textarea, select"))
      .map((i) => {
        const el = i as HTMLInputElement;
        return { type: (el.type || el.tagName).toLowerCase(), name: el.name || el.placeholder || "", required: el.required };
      })
      .filter((x) => !["hidden", "submit", "button"].includes(x.type));
    const ctx = context(form);
    const text = ctx.text;
    const auth = !!form.querySelector('input[type="password"]') || /search|поиск/i.test(form.getAttribute("role") ?? "") || !!form.querySelector('input[type="search"]');
    const personalFields = fields.some(
      (x) => ["tel", "email"].includes(x.type) || /phone|tel|mail|name|имя|телефон|фио/i.test(x.name),
    );
    const boxes = Array.from(ctx.el.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const consentBox = boxes.find((b) => consentRe.test(clean(b.closest("label")?.innerText || b.parentElement?.innerText)));
    return {
      action: form.action || "",
      fields,
      personalFields: personalFields && !auth,
      consentText: consentRe.test(text),
      consentCheckbox: !!consentBox,
      consentPrechecked: !!consentBox && consentBox.defaultChecked,
      policyLink: Array.from(ctx.el.querySelectorAll("a")).some((a) => policyRe.test(clean((a as HTMLElement).innerText) + " " + (a as HTMLAnchorElement).href)),
      submitText: clean((form.querySelector('button, input[type="submit"]') as HTMLElement | null)?.innerText || (form.querySelector('input[type="submit"]') as HTMLInputElement | null)?.value).slice(0, 60),
    };
  });

  const ctaRe = /(заказ|купить|оставить|получить|записат|заявк|консультац|рассчитат|узнать|позвон|связат|начать|попробова|подобрать|создать|зарегистр|подключ|оформ|выбрать курс|бесплатн|демо|order|buy|get|start|contact|book|try|sign up)/i;
  const ctas = q("button, a, input[type=submit]")
    .filter((el) => visible(el))
    .map((el) => ({ text: clean((el as HTMLElement).innerText || (el as HTMLInputElement).value).slice(0, 60), top: Math.round((el as HTMLElement).getBoundingClientRect().top + scrollY) }))
    .filter((c) => c.text && c.text.length < 50 && ctaRe.test(c.text))
    .slice(0, 30);

  const phones = Array.from(new Set(links.filter((l) => l.href.startsWith("tel:")).map((l) => l.href.slice(4))));
  const emails = Array.from(new Set(links.filter((l) => l.href.startsWith("mailto:")).map((l) => l.href.slice(7).split("?")[0])));
  const messengers = Array.from(
    new Set(
      links
        .map((l) => l.href)
        .filter((h) => /(t\.me|telegram\.me|wa\.me|whatsapp|vk\.com|vk\.me|max\.ru|viber)/i.test(h))
        .map((h) => new URL(h).hostname),
    ),
  );
  const header = document.querySelector("header") ?? document.body.firstElementChild;
  const phoneInHeader = !!header && (/\+?\d[\d\s()-]{9,}\d/.test((header as HTMLElement).innerText || "") || !!header.querySelector('a[href^="tel:"]'));

  const bodyText = clean(document.body?.innerText);
  const footer = document.querySelector("footer") ?? document.body.lastElementChild;
  const fixedEls = q("div, section, aside").filter((el) => {
    const p = getComputedStyle(el).position;
    return (p === "fixed" || p === "sticky") && visible(el);
  });
  const cookieBanner = fixedEls.some((el) => /cookie|куки|файл(ы|ов) cookie/i.test((el as HTMLElement).innerText || ""));

  return {
    title: clean(document.title),
    metaDescription: meta('meta[name="description" i]'),
    metaRobots: meta('meta[name="robots" i]') + (meta('meta[name="yandex" i]') ? " yandex:" + meta('meta[name="yandex" i]') : ""),
    canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ?? "",
    lang: document.documentElement.lang || "",
    viewport: meta('meta[name="viewport"]'),
    h1: q("h1").map((h) => clean((h as HTMLElement).innerText)).filter(Boolean),
    headings: q("h1,h2,h3").map((h) => ({ level: Number(h.tagName[1]), text: clean((h as HTMLElement).innerText).slice(0, 120) })).filter((h) => h.text).slice(0, 60),
    og,
    jsonLdTypes,
    microdata: !!document.querySelector("[itemscope]"),
    images: { total: q("img").length, noAlt: q("img").filter((i) => !(i.getAttribute("alt") ?? "").trim()).length },
    internalLinks: internalLinks.slice(0, 300),
    externalLinks: externalLinks.slice(0, 100),
    navLinks: navLinks.slice(0, 40),
    forms,
    ctas,
    contacts: { phones, emails, messengers, phoneInHeader },
    scripts: q("script[src]").map((s) => (s as HTMLScriptElement).src),
    iframes: q("iframe[src]").map((s) => (s as HTMLIFrameElement).src),
    bodyText: bodyText.slice(0, 3000),
    footerText: clean((footer as HTMLElement | null)?.innerText).slice(0, 1500),
    wordCount: bodyText.split(" ").filter(Boolean).length,
    cookieBanner,
    eridLinks: links.map((l) => l.href).filter((h) => /[?&]erid=/i.test(h)).slice(0, 20),
  };
}

export function extractVisual() {
  const els = Array.from(document.querySelectorAll("body *")).slice(0, 3000) as HTMLElement[];
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const text = new Map<string, number>();
  const bg = new Map<string, number>();
  const border = new Map<string, number>();
  const fonts = new Map<string, number>();
  const sizes = new Map<string, number>();
  const radii = new Map<string, number>();
  let maxWidth = 0;
  const bgOf = (start: HTMLElement): string | null => {
    let e: HTMLElement | null = start;
    while (e) {
      const c = getComputedStyle(e);
      if (c.backgroundImage && c.backgroundImage !== "none") return null;
      if (c.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(c.backgroundColor)) {
        const a = c.backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\)/);
        if (!a || Number(a[1]) > 0.9) return c.backgroundColor;
      }
      e = e.parentElement;
    }
    return "rgb(255, 255, 255)";
  };
  const pairs = new Map<string, number>();
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
    if (hasText) {
      inc(text, cs.color);
      inc(fonts, cs.fontFamily.split(",")[0].replace(/["']/g, "").trim());
      inc(sizes, String(Math.round(parseFloat(cs.fontSize))));
      const bgc = bgOf(el);
      if (bgc && parseFloat(cs.opacity) > 0.5) inc(pairs, cs.color + "|" + bgc);
    }
    if (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) inc(bg, cs.backgroundColor);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") inc(border, cs.borderTopColor);
    if (cs.borderRadius && cs.borderRadius !== "0px") inc(radii, cs.borderRadius);
    if (r.width < innerWidth - 1 && r.width > maxWidth && el.children.length > 1) maxWidth = Math.round(r.width);
  }
  const top = (m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    colors: [
      ...top(text, 8).map(([value, count]) => ({ value, count, role: "text" as const })),
      ...top(bg, 8).map(([value, count]) => ({ value, count, role: "background" as const })),
      ...top(border, 4).map(([value, count]) => ({ value, count, role: "border" as const })),
    ],
    fonts: top(fonts, 6).map(([family, count]) => ({ family, count })),
    textPairs: top(pairs, 40).map(([k, count]) => ({ color: k.split("|")[0], background: k.split("|")[1], count })),
    fontSizes: top(sizes, 24).map(([px, count]) => ({ px: Number(px), count })).sort((a, b) => a.px - b.px),
    radii: top(radii, 6).map(([value, count]) => ({ value, count })),
    maxContentWidth: maxWidth,
  };
}

export function extractGlobals() {
  const w = window as unknown as Record<string, unknown>;
  const names = ["ym", "Ya", "gtag", "dataLayer", "jQuery", "__NEXT_DATA__", "__NUXT__", "BX", "tilda", "t_onReady", "Vue", "angular", "wp", "Shopify", "jivo_api", "roistat", "ct", "carrotquest", "_tmr", "VK", "fbq", "hj", "Tilda"];
  const found = names.filter((n) => typeof w[n] !== "undefined");
  const jq = (w.jQuery as { fn?: { jquery?: string } } | undefined)?.fn?.jquery;
  if (jq) found.push("jQuery@" + jq);
  if (document.querySelector("[ng-version]")) found.push("angular");
  if (document.querySelector("[data-reactroot], #__next")) found.push("react");
  if (document.querySelector("[data-v-app], #__nuxt")) found.push("vue");
  const gen = (document.querySelector('meta[name="generator"]') as HTMLMetaElement | null)?.content;
  if (gen) found.push("generator:" + gen);
  return found;
}

export const PERF_INIT = `
  window.__sa = { lcp: null, cls: 0 };
  try {
    new PerformanceObserver((l) => { const e = l.getEntries(); const last = e[e.length - 1]; if (last) window.__sa.lcp = last.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__sa.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
`;

export function extractPerf() {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const sa = (window as unknown as { __sa?: { lcp: number | null; cls: number } }).__sa;
  return {
    ttfbMs: nav ? Math.round(nav.responseStart - nav.startTime) : 0,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : 0,
    loadMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0,
    lcpMs: sa?.lcp != null ? Math.round(sa.lcp) : null,
    cls: sa ? Math.round(sa.cls * 1000) / 1000 : null,
  };
}

export function mobileOverflow() {
  return document.documentElement.scrollWidth > window.innerWidth + 2;
}
