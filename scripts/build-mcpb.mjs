// Сборка расширения для Claude Desktop: dist + prompts + production-зависимости → site-audit-ru.mcpb
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const dir = "build/mcpb";
rmSync("build", { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const p of ["dist", "prompts", "LICENSE", "README.md"]) cpSync(p, `${dir}/${p}`, { recursive: true });
cpSync("docs/img/icon.png", `${dir}/icon.png`);
const m = JSON.parse(readFileSync("mcpb/manifest.json", "utf8"));
m.version = pkg.version;
writeFileSync(`${dir}/manifest.json`, JSON.stringify(m, null, 2));
const slim = { name: pkg.name, version: pkg.version, type: "module", license: pkg.license, dependencies: pkg.dependencies };
writeFileSync(`${dir}/package.json`, JSON.stringify(slim, null, 2));
execSync("npm install --omit=dev --no-audit --no-fund --ignore-scripts", { cwd: dir, stdio: "inherit" });
execSync(`npx -y @anthropic-ai/mcpb validate ${dir}/manifest.json`, { stdio: "inherit" });
execSync(`npx -y @anthropic-ai/mcpb pack ${dir} build/site-audit-ru.mcpb`, { stdio: "inherit" });
