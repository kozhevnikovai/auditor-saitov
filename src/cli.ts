#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { collectSites, DEFAULTS } from "./collect.js";
import { aiReview, resolveAi } from "./ai.js";
import { hostOf } from "./report/insights.js";
import { loadReports, parseFormats, writeOutputs, writePdf } from "./output.js";
import { sendWebhook, webhookPayload } from "./report/webhook.js";
import { localStamp, VERSION } from "./version.js";

const log = (m: string) => process.stderr.write(m + "\n");


/** Последний прошлый прогон для того же (первого) сайта — для режима мониторинга */
function findLast(root: string, host: string, exclude: string): string | undefined {
  if (!existsSync(root)) return;
  return readdirSync(root)
    .map((d) => join(root, d, "audit.json"))
    .filter((p) => existsSync(p) && dirname(p) !== exclude)
    .filter((p) => {
      try {
        return hostOf(loadReports(p)[0].url) === host;
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function openFile(p: string) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", p] : [p];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

const program = new Command()
  .name("site-audit-ru")
  .addHelpText("after", "\nСкоро в платной версии: проверка по расписанию, отчёт под брендом агентства, весь сайт целиком.\nПодробнее и ранний доступ: https://github.com/kozhevnikovai/auditor-saitov#скоро")
  .description("Аудит сайта и конкурентов: SEO, структура и конверсия, визуальный стиль, технологии, соответствие законам РФ")
  .version(VERSION);

program
  .command("audit", { isDefault: true })
  .alias("collect")
  .description("Проверить один или несколько сайтов и сохранить отчёты (команда по умолчанию)")
  .argument("<urls...>", "адреса сайтов: ваш первым, затем конкуренты (до 10)")
  .option("-p, --max-pages <n>", "сколько страниц обойти на каждом сайте", String(DEFAULTS.maxPages))
  .option("-o, --out <dir>", "папка для отчётов (по умолчанию site-audit/<дата>-<сайт>)")
  .option("-f, --format <list>", "форматы через запятую: html, md, csv, xlsx, json, pdf", "html,md,csv")
  .option("--baseline <audit.json>", "сравнить с прошлым прогоном: что исправлено и что появилось")
  .option("--compare-last", "автоматически сравнить с последним прогоном этого сайта в папке site-audit")
  .option("--ai", "добавить заключение ИИ-экспертов (ключ в ANTHROPIC_API_KEY или OPENAI_API_KEY)")
  .option("--ai-model <model>", "модель ИИ (по умолчанию claude-sonnet-5-5 или переменная SITE_AUDIT_AI_MODEL)")
  .option("--webhook <url>", "отправить сводку POST-запросом (n8n, Make, Zapier, Albato, Битрикс24)")
  .option("--open", "открыть HTML-отчёт после проверки")
  .option("--no-screenshots", "не делать скриншоты")
  .option("--timeout <ms>", "таймаут загрузки страницы", String(DEFAULTS.timeoutMs))
  .option("--ignore-robots", "не учитывать robots.txt (только для своего сайта)")
  .option("--chrome-path <path>", "путь к Chrome, Edge, Яндекс Браузеру или Chromium")
  .option("--allow-private", "разрешить адреса локальной сети (аудит внутреннего сайта, localhost)")
  .option("--sheet <url>", "дописать сводку и находки в Google Таблицу (адрес веб-приложения Apps Script, см. README)")
  .option("--crux-key <key>", "ключ CrUX API Google: Core Web Vitals реальных посетителей (или переменная SITE_AUDIT_CRUX_KEY)")
  .action(async (urls: string[], o) => {
    if (urls.length > 10) throw new Error("Не больше 10 сайтов за один запуск");
    const formats = parseFormats(o.format);
    const root = "site-audit";
    const outDir = o.out ?? join(root, `${localStamp()}-${hostOf(urls[0].includes("://") ? urls[0] : "https://" + urls[0]).replace(/[:\\/]/g, "_")}`);
    let ai = o.ai ? resolveAi({ model: o.aiModel }) : null;
    if (o.ai && !ai) log("Для --ai нужен ключ: ANTHROPIC_API_KEY или OPENAI_API_KEY (+ OPENAI_BASE_URL для YandexGPT, OpenRouter, Ollama). Продолжаю без ИИ.");

    log(`site-audit-ru ${VERSION} · ${urls.length} ${urls.length === 1 ? "сайт" : "сайта(ов)"} · до ${o.maxPages} стр. на сайт`);
    const { reports } = await collectSites(
      urls,
      { maxPages: Number(o.maxPages), outDir, screenshots: o.screenshots, timeoutMs: Number(o.timeout), ignoreRobots: !!o.ignoreRobots, chromePath: o.chromePath, allowPrivate: o.allowPrivate ? true : undefined },
      log,
    );

    let aiText: string | undefined;
    if (ai) {
      log(`ИИ-эксперты анализируют (${ai.provider}, ${ai.model})…`);
      try {
        aiText = await aiReview(reports, ai);
      } catch (e) {
        log(`ИИ недоступен: ${(e as Error).message}`);
        ai = null;
      }
    }
    const cruxKey = o.cruxKey ?? process.env.SITE_AUDIT_CRUX_KEY;
    if (cruxKey) {
      const { fetchCrux } = await import("./extras/crux.js");
      for (const r of reports) {
        if (r.total === null) continue;
        try { r.field = await fetchCrux(r.url, cruxKey); } catch (e) { log(`CrUX ${hostOf(r.url)}: ${(e as Error).message}`); }
      }
    }
    const baseline = o.baseline ?? (o.compareLast ? findLast(root, hostOf(reports[0].url), outDir) : undefined);
    if (baseline) log(`Сравниваю с прошлым прогоном: ${baseline}`);
    const { files, diffs } = writeOutputs(reports, { outDir, formats, baseline, ai: aiText });
    if (formats.includes("pdf")) {
      try { files.pdf = await writePdf(reports, { outDir, files, ai: aiText, chromePath: o.chromePath }); } catch (e) { log(`PDF не создан: ${(e as Error).message}`); }
    }

    process.stdout.write("\n");
    for (const r of reports) {
      const b = r.blocks;
      if (r.total === null) {
        process.stdout.write(`  ${hostOf(r.url).padEnd(28)} ${r.limited === "bot-protection" ? "закрыт защитой от ботов — оценка не ставится" : "не удалось проверить: " + (r.skipped[0]?.reason ?? "нет ответа")}\n`);
        continue;
      }
      process.stdout.write(`  ${hostOf(r.url).padEnd(28)} ${String(r.total).padStart(3)}/100   SEO ${b.seo.score} · структура ${b.structure.score} · стиль ${b.visual.score} · технологии ${b.tech.score} · законы РФ ${b.compliance.score}\n`);
    }
    for (const d of diffs) process.stdout.write(`  Δ ${hostOf(d.url)}: ${d.total.before ?? "—"} → ${d.total.after ?? "—"}, исправлено ${d.fixed.length}, появилось ${d.appeared.length}\n`);
    process.stdout.write("\nОтчёты:\n" + Object.values(files).map((f) => "  " + f).join("\n") + "\n");

    if (o.webhook) {
      try {
        const status = await sendWebhook(o.webhook, webhookPayload(reports, diffs), { allowPrivate: o.allowPrivate ? true : undefined });
        log(`Webhook: ответ ${status}`);
      } catch (e) {
        log(`Webhook не отправлен: ${(e as Error).message}`);
      }
    }
    if (o.sheet) {
      try {
        const { sendToSheet } = await import("./extras/sheets.js");
        await sendToSheet(o.sheet, reports);
        log("Google Таблица: строки добавлены");
      } catch (e) {
        log(`Google Таблица не обновлена: ${(e as Error).message}`);
      }
    }
    if (o.open && files.html) openFile(files.html);
  });

program
  .command("report")
  .description("Пересобрать отчёты из сохранённого audit.json (например, в другом формате)")
  .argument("<audit.json>")
  .option("-o, --out <dir>", "папка для отчётов (по умолчанию рядом с audit.json)")
  .option("-f, --format <list>", "форматы: html, md, csv, xlsx, json, pdf", "html,md,csv")
  .option("--baseline <audit.json>", "сравнить с прошлым прогоном")
  .option("--chrome-path <path>", "браузер для PDF")
  .action(async (path: string, o) => {
    const sites = loadReports(path);
    const outDir = o.out ?? dirname(path);
    let ai: string | undefined;
    try {
      ai = (JSON.parse(readFileSync(path, "utf8")) as { ai?: string }).ai ?? undefined;
    } catch {
      /* без заключения */
    }
    const formats = parseFormats(o.format);
    const { files } = writeOutputs(sites, { outDir, formats, baseline: o.baseline, ai });
    if (formats.includes("pdf")) files.pdf = await writePdf(sites, { outDir, files, ai, chromePath: o.chromePath });
    process.stdout.write(Object.values(files).join("\n") + "\n");
  });

const sched = program.command("schedule").description("Проверка по расписанию на этом компьютере: Планировщик Windows или cron (macOS, Linux)");
sched
  .command("add")
  .argument("<urls...>", "сайт и до 4 конкурентов")
  .option("--every <day|week>", "как часто: day — каждый день, week — по понедельникам", "week")
  .option("--at <ЧЧ:ММ>", "во сколько", "09:00")
  .option("-p, --max-pages <n>", "страниц на сайт")
  .option("--webhook <url>", "сводка после каждой проверки (n8n, Make, Битрикс24, свой бот)")
  .option("--sheet <url>", "дописывать результат в Google Таблицу")
  .description("Добавить проверку по расписанию; отчёты — в папке site-audit в домашней папке, с сравнением с прошлым разом")
  .action(async (urls: string[], o) => {
    const { addSchedule } = await import("./extras/schedule.js");
    if (o.every !== "day" && o.every !== "week") throw new Error("--every: day или week");
    process.stdout.write(addSchedule({ urls, every: o.every, at: o.at, webhook: o.webhook, sheet: o.sheet, maxPages: o.maxPages ? Number(o.maxPages) : undefined }) + "\n");
  });
sched.command("list").description("Список проверок по расписанию").action(async () => {
  const { listSchedules } = await import("./extras/schedule.js");
  const l = listSchedules();
  process.stdout.write((l.length ? l.join("\n") : "Проверок по расписанию нет") + "\n");
});
sched.command("remove").argument("<url>").description("Удалить проверку по расписанию для сайта").action(async (url: string) => {
  const { removeSchedule } = await import("./extras/schedule.js");
  process.stdout.write(removeSchedule(url) + "\n");
});

program
  .command("crux")
  .argument("<url>")
  .option("--key <key>", "ключ CrUX API (или SITE_AUDIT_CRUX_KEY)")
  .option("--desktop", "данные для компьютеров (по умолчанию — телефоны)")
  .description("Core Web Vitals реальных посетителей из Chrome UX Report Google")
  .action(async (url: string, o) => {
    const key = o.key ?? process.env.SITE_AUDIT_CRUX_KEY;
    if (!key) throw new Error("Нужен ключ CrUX API: --key или SITE_AUDIT_CRUX_KEY (бесплатно, Google Cloud Console → APIs → Chrome UX Report API)");
    const { fetchCrux, fieldMarkdown } = await import("./extras/crux.js");
    process.stdout.write(fieldMarkdown(await fetchCrux(url, key, o.desktop ? "DESKTOP" : "PHONE")) + "\n");
  });

program
  .command("mcp")
  .description("Запустить MCP-сервер (stdio) для Claude Desktop, Claude Code, Cursor, Codex")
  .action(async () => {
    const { startMcp } = await import("./mcp.js");
    await startMcp();
  });

program
  .command("prompt")
  .description("Вывести промпт ИИ-экспертов (для своего чата с ИИ: вставьте его и report.md)")
  .action(async () => {
    const { expertPrompt } = await import("./ai.js");
    process.stdout.write(expertPrompt() + "\n");
  });

program.parseAsync().catch((e) => {
  process.stderr.write(`Ошибка: ${(e as Error).message}\n`);
  process.exit(1);
});
