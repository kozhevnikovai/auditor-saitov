# Изменения

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

## [1.0.0] — 2026-11-09

Первый релиз.

### Добавлено
- Сборщик на Playwright с системным браузером (Chrome, Edge, Яндекс Браузер, Chromium): robots.txt, sitemap и индекс sitemap, до 30 страниц, пропуск служебных страниц, ожидание после JS-проверок защиты от ботов, скриншоты 1440 и 390 px.
- Пять блоков и 60+ проверок: SEO и скорость, структура и конверсия, визуальный стиль, технологии (45+ сигнатур), законы РФ (152-ФЗ с изменениями от 01.09.2025, cookie, зарубежные сервисы, реквизиты, erid).
- Сравнение с конкурентами: радар, место, «где конкуренты сильнее».
- Отчёты: HTML в стиле «Чертёж» (окно «Главное», цветовые статусы, план из 10 действий с подсказками, фильтр «Только проблемы», скачивание, печать в PDF, встроенные шрифты без внешних запросов), Markdown, CSV для Excel и Google Таблиц, JSON.
- Мониторинг изменений: `--compare-last`, `--baseline`.
- Webhook для n8n, Make, Zapier, Albato, Битрикс24.
- Заключение ИИ-экспертов: Anthropic или любой OpenAI-совместимый API.
- MCP-сервер (`audit_sites`, `get_details`, промпт `site_audit_expert`), расширение Claude Desktop (`.mcpb`), плагин Claude Code с командой `/site-audit` и пятью подагентами.
- 26 автотестов, CI на GitHub Actions.

### Проверено на реальных сайтах
tilda.cc, roistat.com, vc.ru, skillbox.ru, selectel.ru, getcourse.ru, timeweb.com, reg.ru, 1c.ru, cdek.ru (защита от ботов), vkusvill.ru (недоступен из тестовой сети).
