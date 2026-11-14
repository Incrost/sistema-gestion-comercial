/**
 * Base de datos aislada para las pruebas de integración.
 *
 * Crea un archivo SQLite nuevo en la carpeta temporal del sistema, le aplica
 * las MISMAS migraciones de ./drizzle que usa la aplicación y lo borra al
 * terminar. Nunca toca local.db ni Turso.
 *
 * Uso (al principio del archivo de prueba):
 *
 *   vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());
 *
 * Así los servicios, que importan `db` de "@/db", usan la base temporal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "@/db/schema";
import { hashearContrasena } from "@/lib/contrasenas";

import { PREFIJO_BASE_PRUEBA } from "./preparacion-global";

/** Crea la base temporal migrada y devuelve el mismo contrato que src/db/index.ts. */
export async function crearModuloDb() {
  const carpeta = mkdtempSync(join(tmpdir(), PREFIJO_BASE_PRUEBA));
  const cliente = createClient({ url: pathToFileURL(join(carpeta, "prueba.db")).href });
  const db = drizzle(cliente, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });

  return {
    cliente,
    db,
    /**
     * Cierra la conexión e intenta borrar la carpeta temporal. Si el sistema
     * todavía la tiene bloqueada (Windows), la borra src/test/preparacion-global.ts
     * al terminar todas las pruebas.
     */
    cerrarBaseDePrueba() {
      cliente.close();
      try {
        rmSync(carpeta, { recursive: true, force: true });
      } catch {
        // Se reintenta en la limpieza global.
      }
    },
  };
}

/** Forma del módulo "@/db" cuando se reemplaza con `crearModuloDb()`. */
export type ModuloDbPrueba = Awaited<ReturnType<typeof crearModuloDb>>;

/** Inserta un usuario de prueba. La contraseña es ficticia y solo vive en la prueba. */
export async function crearUsuarioDePrueba(
  db: ModuloDbPrueba["db"],
  datos: {
    email: string;
    password: string;
    nombre?: string;
    rol?: schema.Rol;
    activo?: boolean;
  },
) {
  const [usuario] = await db
    .insert(schema.usuarios)
    .values({
      email: datos.email,
      nombre: datos.nombre ?? "Usuario de Prueba",
      passwordHash: await hashearContrasena(datos.password),
      rol: datos.rol ?? "vendedor",
      activo: datos.activo ?? true,
    })
    .returning();
  return usuario;
}
