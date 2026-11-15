/**
 * Carga de datos iniciales (`pnpm run db:seed`), sección 8 «Datos de prueba».
 *
 * Crea, con los MISMOS servicios que usa la aplicación (sección 10.7):
 * - los usuarios académicos: un administrador y un vendedor
 *   (src/db/semillas/usuarios.ts);
 * - 6 categorías y 30 productos con su stock inicial, cargado como ingreso
 *   mediante moverStock() (src/db/semillas/catalogo.ts);
 * - 12 clientes académicos ficticios, uno dado de baja
 *   (src/db/semillas/clientes.ts);
 * - 50 facturas repartidas en los últimos 30 días, 6 anulaciones y 6 pagos
 *   de cuenta corriente (src/db/semillas/facturas.ts), con emitirFactura(),
 *   anularFactura() y registrarPago().
 *
 * Fechas: las operaciones históricas se registran con conFechaSimulada()
 * (src/servicios/reloj.ts), un mecanismo interno que solo usan este script y
 * las pruebas; la API nunca acepta fechas de emisión.
 *
 * - Idempotente: se puede ejecutar varias veces sin duplicar datos ni
 *   consumir numeración (ver la marca académica en src/db/semillas/facturas.ts).
 * - No modifica datos que no pertenecen al conjunto académico.
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
  const { sembrarClientes } = await import("../src/db/semillas/clientes");
  const { sembrarFacturas, fechaStockInicialSemilla } = await import("../src/db/semillas/facturas");
  const { obtenerUsuarioActivo } = await import("../src/servicios/auth");
  const { conFechaSimulada } = await import("../src/servicios/reloj");
  const esquema = await import("../src/db/schema");
  const { count, eq } = await import("drizzle-orm");

  const { tipo } = obtenerConfiguracionBaseDeDatos();
  console.log(`db:seed: base ${tipo === "local" ? "local (SQLite)" : "remota (Turso)"}.`);
  const referencia = new Date();

  try {
    for (const { email, estado } of await sembrarUsuarios(db)) {
      console.log(`  usuario ${email}: ${estado === "creado" ? "creado" : "ya existía, sin cambios"}`);
    }

    /** Usuario académico activo con el rol esperado (regla 11: autor de las operaciones). */
    async function usuarioAcademico(rol: "admin" | "vendedor") {
      const email = USUARIOS_ACADEMICOS.find((u) => u.rol === rol)!.email;
      const [fila] = await db
        .select({ id: esquema.usuarios.id })
        .from(esquema.usuarios)
        .where(eq(esquema.usuarios.email, email));
      const usuario = fila && (await obtenerUsuarioActivo(fila.id));
      if (!usuario || usuario.rol !== rol) {
        throw new Error(`El usuario ${email} no existe, está inactivo o no tiene el rol ${rol}.`);
      }
      return usuario;
    }
    const admin = await usuarioAcademico("admin");
    const vendedor = await usuarioAcademico("vendedor");

    // En una base nueva, el stock inicial queda fechado antes de la ventana de
    // ventas, para que el historial de cada producto sea cronológico.
    const catalogo = await conFechaSimulada(fechaStockInicialSemilla(referencia), () => sembrarCatalogo(admin));
    console.log(
      `  categorías: ${catalogo.categoriasCreadas} creadas, ${catalogo.categoriasExistentes} ya existían`,
    );
    console.log(
      `  productos: ${catalogo.productosCreados} creados, ${catalogo.productosExistentes} ya existían`,
    );
    console.log(`  movimientos de stock del catálogo creados: ${catalogo.movimientosCreados}`);

    const semillaClientes = await sembrarClientes(admin);
    console.log(
      `  clientes: ${semillaClientes.clientesCreados} creados, ${semillaClientes.clientesExistentes} ya existían`,
    );

    const ventas = await sembrarFacturas({ admin, vendedor }, referencia);
    if (ventas.estado === "existente") {
      console.log(`  facturas académicas: ya existían (${ventas.facturas}), sin cambios; no se crearon pagos ni anulaciones`);
    } else {
      const repuesto = ventas.reposiciones.map((r) => `${r.codigo} +${r.cantidad}`).join(", ");
      console.log(`  reposiciones previas creadas: ${ventas.reposiciones.length} (${repuesto})`);
      console.log(`  facturas académicas creadas: ${ventas.facturas}`);
      console.log(`  anulaciones creadas: ${ventas.anulaciones}`);
      console.log(`  pagos creados: ${ventas.pagos}`);
    }

    const [[cat], [prod], [mov], [cli], [fac], [pag]] = await Promise.all([
      db.select({ n: count() }).from(esquema.categorias),
      db.select({ n: count() }).from(esquema.productos),
      db.select({ n: count() }).from(esquema.movimientosStock),
      db.select({ n: count() }).from(esquema.clientes),
      db.select({ n: count() }).from(esquema.facturas),
      db.select({ n: count() }).from(esquema.pagos),
    ]);
    console.log(
      `  totales en la base: ${cat.n} categorías, ${prod.n} productos, ${mov.n} movimientos de stock, ` +
        `${cli.n} clientes, ${fac.n} facturas, ${pag.n} pagos`,
    );
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
