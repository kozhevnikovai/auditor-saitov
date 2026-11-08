import { chromium, type Browser } from "playwright-core";
import { existsSync } from "node:fs";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Yandex.app/Contents/MacOS/Yandex",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA ?? ""}\\Yandex\\YandexBrowser\\Application\\browser.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
];

/** Запускает установленный у пользователя Chrome/Chromium/Яндекс Браузер — без скачивания браузеров. */
export async function launchBrowser(chromePath?: string): Promise<Browser> {
  let last: unknown;
  const path = [chromePath, ...CANDIDATES].find((p) => p && existsSync(p));
  try {
    if (path) return await chromium.launch({ executablePath: path, headless: true });
  } catch {
    /* попробуем следующие варианты */
  }
  // Браузер, установленный через `npx playwright install chromium`, затем каналы chrome/msedge
  for (const o of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch({ ...o, headless: true });
    } catch (e) {
      last = e;
    }
  }
  {
    const e = last;
    throw new Error(
      "Не найден браузер. Нужен Google Chrome, Microsoft Edge, Яндекс Браузер или Chromium. Укажите путь: --chrome-path или переменная CHROME_PATH, либо выполните: npx playwright install chromium\n" +
        String((e as Error).message ?? e),
    );
  }
}
