// Генерирует подагентов плагина Claude Code из общих промптов prompts/*.md — один источник правды для CLI, MCP и плагина
import { readFileSync, writeFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const experts = {
  seo: ["seo-expert", "SEO-специалист: title, description, H1, микроразметка, индексация и скорость по данным site-audit-ru"],
  structure: ["ux-expert", "UX/CRO-аналитик: оффер первого экрана, путь к заявке, формы, контакты, разделы доверия"],
  visual: ["design-expert", "Арт-директор: палитра, шрифты, типографская шкала, контраст и визуальный код сайта"],
  tech: ["tech-expert", "Технический директор: аналитика, коллтрекинг, CRM, чаты, пиксели, устаревшие библиотеки"],
  compliance: ["law-expert", "Юрист по 152-ФЗ и защите прав потребителей: политика ПДн, согласия, cookie, зарубежные сервисы, реквизиты"],
};
for (const [block, [name, description]] of Object.entries(experts)) {
  const focus = readFileSync(`prompts/${block}.md`, "utf8").trim();
  writeFileSync(
    `plugin/agents/${name}.md`,
    `---\nname: ${name}\ndescription: ${description}. Используй после audit_sites, передав путь к audit.json.\n---\n\n${focus}\n\nКак работать:\n1. Вызови get_details с report_path из задания и block: "${block}".\n2. Опирайся только на эти данные; помечай сомнительные автоматические находки.\n3. Ответь по-русски: 3–5 главных выводов и 3–5 действий для сайта клиента (первый сайт), с примерами формулировок или значений. Если есть конкуренты — что у них лучше и что перенять.\n`,
  );
}
const plugin = {
  name: "site-audit-ru",
  version: pkg.version,
  description: "Аудит сайта и конкурентов: SEO, структура и конверсия, визуальный стиль, технологии, соответствие законам РФ. Команда /site-audit и пять ИИ-экспертов.",
  author: { name: "Egor Kozhevnikov", url: "https://github.com/kozhevnikovai" },
  homepage: "https://github.com/kozhevnikovai/auditor-saitov",
  repository: "https://github.com/kozhevnikovai/auditor-saitov",
  license: "MIT",
  keywords: ["seo", "audit", "competitors", "152-fz", "russian"],
};
writeFileSync("plugin/.claude-plugin/plugin.json", JSON.stringify(plugin, null, 2) + "\n");
console.log("plugin: ok");
