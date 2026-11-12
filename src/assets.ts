import type { AssetSummary } from "./types.js";

export interface ResourceInfo {
  url: string;
  host: string;
  type: string;
  bytes: number;
  encoding: string;
  cache: string;
  status: number;
}

const TEXT = new Set(["script", "stylesheet", "document", "fetch", "xhr"]);
const STATIC = new Set(["script", "stylesheet", "image", "font"]);

/** Сводка по ресурсам страницы: вес по типам, сжатие, кэш, битые ресурсы */
export function summarizeAssets(res: ResourceInfo[], siteHost: string): AssetSummary {
  const own = (h: string) => h === siteHost || h.endsWith("." + siteHost) || siteHost.endsWith("." + h);
  const bytes = { js: 0, css: 0, img: 0, font: 0, other: 0 };
  let thirdPartyJsBytes = 0;
  const uncompressed: string[] = [];
  const noCache: string[] = [];
  const broken: string[] = [];
  for (const r of res) {
    const k = r.type === "script" ? "js" : r.type === "stylesheet" ? "css" : r.type === "image" ? "img" : r.type === "font" ? "font" : "other";
    bytes[k] += r.bytes;
    if (r.type === "script" && r.host && !own(r.host)) thirdPartyJsBytes += r.bytes;
    if (r.status >= 400 && r.type !== "document" && broken.length < 20) broken.push(`${r.status} ${r.url}`);
    if (!r.host || !own(r.host) || r.status >= 300) continue;
    if (TEXT.has(r.type) && r.type !== "fetch" && r.type !== "xhr" && r.bytes > 10_240 && !/(gzip|br|zstd|deflate)/.test(r.encoding) && uncompressed.length < 20) uncompressed.push(r.url);
    if (STATIC.has(r.type) && (!r.cache || /no-store|no-cache|max-age=0\b/.test(r.cache)) && noCache.length < 20) noCache.push(r.url);
  }
  return { bytes, thirdPartyJsBytes, uncompressed, noCache, broken };
}
