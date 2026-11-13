/**
 * Аудитор сайтов → Google Таблица.
 * 1. Откройте свою таблицу → Расширения → Apps Script, удалите всё и вставьте этот код, сохраните.
 * 2. Начать развёртывание → Новое развёртывание → тип «Веб-приложение»;
 *    «Выполнять от имени»: я, «Доступ»: все. Нажмите «Начать развёртывание», разрешите доступ к таблице.
 * 3. Скопируйте адрес веб-приложения (…/exec) и запускайте: site-audit-ru сайт.ru --sheet <адрес>
 * Скрипт только дописывает строки на листы «Сводка» и «Находки» этой таблицы. Адрес держите в секрете:
 * зная его, дописать строки может любой.
 */
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  if (data.tool !== "site-audit-ru") return ContentService.createTextOutput("skip");
  var book = SpreadsheetApp.getActiveSpreadsheet();
  write_(book, "Сводка", data.summaryHeader, data.summary);
  write_(book, "Находки", data.findingsHeader, data.findings);
  return ContentService.createTextOutput("ok");
}

function write_(book, name, header, rows) {
  if (!rows || !rows.length) return;
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
  // значения записываются как текст и числа, формулы не выполняются
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows.map(function (r) {
    return header.map(function (_, i) { var v = r[i]; return v === undefined || v === null ? "" : v; });
  }));
}
