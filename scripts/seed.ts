/**
 * Carga de datos iniciales (`pnpm run db:seed`).
 *
 * Provisional: todavía no hay tablas del dominio, así que no carga nada.
 * Cuando exista el esquema, aquí se insertarán los datos de prueba usando
 * la conexión centralizada de src/db/index.ts.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

console.log("db:seed: todavía no hay datos iniciales para cargar. Nada que hacer.");
