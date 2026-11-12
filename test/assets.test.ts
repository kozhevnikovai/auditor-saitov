import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { summarizeAssets } from "../src/assets.js";
import { buildXlsx } from "../src/report/xlsx.js";

describe("ресурсы страницы", () => {
  it("находит несжатые, некэшируемые и битые файлы своего домена", () => {
    const a = summarizeAssets(
      [
        { url: "https://a.ru/app.js", host: "a.ru", type: "script", bytes: 50_000, encoding: "", cache: "", status: 200 },
        { url: "https://a.ru/s.css", host: "a.ru", type: "stylesheet", bytes: 20_000, encoding: "br", cache: "max-age=31536000", status: 200 },
        { url: "https://cdn.b.com/x.js", host: "cdn.b.com", type: "script", bytes: 30_000, encoding: "", cache: "", status: 200 },
        { url: "https://a.ru/no.png", host: "a.ru", type: "image", bytes: 0, encoding: "", cache: "", status: 404 },
      ],
      "a.ru",
    );
    expect(a.bytes.js).toBe(80_000);
    expect(a.thirdPartyJsBytes).toBe(30_000);
    expect(a.uncompressed).toEqual(["https://a.ru/app.js"]);
    expect(a.noCache).toEqual(["https://a.ru/app.js"]);
    expect(a.broken).toEqual(["404 https://a.ru/no.png"]);
  });
});

describe("XLSX", () => {
  it("собирает корректный zip с листами, текст «формулы» остаётся строкой", () => {
    const buf = buildXlsx([{ name: "Лист", widths: [10, 10], rows: [["A", "B"], ["=HYPERLINK(\"x\")", 5]] }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    // ищем лист и распаковываем
    const text = buf.toString("latin1");
    const i = text.indexOf("xl/worksheets/sheet1.xml");
    const nameLen = buf.readUInt16LE(i - 4);
    const comp = buf.readUInt32LE(i - 12);
    const xml = inflateRawSync(buf.subarray(i + nameLen, i + nameLen + comp)).toString("utf8");
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain("=HYPERLINK(&quot;x&quot;)");
    expect(xml).not.toContain("<f>");
    expect(xml).toContain("<v>5</v>");
  });
});
