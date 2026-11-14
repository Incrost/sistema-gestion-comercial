/**
 * Conexión de la aplicación con la base de datos (Drizzle ORM + libSQL).
 *
 * La decisión entre SQLite local y Turso se toma en ./config.ts.
 * Este módulo solo debe importarse desde código de servidor
 * (servicios, Route Handlers, Server Actions, scripts).
 */
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { obtenerConfiguracionBaseDeDatos } from "./config";
import * as schema from "./schema";

function crearCliente(): Client {
  const config = obtenerConfiguracionBaseDeDatos();
  return config.tipo === "remota"
    ? createClient({ url: config.url, authToken: config.authToken })
    : createClient({ url: config.url });
}

// En desarrollo, la recarga en caliente de Next.js reevalúa los módulos;
// se reutiliza el cliente para no abrir una conexión nueva en cada recarga.
const globalParaDb = globalThis as unknown as { clienteLibsql?: Client };

export const cliente: Client = globalParaDb.clienteLibsql ?? crearCliente();

if (process.env.NODE_ENV !== "production") {
  globalParaDb.clienteLibsql = cliente;
}

export const db = drizzle(cliente, { schema });

export type BaseDeDatos = typeof db;
