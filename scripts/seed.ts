/**
 * Carga de datos iniciales (`pnpm run db:seed`).
 *
 * PARCIAL: por ahora crea
 * - los usuarios académicos (un administrador y un vendedor; ver
 *   src/db/semillas/usuarios.ts);
 * - 6 categorías y 30 productos con su stock inicial, cargado como ingreso
 *   mediante los servicios y moverStock() (ver src/db/semillas/catalogo.ts).
 * Clientes, facturas y pagos se agregarán en etapas posteriores.
 *
 * - Idempotente: se puede ejecutar varias veces sin duplicar datos.
 * - Usa la base configurada en .env (src/db/config.ts): por defecto, local.db.
 * - No imprime contraseñas, hashes ni secretos.
 *
 * Se ejecuta con la condición `react-server` (ver package.json) para que los
 * módulos marcados con `import "server-only"` puedan reutilizarse aquí.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

async function main() {
  // Importación diferida: la configuración de la base se lee DESPUÉS de cargar .env.
  const { cliente, db } = await import("../src/db");
  const { obtenerConfiguracionBaseDeDatos } = await import("../src/db/config");
  const { sembrarUsuarios, USUARIOS_ACADEMICOS } = await import("../src/db/semillas/usuarios");
  const { sembrarCatalogo } = await import("../src/db/semillas/catalogo");
  const { obtenerUsuarioActivo } = await import("../src/servicios/auth");
  const esquema = await import("../src/db/schema");
  const { count, eq } = await import("drizzle-orm");

  const { tipo } = obtenerConfiguracionBaseDeDatos();
  console.log(`db:seed: base ${tipo === "local" ? "local (SQLite)" : "remota (Turso)"}.`);

  try {
    for (const { email, estado } of await sembrarUsuarios(db)) {
      console.log(`  usuario ${email}: ${estado === "creado" ? "creado" : "ya existía, sin cambios"}`);
    }

    // El catálogo se carga a nombre del administrador académico (regla 11).
    const emailAdmin = USUARIOS_ACADEMICOS.find((u) => u.rol === "admin")!.email;
    const [filaAdmin] = await db
      .select({ id: esquema.usuarios.id })
      .from(esquema.usuarios)
      .where(eq(esquema.usuarios.email, emailAdmin));
    const admin = filaAdmin && (await obtenerUsuarioActivo(filaAdmin.id));
    if (!admin || admin.rol !== "admin") {
      throw new Error(`El usuario ${emailAdmin} no existe, está inactivo o no es administrador.`);
    }

    const catalogo = await sembrarCatalogo(admin);
    console.log(
      `  categorías: ${catalogo.categoriasCreadas} creadas, ${catalogo.categoriasExistentes} ya existían`,
    );
    console.log(
      `  productos: ${catalogo.productosCreados} creados, ${catalogo.productosExistentes} ya existían`,
    );
    console.log(`  movimientos de stock creados: ${catalogo.movimientosCreados}`);

    const [[cat], [prod], [mov]] = await Promise.all([
      db.select({ n: count() }).from(esquema.categorias),
      db.select({ n: count() }).from(esquema.productos),
      db.select({ n: count() }).from(esquema.movimientosStock),
    ]);
    console.log(`  totales en la base: ${cat.n} categorías, ${prod.n} productos, ${mov.n} movimientos`);
    console.log("db:seed: terminado.");
  } finally {
    cliente.close();
  }
}

/**
 * Mensaje seguro de un error: el de la causa más profunda (el del motor
 * SQLite, p. ej. «no such table: usuarios»). El mensaje de Drizzle NO se
 * muestra porque incluye los parámetros de la consulta (entre ellos, el hash).
 */
function mensajeSeguro(error: unknown): string {
  let actual = error;
  while (actual instanceof Error && actual.cause instanceof Error) actual = actual.cause;
  const mensaje = actual instanceof Error ? actual.message : String(actual);
  return mensaje.split("\nparams:")[0];
}

main().catch((error: unknown) => {
  console.error("db:seed: error:", mensajeSeguro(error));
  process.exitCode = 1;
});
