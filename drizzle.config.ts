/**
 * Configuración de drizzle-kit (generación y aplicación de migraciones).
 *
 * La base de destino se elige en src/db/config.ts, el mismo módulo que usa la
 * aplicación. Las variables se leen del archivo .env si existe; en producción
 * (Vercel o una terminal con las variables de Turso) se toman del entorno.
 */
import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

import { obtenerConfiguracionBaseDeDatos } from "./src/db/config";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const config = obtenerConfiguracionBaseDeDatos();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials:
    config.tipo === "remota"
      ? { url: config.url, authToken: config.authToken }
      : { url: config.url },
  strict: true,
  verbose: true,
});
