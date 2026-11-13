// Обложка 1280×640 и иконка 512×512 в стиле «Чертёж»
import { chromium } from "playwright-core";
import { fontFaces } from "../dist/report/html.js";
import { VERSION } from "../dist/version.js";
import { readFileSync } from "node:fs";
const mono = ["cyrillic", "latin"].map(r => `@font-face{font-family:"Martian Mono";src:url(data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/martian-mono/files/martian-mono-${r}-400-normal.woff2`).toString("base64")}) format("woff2")}`).join("");
const exe = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const css = `${fontFaces()}${mono}*{box-sizing:border-box;margin:0}body{font-family:Geologica;color:#161616;background:#fff}.m{font-family:"Martian Mono"}`;
const cover = `<html><head><style>${css}
.f{position:absolute;inset:20px;border:3px solid #161616;display:grid;grid-template-rows:1fr 96px}
.top{display:grid;grid-template-columns:858px 1fr;border-bottom:3px solid #161616}.l{padding:44px 46px;position:relative}.r{border-left:1px solid #5C5C5C;position:relative}
.tag{font-size:17px;display:flex;align-items:center;gap:12px}.dot{width:14px;height:14px;border-radius:50%;background:#FF5A1F}
h1{position:absolute;left:46px;bottom:118px;font-size:62px;line-height:1.08;font-weight:600;letter-spacing:-.5px}
.sub{position:absolute;left:46px;bottom:70px;font-size:21px}.sub2{position:absolute;left:46px;bottom:40px;font-size:16px;color:#5C5C5C}
.st{display:grid;grid-template-columns:404px 208px 208px 208px 1fr}.st div{padding:18px 22px;border-right:1px solid #161616}.st div:last-child{border:0}.st b{display:block;font:400 12px "Martian Mono";color:#5C5C5C;margin-bottom:14px}.st span{font-size:20px;font-weight:600}.st .m{font-weight:400}
</style></head><body><div class="f"><div class="top"><div class="l"><div class="tag m"><span class="dot"></span>kozhevnikovai / auditor-saitov</div>
<h1>Аудит сайта<br>и конкурентов</h1><div class="sub">SEO, путь к заявке, стиль, технологии, 152-ФЗ — отчёт за пару минут</div><div class="sub2">Сравнение с конкурентами · PDF · проверка по расписанию · Claude Desktop</div></div>
<div class="r"><svg width="374" height="497" viewBox="0 0 374 497">
<g fill="none" stroke="#161616"><rect x="62" y="132" width="250" height="196" stroke-width="3"/><line x1="62" y1="160" x2="312" y2="160" stroke-width="1"/>
<line x1="88" y1="196" x2="252" y2="196" stroke-width="3"/><line x1="88" y1="226" x2="222" y2="226" stroke-width="3"/><line x1="88" y1="256" x2="276" y2="256" stroke-width="3"/><line x1="88" y1="286" x2="190" y2="286" stroke-width="3"/></g>
<g stroke="#9C9C9C" stroke-width="1" stroke-dasharray="26 6 3 6" fill="none"><line x1="187" y1="96" x2="187" y2="372"/><line x1="30" y1="230" x2="344" y2="230"/></g>
<g stroke="#5C5C5C" stroke-width="1"><line x1="62" y1="356" x2="312" y2="356"/><line x1="62" y1="348" x2="62" y2="364"/><line x1="312" y1="348" x2="312" y2="364"/></g>
<text x="187" y="384" text-anchor="middle" font-family="Martian Mono" font-size="12" fill="#5C5C5C">1440</text>
<circle cx="312" cy="132" r="16" fill="none" stroke="#FF5A1F" stroke-width="2"/><circle cx="312" cy="132" r="9" fill="#FF5A1F"/></svg></div></div>
<div class="st"><div><b>Разработчик</b><span>Егор Кожевников</span></div><div><b>Номер</b><span class="m">№ 002</span></div><div><b>Количество проверок</b><span class="m">75+</span></div><div><b>Версия</b><span class="m" style="color:#C8410F">v${VERSION.replace(/\.0$/, "")}</span></div><div><b>Лицензия</b><span class="m">MIT · free</span></div></div></div></body></html>`;
const icon = `<html><head><style>${css}</style></head><body style="margin:0"><svg width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#fff"/><path d="M186 146 V366 M186 276 L320 146 M226 237 L330 366" fill="none" stroke="#161616" stroke-width="36"/><circle cx="352" cy="146" r="22" fill="#FF5A1F"/></svg></body></html>`;
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1280, height: 640 } });
await p.setContent(cover); await p.waitForTimeout(300);
await p.screenshot({ path: "docs/img/cover.png" });
await p.setViewportSize({ width: 512, height: 512 }); await p.setContent(icon);
await p.screenshot({ path: "docs/img/icon.png" });
await b.close();
console.log("media: ok");
