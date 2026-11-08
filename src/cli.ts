#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectSites, DEFAULTS } from "./collect.js";
import { VERSION } from "./version.js";

const program = new Command()
  .name("site-audit-ru")
  .description("Аудит сайта и конкурентов: SEO, структура, визуальный стиль, технологии, соответствие законам РФ")
  .version(VERSION);

program
  .command("collect")
  .description("Собрать данные по одному или нескольким сайтам (без ИИ) и сохранить JSON")
  .argument("<urls...>", "адреса сайтов: свой первым, затем конкуренты")
  .option("-p, --max-pages <n>", "сколько страниц обойти на каждом сайте", String(DEFAULTS.maxPages))
  .option("-o, --out <dir>", "папка для результатов", DEFAULTS.outDir)
  .option("--no-screenshots", "не делать скриншоты")
  .option("--timeout <ms>", "таймаут загрузки страницы", String(DEFAULTS.timeoutMs))
  .option("--ignore-robots", "не учитывать robots.txt (только для своего сайта)")
  .option("--chrome-path <path>", "путь к Chrome/Chromium/Яндекс Браузеру")
  .option("--raw", "сохранить также сырые данные страниц")
  .action(async (urls: string[], o) => {
    const outDir = o.out as string;
    mkdirSync(outDir, { recursive: true });
    const { reports, raws } = await collectSites(
      urls,
      { maxPages: Number(o.maxPages), outDir, screenshots: o.screenshots, timeoutMs: Number(o.timeout), ignoreRobots: !!o.ignoreRobots, chromePath: o.chromePath },
      (m) => process.stderr.write(m + "\n"),
    );
    const file = join(outDir, "audit.json");
    writeFileSync(file, JSON.stringify({ sites: reports }, null, 2));
    if (o.raw) writeFileSync(join(outDir, "raw.json"), JSON.stringify(raws.map((r) => ({ ...r, html: undefined })), null, 2));
    process.stderr.write(`Готово: ${file}\n`);
    for (const r of reports) {
      const b = r.blocks;
      if (r.total === null) {
        process.stdout.write(`${r.url}  не удалось проверить: ${r.skipped[0]?.reason ?? "нет ответа"}\n`);
        continue;
      }
      process.stdout.write(`${r.url}  итог ${r.total} | SEO ${b.seo.score} · структура ${b.structure.score} · стиль ${b.visual.score} · технологии ${b.tech.score} · законы РФ ${b.compliance.score}\n`);
    }
  });

program.parseAsync().catch((e) => {
  process.stderr.write(`Ошибка: ${(e as Error).message}\n`);
  process.exit(1);
});
