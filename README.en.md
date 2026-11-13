<p align="center"><img src="docs/img/cover.png" alt="Auditor Saitov" width="100%"></p>

<p align="center"><a href="README.md">Русский</a> · <b>English</b></p>

# Auditor Saitov (Аудитор сайтов) — website & competitor audit (Russia-focused)

The command and package are still called `site-audit-ru`, the former product name.

Give it your site and 2–4 competitors — in a couple of minutes you get a report: what keeps the site from generating leads, where competitors are stronger, what breaks Russian law, and what to fix first.

**Five blocks, 75+ checks:** SEO & speed · structure & conversion path · visual style · tech & marketing stack · Russian legal compliance (152-FZ personal data law, cookies, seller requisites, ad labelling).

<p align="center"><img src="docs/img/demo.gif" alt="Demo" width="100%"></p>

## Highlights

- **Competitor comparison**, not just a checklist: radar chart, ranking and “where competitors are stronger”.
- **Russian law checks** most SEO tools skip: privacy policy, consent at every form (separate consent document since 1 Sep 2025), pre-checked boxes, cookies before consent, foreign services (cross-border data transfer), INN/OGRN, `erid` ad labels.
- **Yandex-first SEO and UX:** Yandex Metrica, sitemap, schema.org, LCP/CLS/TTFB, above-the-fold CTA, form length, click-to-call, messengers.
- **Competitor style in numbers:** HEX palette, fonts, type scale, WCAG contrast, desktop & mobile screenshots.
- **Deterministic data, optional AI.** A crawler collects reproducible facts; AI only interprets them.
- **Local and free.** Runs in your own Chrome, Edge or Yandex Browser; nothing is sent anywhere; the report loads no external resources.

## Output

`report.html` (report with key panel, radar, action plan, filters, download and print), `report.md`, `findings.csv` / `summary.csv` (Excel-ready: UTF-8 BOM, `;`), `audit.json`.

<p align="center"><img src="docs/img/report-compare.jpg" alt="Report" width="100%"></p>

## Install

Requires Google Chrome, Microsoft Edge, Yandex Browser or Chromium.

1. **Claude Desktop (no terminal):** download `site-audit-ru.mcpb` from the [latest release](https://github.com/kozhevnikovai/auditor-saitov/releases/latest), double-click, then ask Claude: *“Compare my site example.ru with a.ru and b.ru”*.
2. **Claude Code plugin:**
   ```text
   /plugin marketplace add kozhevnikovai/auditor-saitov
   /plugin install site-audit-ru@kozhevnikovai
   /site-audit example.ru a.ru b.ru
   ```
3. **CLI (Node.js 20+):**
   ```bash
   npm install -g https://github.com/kozhevnikovai/auditor-saitov/releases/latest/download/site-audit-ru.tgz
   site-audit-ru example.ru a.ru b.ru --open
   ```
4. **Any MCP client** (Cursor, Codex, Windsurf): command `npx -y <tarball-url> mcp`; tools `audit_sites`, `get_details`; prompt `site_audit_expert`.

Key CLI options: `-p` max pages (30), `-f html,md,csv,xlsx,json,pdf`, `--sheet <Apps Script URL>` (append results to your Google Sheet without OAuth, see [docs/google-sheets.gs](docs/google-sheets.gs)), `--crux-key <key>` (real-user Core Web Vitals from Chrome UX Report), `--open`, `--compare-last` (monitoring: what got fixed / appeared), `--webhook <url>` (n8n, Make, Zapier), `--ai` (with `ANTHROPIC_API_KEY` or any OpenAI-compatible `OPENAI_API_KEY` + `OPENAI_BASE_URL`).

Scheduled checks without a server: `site-audit-ru schedule add example.ru a.ru --every week --at 09:00` creates a Windows Task Scheduler task or a cron entry (macOS, Linux); each run is compared with the previous one. `schedule list`, `schedule remove <site>`.

## Ethics

Respects `robots.txt`, max 30 pages, skips login/cart/account/search pages, identifies itself in the User-Agent, collects only public data. Bot-protected sites are marked as incomplete and are not scored. Legal findings are automated signals, not legal advice.

## License

MIT · Egor Kozhevnikov · product No. 002 of [kozhevnikovai](https://github.com/kozhevnikovai).
