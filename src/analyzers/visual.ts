import type { BlockResult, SiteRaw } from "../types.js";
import { block, f } from "./util.js";

export function toHex(rgb: string): string {
  const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return rgb;
  return "#" + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function isGray(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) < 20;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10;
}

export function analyzeVisual(raw: SiteRaw): BlockResult {
  const v = raw.visual;
  const out = [];
  const colors = v.colors.map((c) => ({ ...c, hex: toHex(c.value) }));
  const accents = [...new Set(colors.filter((c) => !isGray(c.hex)).map((c) => c.hex))];
  const fonts = v.fonts.filter((x) => x.family);

  if (!colors.length) return block([f("visual.empty", "info", "Не удалось снять стили главной страницы")], {});

  out.push(fonts.length <= 3 ? f("visual.fonts", "ok", `Шрифтов: ${fonts.length}`, fonts.map((x) => x.family)) : f("visual.fonts", "warn", `Много шрифтов: ${fonts.length} — стиль разваливается`, fonts.map((x) => x.family)));
  out.push(v.fontSizes.length <= 8 ? f("visual.sizes", "ok", `Размеров текста: ${v.fontSizes.length} — шкала собранная`) : f("visual.sizes", "warn", `Размеров текста: ${v.fontSizes.length} — нет единой типографской шкалы`, v.fontSizes.map((s) => s.px + "px")));
  out.push(accents.length <= 4 ? f("visual.accents", "ok", `Акцентных цветов: ${accents.length}`, accents) : f("visual.accents", "warn", `Акцентных цветов: ${accents.length} — палитра пёстрая`, accents));
  const small = v.fontSizes.filter((s) => s.px < 14).reduce((a, s) => a + s.count, 0);
  const all = v.fontSizes.reduce((a, s) => a + s.count, 0);
  if (all && small / all > 0.3) out.push(f("visual.small-text", "warn", "Больше 30% текста мельче 14px — тяжело читать с телефона"));

  const mainText = colors.find((c) => c.role === "text")?.hex;
  const mainBg = colors.find((c) => c.role === "background")?.hex ?? "#FFFFFF";
  if (mainText) {
    const cr = contrast(mainText, mainBg);
    out.push(cr >= 4.5 ? f("visual.contrast", "ok", `Контраст основного текста ${cr}:1`) : f("visual.contrast", "warn", `Низкий контраст основного текста ${cr}:1 (норма WCAG ≥ 4,5)`, [`${mainText} на ${mainBg}`]));
  }
  if (v.radii.length) out.push(f("visual.radii", "info", "Скругления", v.radii.map((r) => r.value)));
  if (v.maxContentWidth) out.push(f("visual.width", "info", `Ширина контента ~${v.maxContentWidth}px при экране 1440px`));

  return block(out, {
    palette: colors.map((c) => ({ hex: c.hex, role: c.role, count: c.count })),
    accents,
    fonts,
    fontSizes: v.fontSizes,
    radii: v.radii,
    maxContentWidth: v.maxContentWidth,
    screenshots: v.screenshots,
  });
}
