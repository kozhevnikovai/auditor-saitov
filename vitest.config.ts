import { defineConfig } from "vitest/config";
// тестовый сервер работает на 127.0.0.1 — в тестах локальные адреса разрешены; защиту проверяет guard.test.ts
export default defineConfig({ test: { env: { SITE_AUDIT_ALLOW_PRIVATE: "1" } } });
