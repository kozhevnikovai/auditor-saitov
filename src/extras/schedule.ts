// Проверка по расписанию без сервера и аккаунтов: задание в Планировщике Windows или в cron (macOS, Linux).
// Каждый запуск — обычная проверка с --compare-last: в отчёте видно, что исправлено и что появилось.
// Адреса строго проверяются: в командную строку задания не попадает ничего, кроме букв, цифр и . - _ / :
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type Every = "day" | "week";
export interface ScheduleOptions { urls: string[]; every: Every; at: string; webhook?: string; sheet?: string; maxPages?: number; dir?: string }

const SAFE_URL = /^https?:\/\/[A-Za-z0-9.\-]{1,253}(?::\d{1,5})?(?:\/[A-Za-z0-9\-._~\/]*)?$/;
const MARK = "# site-audit-ru:";

/** Адрес, который безопасно вставить в команду задания: без кавычек, &, %, $, пробелов и параметров */
export function safeUrl(u: string, what = "Адрес"): string {
  const url = u.includes("://") ? u : "https://" + u;
  if (!SAFE_URL.test(url)) throw new Error(`${what} «${u}» нельзя поставить в расписание: допустимы только буквы, цифры и . - _ / : (без параметров после «?»)`);
  return url;
}

export function taskName(urls: string[]): string {
  return "site-audit-ru-" + new URL(safeUrl(urls[0])).hostname.replace(/[^A-Za-z0-9.\-]/g, "_");
}

/** Аргументы проверки — одинаковые для Windows и cron */
export function auditArgs(o: ScheduleOptions): string[] {
  if (!o.urls.length || o.urls.length > 5) throw new Error("В расписание — от 1 до 5 сайтов");
  const args = ["-y", "site-audit-ru", ...o.urls.map((u) => safeUrl(u)), "--compare-last", "-f", "html,md,csv,xlsx"];
  if (o.maxPages) args.push("-p", String(Math.min(50, Math.max(1, Math.floor(o.maxPages)))));
  if (o.webhook) args.push("--webhook", safeUrl(o.webhook, "Webhook"));
  if (o.sheet) args.push("--sheet", safeUrl(o.sheet, "Адрес таблицы"));
  return args;
}

function checkTime(at: string): [number, number] {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(at);
  if (!m) throw new Error("Время — в формате ЧЧ:ММ, например 09:30");
  return [Number(m[1]), Number(m[2])];
}

const auditDir = (o: ScheduleOptions) => o.dir ?? (process.platform === "win32" ? win32 : posix).join(homedir(), "site-audit");

/** Скрипт .cmd для Windows: в Планировщике у команды лимит 261 символ, поэтому задание запускает файл */
export function windowsScript(o: ScheduleOptions): string {
  const dir = auditDir(o);
  if (/["%&|<>^!]/.test(dir)) throw new Error("В пути к папке отчётов есть недопустимые символы");
  return `@echo off\r\nchcp 65001 >nul\r\ncd /d "${dir}"\r\nnpx ${auditArgs(o).join(" ")} >> "${win32.join(dir, "schedule.log")}" 2>&1\r\n`;
}

/** Аргументы schtasks для задания */
export function windowsTask(o: ScheduleOptions, scriptPath: string): string[] {
  const [h, m] = checkTime(o.at);
  return ["/Create", "/F", "/SC", o.every === "day" ? "DAILY" : "WEEKLY", ...(o.every === "week" ? ["/D", "MON"] : []), "/ST", `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, "/TN", taskName(o.urls), "/TR", `"${scriptPath}"`];
}

/** Строка crontab (macOS, Linux) с меткой, по которой задание потом находится и удаляется */
export function cronLine(o: ScheduleOptions): string {
  const [h, m] = checkTime(o.at);
  const dir = auditDir(o);
  if (!/^[A-Za-z0-9._\-\/ ]+$/.test(dir)) throw new Error("В пути к папке отчётов есть недопустимые символы");
  const q = (s: string) => `'${s}'`;
  return `${m} ${h} * * ${o.every === "day" ? "*" : "1"} cd ${q(dir)} && npx ${auditArgs(o).join(" ")} >> ${q(posix.join(dir, "schedule.log"))} 2>&1 ${MARK}${taskName(o.urls)}`;
}

/** Удаляет из crontab строки этого задания и добавляет новую (если line задана) */
export function mergeCrontab(current: string, name: string, line?: string): string {
  const kept = current.split("\n").filter((l) => l.trim() && !l.endsWith(MARK + name));
  return [...kept, ...(line ? [line] : [])].join("\n") + "\n";
}

export function listCron(current: string): string[] {
  return current.split("\n").filter((l) => l.includes(MARK)).map((l) => l.slice(l.indexOf(MARK) + MARK.length));
}

const readCrontab = () => { try { return execFileSync("crontab", ["-l"], { encoding: "utf8" }); } catch { return ""; } };
const writeCrontab = (text: string) => execFileSync("crontab", ["-"], { input: text });

export function addSchedule(o: ScheduleOptions): string {
  mkdirSync(auditDir(o), { recursive: true });
  if (process.platform === "win32") {
    const script = win32.join(auditDir(o), `${taskName(o.urls)}.cmd`);
    writeFileSync(script, windowsScript(o));
    execFileSync("schtasks", windowsTask(o, script), { windowsHide: true, stdio: "pipe" });
    return `Задание «${taskName(o.urls)}» добавлено в Планировщик заданий Windows: ${o.every === "day" ? "каждый день" : "по понедельникам"} в ${o.at}. Отчёты — в ${auditDir(o)}`;
  }
  writeCrontab(mergeCrontab(readCrontab(), taskName(o.urls), cronLine(o)));
  return `Задание «${taskName(o.urls)}» добавлено в cron: ${o.every === "day" ? "каждый день" : "по понедельникам"} в ${o.at}. Отчёты — в ${auditDir(o)}. Компьютер должен быть включён.`;
}

export function removeSchedule(url: string): string {
  const name = taskName([url]);
  if (process.platform === "win32") {
    execFileSync("schtasks", ["/Delete", "/F", "/TN", name], { windowsHide: true, stdio: "pipe" });
  } else {
    const cur = readCrontab();
    if (!listCron(cur).includes(name)) return `Задания «${name}» нет`;
    writeCrontab(mergeCrontab(cur, name));
  }
  return `Задание «${name}» удалено`;
}

export function listSchedules(): string[] {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("schtasks", ["/Query", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
      return out.split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"\\?/, "")).filter((n) => n?.startsWith("site-audit-ru-"));
    } catch { return []; }
  }
  return listCron(readCrontab());
}
