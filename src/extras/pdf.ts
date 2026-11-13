// PDF-отчёт: печать HTML-отчёта установленным браузером. Без сети: отчёт самодостаточный, любые запросы страницы блокируются.
import { readFileSync, writeFileSync } from "node:fs";
import { launchBrowser } from "../browser.js";

export async function htmlToPdf(htmlPath: string, pdfPath: string, chromePath?: string): Promise<string> {
  const browser = await launchBrowser(chromePath);
  try {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    // в PDF все подробности раскрыты, кнопки не нужны
    const html = readFileSync(htmlPath, "utf8").replace(/<details(?=[\s>])/g, "<details open").replace("</head>", "<style>.toolbar,button{display:none!important}</style></head>");
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } });
    writeFileSync(pdfPath, pdf);
    return pdfPath;
  } finally {
    await browser.close();
  }
}
