import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSites } from "../src/collect.js";
import type { SiteReport } from "../src/types.js";
import { serve } from "./server.js";

const fx = (n: string) => join(import.meta.dirname, "fixtures", n);
const lvl = (r: SiteReport, block: keyof SiteReport["blocks"], id: string) => r.blocks[block].findings.find((f) => f.id === id)?.level;

let good: SiteReport, bad: SiteReport, dead: SiteReport;
const servers: { close: () => Promise<void> }[] = [];
const out = mkdtempSync(join(tmpdir(), "sa-"));

beforeAll(async () => {
  const g = await serve(fx("good"));
  const b = await serve(fx("bad"));
  servers.push(g, b);
  const { reports } = await collectSites([g.url, b.url, "http://127.0.0.1:9"], { outDir: out, timeoutMs: 10_000 });
  [good, bad, dead] = reports;
}, 120_000);
afterAll(async () => Promise.all(servers.map((s) => s.close())));

describe("обход", () => {
  it("обходит все страницы хорошего сайта", () => expect(good.pagesCrawled).toBe(7));
  it("делает скриншоты", () => {
    const s = good.blocks.visual.data.screenshots as { desktop: string; mobile: string };
    expect(existsSync(s.desktop) && existsSync(s.mobile)).toBe(true);
  });
  it("хороший сайт оценён выше плохого", () => expect(good.total).toBeGreaterThan(bad.total + 30));
});

describe("SEO", () => {
  it("находит sitemap и robots", () => {
    expect(lvl(good, "seo", "seo.sitemap")).toBe("ok");
    expect(lvl(bad, "seo", "seo.robots")).toBe("warn");
  });
  it("ловит два H1 на главной", () => expect(lvl(bad, "seo", "seo.h1")).toBe("fail"));
  it("ловит дубли title", () => expect(lvl(bad, "seo", "seo.title-dup")).toBe("warn"));
  it("ловит битую страницу", () => expect(lvl(bad, "seo", "seo.broken")).toBe("fail"));
  it("видит микроразметку", () => expect(good.blocks.seo.data.jsonLdTypes).toContain("LocalBusiness"));
});

describe("структура", () => {
  it("видит форму на главной и CTA на первом экране", () => {
    expect(lvl(good, "structure", "structure.forms")).toBe("ok");
    expect(lvl(good, "structure", "structure.cta-fold")).toBe("ok");
  });
  it("ловит отсутствие viewport и длинную форму", () => {
    expect(lvl(bad, "structure", "structure.viewport")).toBe("fail");
    expect(lvl(bad, "structure", "structure.form-long")).toBe("warn");
  });
  it("определяет типы страниц", () => expect(good.blocks.structure.data.pageTypes).toMatchObject({ Главная: 1, Цены: 1, Отзывы: 1 }));
});

describe("визуальный стиль", () => {
  it("снимает шрифты и находит пёстрость", () => {
    expect(lvl(bad, "visual", "visual.fonts")).toBe("warn");
    expect(["warn", "fail"]).toContain(lvl(bad, "visual", "visual.contrast"));
    expect(lvl(good, "visual", "visual.contrast")).toBe("ok");
  });
});

describe("технологии", () => {
  it("определяет Метрику и Google", () => {
    const names = (r: SiteReport) => (r.blocks.tech.data.detected as { name: string }[]).map((d) => d.name);
    expect(names(good)).toContain("Яндекс Метрика");
    expect(names(bad)).toEqual(expect.arrayContaining(["Google Tag Manager", "Google Fonts"]));
    expect(lvl(bad, "tech", "tech.metrika")).toBe("warn");
  });
});

describe("1.2: сервисы, скорость, доступность", () => {
  it("определяет новые российские сервисы", () => {
    const names = (bad.blocks.tech.data.detected as { name: string }[]).map((d) => d.name);
    expect(names).toContain("Битрикс24 (онлайн-чат)");
  });
  it("меряет блокировку потока и вес по типам", () => {
    const pf = good.blocks.seo.data.perf as { tbtMs: number | null; assets: { bytes: { js: number } } };
    expect(typeof pf.tbtMs).toBe("number");
    expect(pf.assets.bytes).toBeDefined();
    expect(lvl(good, "seo", "seo.tbt")).toBe("ok");
  });
  it("поля без подписи и поле телефона type=text", () => {
    expect(lvl(bad, "structure", "structure.labels")).toBe("warn");
    expect(lvl(bad, "structure", "structure.tel-type")).toBe("warn");
    expect(lvl(good, "structure", "structure.labels")).toBe("ok");
  });
  it("мелкий шрифт полей на телефоне", () => {
    expect(lvl(bad, "structure", "structure.input-font")).toBe("warn");
    expect(lvl(good, "structure", "structure.input-font")).toBe("ok");
  });
});

describe("законы РФ", () => {
  it("хороший сайт проходит основные проверки", () => {
    for (const id of ["law.policy", "law.consent", "law.consent-doc", "law.cookie-banner", "law.requisites", "law.foreign"]) expect(lvl(good, "compliance", id), id).toBe("ok");
  });
  it("плохой сайт: нет политики, согласия, реквизитов; иностранные сервисы; cookie без уведомления", () => {
    expect(lvl(bad, "compliance", "law.policy")).toBe("fail");
    expect(lvl(bad, "compliance", "law.consent")).toBe("fail");
    expect(lvl(bad, "compliance", "law.requisites")).toBe("warn");
    expect(lvl(bad, "compliance", "law.foreign")).toBe("warn");
    expect(lvl(bad, "compliance", "law.cookie-banner")).toBe("warn");
  });
});

describe("устойчивость", () => {
  it("недоступный сайт не получает оценку", () => {
    expect(dead.limited).toBe("unreachable");
    expect(dead.total).toBeNull();
  });
  it("не заходит на страницы входа", () => {
    const urls = (good.blocks.seo.data.pages as { url: string }[]).map((p) => p.url);
    expect(urls.some((u) => u.includes("login"))).toBe(false);
  });
  it("видит согласие рядом с формой, а не только внутри неё", () => {
    const forms = good.blocks.compliance.data.forms as { page: string; consentText: boolean }[];
    expect(forms.find((x) => x.page.includes("contacts"))?.consentText).toBe(true);
  });
});
