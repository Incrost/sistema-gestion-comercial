/**
 * Configuración de Vitest (pruebas unitarias).
 *
 * - `pnpm run test`     → modo observación, para desarrollar.
 * - `pnpm run test:run` → una sola ejecución (la que se usa para verificar).
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismo alias que tsconfig.json: "@/..." apunta a "src/...".
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
