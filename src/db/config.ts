/**
 * Selección de la base de datos: SQLite local o Turso (libSQL remota).
 *
 * Es el ÚNICO lugar donde se decide a qué base se conecta el sistema.
 * Lo usan tanto la aplicación (src/db/index.ts) como drizzle-kit
 * (drizzle.config.ts), así migraciones y aplicación apuntan siempre a la misma base.
 *
 * Variables de entorno (ver .env.example):
 * - DATABASE_URL: URL de la base. Si falta, se usa la base local `file:local.db`.
 *   - `file:...`                          → SQLite local (desarrollo).
 *   - `libsql://`, `https://`, `wss://`... → Turso (producción); exige DATABASE_AUTH_TOKEN.
 * - DATABASE_AUTH_TOKEN: token de Turso. Solo se usa con URLs remotas.
 *
 * Ninguna variable lleva el prefijo NEXT_PUBLIC_, por lo que Next.js nunca las
 * incluye en el código que se envía al navegador.
 */

export const URL_LOCAL_POR_DEFECTO = "file:local.db";

const PROTOCOLOS_REMOTOS = ["libsql:", "https:", "http:", "wss:", "ws:"];

export type ConfiguracionBaseDeDatos =
  | { tipo: "local"; url: string }
  | { tipo: "remota"; url: string; authToken: string };

export function obtenerConfiguracionBaseDeDatos(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguracionBaseDeDatos {
  const url = env.DATABASE_URL?.trim() || URL_LOCAL_POR_DEFECTO;

  if (url.startsWith("file:")) {
    // En Vercel el disco es efímero: una base local perdería los datos.
    // (VERCEL_ENV vale "development" al usar `vercel env pull` en local.)
    if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
      throw new Error(
        "Configuración de base de datos inválida: en Vercel DATABASE_URL debe ser la URL de Turso (libsql://...), no una base local.",
      );
    }
    return { tipo: "local", url };
  }

  const protocolo = url.slice(0, url.indexOf(":") + 1);
  if (!PROTOCOLOS_REMOTOS.includes(protocolo)) {
    throw new Error(
      `Configuración de base de datos inválida: DATABASE_URL tiene un protocolo no admitido ("${protocolo || url}"). Use "file:..." para la base local o "libsql://..." para Turso.`,
    );
  }

  const authToken = env.DATABASE_AUTH_TOKEN?.trim();
  if (!authToken) {
    throw new Error(
      "Configuración de base de datos incompleta: DATABASE_URL apunta a una base remota (Turso) pero falta DATABASE_AUTH_TOKEN.",
    );
  }

  return { tipo: "remota", url, authToken };
}
