/**
 * Pruebas de la consulta de facturas (RF-V7, RF-V8; reglas 3 y 11):
 * listarFacturas(), obtenerFactura() y la representación pública.
 *
 * Base SQLite temporal REAL, con las migraciones, claves foráneas y CHECK.
 * Las facturas se emiten con emitirFactura() (el servicio real). Solo para
 * probar los filtros por día y el orden, se ajusta la columna `fecha` de las
 * facturas recién emitidas en ESTA base temporal.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { facturas, usuarios } from "@/db/schema";
import { ApiError, normalizarError } from "@/lib/api-error";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import type { UsuarioAutenticado } from "./auth";
import { crearCategoria } from "./categorias";
import { actualizarCliente, crearCliente } from "./clientes";
import {
  anularFactura,
  emitirFactura,
  listarFacturas,
  obtenerFactura,
  opcionesFiltroFacturas,
  type FacturaPublica,
  type ListaFacturas,
} from "./facturas";
import { actualizarProducto, crearProducto } from "./productos";

const { cliente: libsql, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin", nombre: "Laura Méndez" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
  categoriaId = (await crearCategoria(admin, { nombre: "Consulta" })).id;
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

let n = 0;
async function nuevoProducto(precio: number, datos: { codigo?: string; descripcion?: string } = {}) {
  const codigo = datos.codigo ?? `CO-${++n}`;
  return crearProducto(admin, {
    codigo,
    descripcion: datos.descripcion ?? `Producto ${codigo}`,
    categoriaId,
    precio,
    stockMinimo: 0,
    stockInicial: 100,
  });
}

let dni = 40_000_000;
const nuevoCliente = (datos: Record<string, unknown> = {}) =>
  crearCliente(admin, { tipoDoc: "DNI", nroDoc: String(++dni), nombre: `Cliente ${dni}`, ...datos });

/** Fija la fecha de una factura de ESTA base temporal (solo para probar filtros y orden). */
async function fijarFecha(id: number, iso: string) {
  await db.update(facturas).set({ fecha: new Date(iso) }).where(eq(facturas.id, id));
}

const listar = (consulta: Record<string, unknown> = {}, usuario = vendedor) => listarFacturas(usuario, consulta);
const ids = (lista: ListaFacturas) => lista.data.map((f) => f.id);

async function fallo(promesa: Promise<unknown>): Promise<ApiError> {
  try {
    await promesa;
  } catch (error) {
    return normalizarError(error);
  }
  throw new Error("Se esperaba un error");
}

// ---------------------------------------------------------------------------
// 1. Listado vacío (antes de emitir nada en esta base)
// ---------------------------------------------------------------------------

describe("listado vacío", () => {
  it("sin facturas: data vacía, total 0, totalEmitido 0 y la paginación por defecto", async () => {
    expect(await listar()).toEqual({ data: [], page: 1, pageSize: 20, total: 0, totalEmitido: 0 });
    expect(await listar({}, admin)).toEqual({ data: [], page: 1, pageSize: 20, total: 0, totalEmitido: 0 });
  });
});

// ---------------------------------------------------------------------------
// Conjunto conocido de facturas
// ---------------------------------------------------------------------------

describe("listado con filtros", () => {
  // F1 contado CF (vendedor)          2026-10-01 12:00 AR   100.000
  // F2 tarjeta Mariana (admin)        2026-10-05 23:30 AR   250.000  (= 06/10 02:30 UTC)
  // F3 cta cte Mariana (vendedor)     2026-10-06 00:30 AR   200.000  (= 06/10 03:30 UTC)
  // F4 contado Jorge (admin) ANULADA  2026-10-10 10:00 AR   500.000
  // F5 contado CF (vendedor)          2026-10-12 10:00 AR   100.000
  // F6 contado CF (vendedor)          2026-10-12 10:00 AR   300.000  (misma fecha que F5)
  const f: FacturaPublica[] = [];
  let mariana: Awaited<ReturnType<typeof nuevoCliente>>;
  let jorge: Awaited<ReturnType<typeof nuevoCliente>>;

  beforeAll(async () => {
    const p1 = await nuevoProducto(100_000);
    const p2 = await nuevoProducto(250_000);
    mariana = await nuevoCliente({ nombre: "Mariana López", cuentaCorriente: true });
    jorge = await nuevoCliente({ nombre: "Jorge Pérez" });

    f.push(await emitirFactura(vendedor, { clienteId: null, items: [{ productoId: p1.id, cantidad: 1 }], pago: { forma: "contado" } }));
    f.push(
      await emitirFactura(admin, {
        clienteId: mariana.id,
        items: [{ productoId: p2.id, cantidad: 1 }],
        pago: { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "4321" } },
      }),
    );
    f.push(await emitirFactura(vendedor, { clienteId: mariana.id, items: [{ productoId: p1.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } }));
    f.push(await emitirFactura(admin, { clienteId: jorge.id, items: [{ productoId: p2.id, cantidad: 2 }], pago: { forma: "contado" } }));
    f.push(await emitirFactura(vendedor, { clienteId: null, items: [{ productoId: p1.id, cantidad: 1 }], pago: { forma: "contado" } }));
    f.push(await emitirFactura(vendedor, { clienteId: null, items: [{ productoId: p1.id, cantidad: 3 }], pago: { forma: "contado" } }));

    await fijarFecha(f[0].id, "2026-10-01T12:00:00-03:00");
    await fijarFecha(f[1].id, "2026-10-05T23:30:00-03:00");
    await fijarFecha(f[2].id, "2026-10-06T00:30:00-03:00");
    await fijarFecha(f[3].id, "2026-10-10T10:00:00-03:00");
    await fijarFecha(f[4].id, "2026-10-12T10:00:00-03:00");
    await fijarFecha(f[5].id, "2026-10-12T10:00:00-03:00");

    await anularFactura(admin, { id: String(f[3].id) }, { motivo: "Error en la carga de cantidades" });
  });

  it("2-3. orden descendente por fecha y, a igual fecha, por id descendente (estable)", async () => {
    const lista = await listar();
    expect(lista.total).toBe(6);
    expect(ids(lista)).toEqual([f[5].id, f[4].id, f[3].id, f[2].id, f[1].id, f[0].id]);
    // Repetir la consulta da exactamente el mismo orden.
    expect(ids(await listar())).toEqual(ids(lista));
  });

  it("2. paginado: page y pageSize, total de todas las filas y páginas sin solapamiento", async () => {
    const p1 = await listar({ page: "1", pageSize: "4" });
    const p2 = await listar({ page: "2", pageSize: "4" });
    const p3 = await listar({ page: "3", pageSize: "4" });
    expect(p1).toMatchObject({ page: 1, pageSize: 4, total: 6 });
    expect(ids(p1)).toEqual([f[5].id, f[4].id, f[3].id, f[2].id]);
    expect(ids(p2)).toEqual([f[1].id, f[0].id]);
    expect(p3.data).toEqual([]);
    expect(p3.total).toBe(6);
  });

  it("paginación inválida → 422 VALIDACION (page 0, pageSize > 100, texto)", async () => {
    for (const consulta of [{ page: "0" }, { pageSize: "101" }, { pageSize: "0" }, { page: "uno" }, { page: "1.5" }]) {
      expect((await fallo(listar(consulta))).code).toBe("VALIDACION");
    }
    expect((await listar({ pageSize: "100" })).pageSize).toBe(100);
  });

  it("4. búsqueda por número completo exacto", async () => {
    const lista = await listar({ q: f[2].numeroFormateado });
    expect(ids(lista)).toEqual([f[2].id]);
    expect(ids(await listar({ q: `1-${f[2].numero}` }))).toEqual([f[2].id]);
    expect(ids(await listar({ q: f[2].numeroFormateado.replace("-", "") }))).toEqual([f[2].id]);
    expect((await listar({ q: "0002-00000003" })).total).toBe(0); // otro punto de venta
    expect((await listar({ q: "0001-99999999" })).total).toBe(0);
  });

  it("5. búsqueda por parte numérica", async () => {
    expect(ids(await listar({ q: String(f[2].numero) }))).toEqual([f[2].id]);
    expect(ids(await listar({ q: String(f[2].numero).padStart(8, "0") }))).toEqual([f[2].id]);
    // "0000000" está en todos los números de 8 dígitos de esta base.
    expect((await listar({ q: "0000000" })).total).toBe(6);
  });

  it("6. búsqueda por nombre CONGELADO del comprador (sin distinguir mayúsculas)", async () => {
    expect(ids(await listar({ q: "mariana" }))).toEqual([f[2].id, f[1].id]);
    expect(ids(await listar({ q: "LÓPEZ" }))).toEqual([f[2].id, f[1].id]);
    expect((await listar({ q: "consumidor final" })).total).toBe(3);
    // Los comodines de LIKE se buscan como texto literal.
    expect((await listar({ q: "%" })).total).toBe(0);
    expect((await listar({ q: "_" })).total).toBe(0);
  });

  it("6/22. renombrar al cliente no cambia la búsqueda: se busca el nombre congelado", async () => {
    const otro = await nuevoCliente({ nombre: "Nombre Original" });
    const p = await nuevoProducto(1_000);
    const factura = await emitirFactura(vendedor, { clienteId: otro.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    await actualizarCliente(admin, { id: String(otro.id) }, { nombre: "Nombre Nuevo" });
    expect(ids(await listar({ q: "original" }))).toEqual([factura.id]);
    expect((await listar({ q: "nuevo" })).total).toBe(0);
    // Se aparta del resto del conjunto: fecha anterior a todas.
    await fijarFecha(factura.id, "2026-09-01T10:00:00-03:00");
    const lista = await listar({ clienteId: String(otro.id) });
    expect(lista.data[0].cliente).toMatchObject({ id: otro.id, nombre: "Nombre Original" });
    await anularFactura(admin, { id: String(factura.id) }, { motivo: "Se aparta del conjunto de prueba" });
  });

  it("7. filtro desde (día de Argentina, inclusive)", async () => {
    expect(ids(await listar({ desde: "2026-10-06" }))).toEqual([f[5].id, f[4].id, f[3].id, f[2].id]);
    // 05/10 23:30 en Argentina ya es 06/10 en UTC, pero pertenece al 05/10.
    expect(ids(await listar({ desde: "2026-10-05" }))).toEqual([f[5].id, f[4].id, f[3].id, f[2].id, f[1].id]);
  });

  it("8. filtro hasta (día de Argentina, inclusive)", async () => {
    expect(ids(await listar({ hasta: "2026-10-05", desde: "2026-10-01" }))).toEqual([f[1].id, f[0].id]);
    expect(ids(await listar({ desde: "2026-10-12", hasta: "2026-10-12" }))).toEqual([f[5].id, f[4].id]);
    expect((await listar({ desde: "2026-10-13" })).total).toBe(0);
  });

  it("9. rango inválido o fechas mal formadas → 422 VALIDACION", async () => {
    const e = await fallo(listar({ desde: "2026-10-10", hasta: "2026-10-01" }));
    expect(e).toMatchObject({ status: 422, code: "VALIDACION" });
    expect(e.details).toEqual([{ campo: "hasta", mensaje: "Debe ser igual o posterior a «desde»." }]);
    for (const desde of ["2026-02-30", "10/10/2026", "2026-1-1", "ayer"]) {
      expect((await fallo(listar({ desde }))).code).toBe("VALIDACION");
    }
  });

  it("10. filtro por cliente (también con el cliente inactivo)", async () => {
    expect(ids(await listar({ clienteId: String(mariana.id) }))).toEqual([f[2].id, f[1].id]);
    expect(ids(await listar({ clienteId: String(jorge.id) }))).toEqual([f[3].id]);
    expect((await listar({ clienteId: "999999" })).total).toBe(0);
    for (const clienteId of ["0", "-1", "abc", "1.5"]) {
      expect((await fallo(listar({ clienteId }))).code).toBe("VALIDACION");
    }
  });

  it("11. filtro por vendedor (también con el usuario desactivado)", async () => {
    expect(ids(await listar({ vendedorId: String(admin.id) }))).toEqual([f[3].id, f[1].id]);
    expect((await listar({ vendedorId: String(vendedor.id), desde: "2026-10-01" })).total).toBe(4);
    const baja = await crearUsuarioDePrueba(db, { email: "baja@prueba.test", password: "clave-de-prueba-1", rol: "vendedor", nombre: "Vendedor de baja" });
    const p = await nuevoProducto(1_000);
    const deBaja = await emitirFactura({ id: baja.id, nombre: baja.nombre, email: baja.email, rol: baja.rol }, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    await fijarFecha(deBaja.id, "2026-09-01T09:00:00-03:00");
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, baja.id));
    expect(ids(await listar({ vendedorId: String(baja.id) }))).toEqual([deBaja.id]);
    expect((await fallo(listar({ vendedorId: "x" }))).code).toBe("VALIDACION");
    await anularFactura(admin, { id: String(deBaja.id) }, { motivo: "Se aparta del conjunto de prueba" });
  });

  it("12. filtro por forma de pago", async () => {
    const rango = { desde: "2026-10-01" };
    expect(ids(await listar({ ...rango, forma: "tarjeta" }))).toEqual([f[1].id]);
    expect(ids(await listar({ ...rango, forma: "cuenta_corriente" }))).toEqual([f[2].id]);
    expect(ids(await listar({ ...rango, forma: "contado" }))).toEqual([f[5].id, f[4].id, f[3].id, f[0].id]);
    expect((await fallo(listar({ forma: "efectivo" }))).code).toBe("VALIDACION");
  });

  it("13. filtro por estado", async () => {
    const rango = { desde: "2026-10-01" };
    expect(ids(await listar({ ...rango, estado: "anulada" }))).toEqual([f[3].id]);
    expect((await listar({ ...rango, estado: "emitida" })).total).toBe(5);
    expect((await fallo(listar({ estado: "borrada" }))).code).toBe("VALIDACION");
  });

  it("14. combinación de filtros", async () => {
    expect(
      ids(await listar({ q: "mariana", forma: "cuenta_corriente", vendedorId: String(vendedor.id), desde: "2026-10-06", hasta: "2026-10-06", estado: "emitida" })),
    ).toEqual([f[2].id]);
    expect((await listar({ clienteId: String(mariana.id), forma: "contado" })).total).toBe(0);
    expect(ids(await listar({ q: "consumidor", desde: "2026-10-12", pageSize: "1", page: "2" }))).toEqual([f[4].id]);
  });

  it("15. totalEmitido excluye anuladas", async () => {
    const rango = { desde: "2026-10-01" };
    const todas = await listar(rango);
    expect(todas.total).toBe(6);
    expect(todas.totalEmitido).toBe(100_000 + 250_000 + 200_000 + 100_000 + 300_000);
    expect((await listar({ ...rango, estado: "anulada" })).totalEmitido).toBe(0);
    expect(Number.isInteger(todas.totalEmitido)).toBe(true);
  });

  it("16. totalEmitido respeta filtros y no depende de la página", async () => {
    expect((await listar({ forma: "contado", desde: "2026-10-01" })).totalEmitido).toBe(500_000);
    expect((await listar({ clienteId: String(mariana.id) })).totalEmitido).toBe(450_000);
    expect((await listar({ desde: "2026-10-01", page: "2", pageSize: "2" })).totalEmitido).toBe(950_000);
    expect((await listar({ q: "zzz-nadie" })).totalEmitido).toBe(0);
  });

  it("10. forma de cada renglón del listado: encabezado sin ítems", async () => {
    const lista = await listar({ q: f[1].numeroFormateado });
    expect(lista.data).toEqual([
      {
        id: f[1].id,
        puntoVenta: 1,
        numero: f[1].numero,
        numeroFormateado: f[1].numeroFormateado,
        fecha: "2026-10-06T02:30:00.000Z",
        estado: "emitida",
        cliente: { id: mariana.id, nombre: "Mariana López", tipoDoc: "DNI", nroDoc: mariana.nroDoc, domicilio: null },
        vendedor: { id: admin.id, nombre: "Laura Méndez" },
        formaPago: "tarjeta",
        total: 250_000,
      },
    ]);
    const cf = (await listar({ q: f[0].numeroFormateado })).data[0];
    expect(cf.cliente).toBeNull();
  });

  it("17. el listado no consulta factura_items", async () => {
    const espia = vi.spyOn(libsql, "execute");
    try {
      const lista = await listar({ pageSize: "100" });
      expect(lista.data.length).toBeGreaterThan(0);
      const sentencias = espia.mock.calls.map(([s]) => (typeof s === "string" ? s : String((s as { sql: string }).sql)));
      expect(sentencias.length).toBeGreaterThan(0);
      for (const sentencia of sentencias) expect(sentencia).not.toMatch(/factura_items/);
      for (const fila of lista.data) expect("items" in fila).toBe(false);
    } finally {
      espia.mockRestore();
    }
  });

  it("parámetros desconocidos → 422 VALIDACION; `q` demasiado largo → 422", async () => {
    const e = await fallo(listar({ orden: "total" }));
    expect(e).toMatchObject({ code: "VALIDACION", details: [{ campo: "orden", mensaje: "Campo no permitido." }] });
    expect((await fallo(listar({ q: "x".repeat(101) }))).code).toBe("VALIDACION");
    // Vacíos equivalen a no filtrar (formulario enviado sin completar).
    expect((await listar({ q: "", desde: "", hasta: "", clienteId: "", vendedorId: "", forma: "", estado: "" })).total).toBeGreaterThanOrEqual(6);
  });

  it("ambos roles listan; sin usuario → 401", async () => {
    expect((await listar({}, admin)).total).toBe((await listar({}, vendedor)).total);
    expect((await fallo(listarFacturas(null as never, {}))).code).toBe("NO_AUTENTICADO");
  });

  it("opciones de filtro: clientes y vendedores que figuran en facturas", async () => {
    const opciones = await opcionesFiltroFacturas(vendedor);
    expect(opciones.clientes.map((c) => c.id)).toEqual(expect.arrayContaining([mariana.id, jorge.id]));
    expect(opciones.vendedores.map((v) => v.id)).toEqual(expect.arrayContaining([admin.id, vendedor.id]));
    expect(Object.keys(opciones.vendedores[0])).toEqual(["id", "nombre"]);
  });
});

// ---------------------------------------------------------------------------
// RF-V7 — detalle
// ---------------------------------------------------------------------------

describe("detalle de una factura", () => {
  it("18. contado: misma forma que la emisión, con monto recibido y vuelto", async () => {
    const p = await nuevoProducto(190_000, { codigo: "DT-EL-001", descripcion: "Cinta aisladora 20 m" });
    const emitida = await emitirFactura(vendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "contado", montoRecibido: 400_000 } });
    const leida = await obtenerFactura(admin, { id: String(emitida.id) });
    expect(leida).toEqual(emitida);
    expect(leida.pago).toEqual({ forma: "contado", montoRecibido: 400_000, vuelto: 20_000 });
    expect(leida.cliente).toBeNull();
    expect(Object.keys(leida)).toEqual([
      "id", "puntoVenta", "numero", "numeroFormateado", "fecha", "estado", "cliente", "vendedor", "items", "total", "pago",
    ]);
  });

  it("19. tarjeta: solo tipo, marca y últimos 4", async () => {
    const p = await nuevoProducto(50_000);
    const emitida = await emitirFactura(vendedor, {
      clienteId: null,
      items: [{ productoId: p.id, cantidad: 1 }],
      pago: { forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Mastercard", ultimos4: "0042" } },
    });
    const leida = await obtenerFactura(vendedor, { id: String(emitida.id) });
    expect(leida).toEqual(emitida);
    expect(leida.pago).toEqual({ forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Mastercard", ultimos4: "0042" } });
  });

  it("20. cuenta corriente: conserva la forma y OMITE saldoCliente (no se guarda)", async () => {
    const p = await nuevoProducto(70_000);
    const c = await nuevoCliente({ nombre: "Cliente Cuenta", cuentaCorriente: true, domicilio: "Mitre 100" });
    const emitida = await emitirFactura(vendedor, { clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } });
    expect(emitida.saldoCliente).toBe(70_000);
    const leida = await obtenerFactura(vendedor, { id: String(emitida.id) });
    expect(leida.pago).toEqual({ forma: "cuenta_corriente" });
    expect("saldoCliente" in leida).toBe(false);
    expect(leida).toEqual({ ...emitida, saldoCliente: undefined });
    expect(leida.cliente).toEqual({ id: c.id, nombre: "Cliente Cuenta", tipoDoc: "DNI", nroDoc: c.nroDoc, domicilio: "Mitre 100" });
  });

  it("21. factura inexistente → 404 NO_ENCONTRADO; id inválido → 422 VALIDACION", async () => {
    expect(await fallo(obtenerFactura(vendedor, { id: "999999" }))).toMatchObject({ status: 404, code: "NO_ENCONTRADO" });
    for (const id of ["0", "-3", "abc", "1.5", ""]) {
      expect((await fallo(obtenerFactura(vendedor, { id }))).code).toBe("VALIDACION");
    }
    expect((await fallo(obtenerFactura(vendedor, { id: "1", extra: "x" }))).code).toBe("VALIDACION");
    expect((await fallo(obtenerFactura(null as never, { id: "1" }))).code).toBe("NO_AUTENTICADO");
  });

  it("22. datos congelados: cambiar producto, precio y cliente no altera la respuesta", async () => {
    const p = await nuevoProducto(123_400, { codigo: "DT-FRZ", descripcion: "Descripción original" });
    const c = await nuevoCliente({ nombre: "Comprador Original", domicilio: "Calle Vieja 1" });
    const emitida = await emitirFactura(vendedor, { clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    const antes = await obtenerFactura(vendedor, { id: String(emitida.id) });

    await actualizarProducto(admin, { id: String(p.id) }, { descripcion: "Descripción NUEVA", precio: 999_900, codigo: "DT-FRZ-2" });
    await actualizarCliente(admin, { id: String(c.id) }, { nombre: "Comprador NUEVO", domicilio: "Calle Nueva 2", tipoDoc: "DNI", nroDoc: String(++dni) });

    const despues = await obtenerFactura(vendedor, { id: String(emitida.id) });
    expect(despues).toEqual(antes);
    expect(despues.items[0]).toMatchObject({ codigo: "DT-FRZ", descripcion: "Descripción original", precioUnitario: 123_400 });
    expect(despues.cliente).toMatchObject({ nombre: "Comprador Original", domicilio: "Calle Vieja 1", nroDoc: c.nroDoc });
  });

  it("anulada: agrega `anulacion` con fecha, usuario y motivo; el resto no cambia", async () => {
    const p = await nuevoProducto(10_000);
    const emitida = await emitirFactura(vendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    const antes = Date.now();
    await anularFactura(admin, { id: String(emitida.id) }, { motivo: "  Cliente   desistió de la compra " });
    const leida = await obtenerFactura(vendedor, { id: String(emitida.id) });
    expect(leida.estado).toBe("anulada");
    expect(leida.anulacion).toEqual({
      fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      usuario: { id: admin.id, nombre: "Laura Méndez" },
      motivo: "Cliente desistió de la compra",
    });
    expect(Date.parse(leida.anulacion!.fecha)).toBeGreaterThanOrEqual(antes - 1000);
    expect({ ...leida, estado: "emitida", anulacion: undefined }).toEqual(emitida);
  });

  it("23. la representación no expone campos internos", async () => {
    const p = await nuevoProducto(10_000);
    const c = await nuevoCliente({ cuentaCorriente: true });
    const emitida = await emitirFactura(vendedor, {
      clienteId: c.id,
      items: [{ productoId: p.id, cantidad: 1 }],
      pago: { forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Visa", ultimos4: "1111" } },
    });
    await anularFactura(admin, { id: String(emitida.id) }, { motivo: "Prueba de campos internos" });
    const detalle = await obtenerFactura(vendedor, { id: String(emitida.id) });
    const lista = await listar({ q: emitida.numeroFormateado });
    for (const texto of [JSON.stringify(detalle), JSON.stringify(lista)]) {
      for (const interno of [
        "compradorNombre", "compradorTipoDoc", "compradorNroDoc", "compradorDomicilio", "vendedorId", "clienteId",
        "tarjetaTipo", "tarjetaMarca", "tarjetaUltimos4", "montoRecibido", "motivoAnulacion", "fechaAnulacion",
        "anuladaPorId", "anuladorId", "anuladorNombre", "creadoEn", "passwordHash", "email", "existencia", "facturaId", "rol",
      ]) {
        expect(texto).not.toContain(`"${interno}"`);
      }
    }
    expect(Object.keys(detalle.anulacion!)).toEqual(["fecha", "usuario", "motivo"]);
    expect(Object.keys(detalle.anulacion!.usuario)).toEqual(["id", "nombre"]);
  });
});
