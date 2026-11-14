/**
 * Configuración de Vitest (pruebas unitarias y de integración).
 *
 * - `pnpm run test`     → modo observación, para desarrollar.
 * - `pnpm run test:run` → una sola ejecución (la que se usa para verificar).
 *
 * Las pruebas de integración NO usan local.db ni Turso: cada archivo crea su
 * propia base SQLite temporal (src/test/base-de-prueba.ts) y la borra al final.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mismo alias que tsconfig.json: "@/..." apunta a "src/...".
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Ver src/test/server-only.ts.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Borra las bases temporales de prueba al terminar (ver el archivo).
    globalSetup: ["./src/test/preparacion-global.ts"],
    env: {
      // Secreto exclusivo de las pruebas: no es el de .env ni el de producción.
      SESSION_SECRET: "secreto-de-pruebas-automatizadas-no-usar-en-ningun-entorno",
      // URL inválida a propósito: si una prueba importa la base real sin
      // reemplazarla por la temporal, falla en lugar de tocar local.db o Turso.
      DATABASE_URL: "sin-base:usar-src-test-base-de-prueba",
      DATABASE_AUTH_TOKEN: "",
    },
  },
});
