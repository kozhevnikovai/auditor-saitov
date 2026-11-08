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
  `${process.env.LOCALAPPDATA ?? ""}\\Yandex\\YandexBrowser\\Application\\browser.exe`,
];

/** Запускает установленный у пользователя Chrome/Chromium/Яндекс Браузер — без скачивания браузеров. */
export async function launchBrowser(chromePath?: string): Promise<Browser> {
  const path = [chromePath, ...CANDIDATES].find((p) => p && existsSync(p));
  try {
    if (path) return await chromium.launch({ executablePath: path, headless: true });
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    throw new Error(
      "Не найден браузер Chrome/Chromium. Установите Google Chrome или укажите путь: --chrome-path или переменная CHROME_PATH.\n" +
        String((e as Error).message ?? e),
    );
  }
}
