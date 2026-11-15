/**
 * Pruebas de integración de las rutas de consulta y anulación de facturas
 * (RF-V7, RF-V8, RF-V9; sección 11.6):
 *   GET  /api/facturas
 *   GET  /api/facturas/{id}
 *   POST /api/facturas/{id}/anulacion
 *
 * Se llama a cada Route Handler con un NextRequest, igual que Next.js, contra
 * una base SQLite temporal (no toca local.db ni Turso).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { productos, usuarios } from "@/db/schema";
import { firmarSesion } from "@/lib/sesion-token";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { crearCategoria } from "@/servicios/categorias";
import { crearCliente } from "@/servicios/clientes";
import { obtenerSaldo } from "@/servicios/cuenta-corriente";
import type { FacturaPublica, ListaFacturas } from "@/servicios/facturas";
import { crearProducto } from "@/servicios/productos";
import { conId, esperarError, esperarJson, pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import * as rutaAnulacion from "./[id]/anulacion/route";
import * as rutaFactura from "./[id]/route";
import * as rutaProximo from "./proximo-numero/route";
import * as rutaFacturas from "./route";

const { cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

// local.db no debe cambiar durante las pruebas.
const RUTA_LOCAL_DB = join(process.cwd(), "local.db");
const huella = () =>
  existsSync(RUTA_LOCAL_DB) ? createHash("sha256").update(readFileSync(RUTA_LOCAL_DB)).digest("hex") : "sin-archivo";
const huellaInicial = huella();

let admin: UsuarioAutenticado;
let cookieAdmin: string;
let cookieVendedor: string;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin", nombre: "Laura Méndez" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  cookieAdmin = await firmarSesion(a.id);
  cookieVendedor = await firmarSesion(v.id);
  categoriaId = (await crearCategoria(admin, { nombre: "Rutas de consulta" })).id;
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

const listar = (cookie: string | undefined, consulta = "") =>
  rutaFacturas.GET(pedido(`/api/facturas${consulta}`, { cookie }), sinParametros);
const detalle = (cookie: string | undefined, id: number | string) =>
  rutaFactura.GET(pedido(`/api/facturas/${id}`, { cookie }), conId(id));
const anular = (cookie: string | undefined, id: number | string, cuerpo: object | string) =>
  rutaAnulacion.POST(pedido(`/api/facturas/${id}/anulacion`, { metodo: "POST", cookie, cuerpo }), conId(id));
const emitir = (cookie: string, cuerpo: object) =>
  rutaFacturas.POST(pedido("/api/facturas", { metodo: "POST", cookie, cuerpo }), sinParametros);

let n = 0;
async function nuevoProducto(stock = 10, precio = 100_000) {
  const codigo = `RC-${++n}`;
  return crearProducto(admin, { codigo, descripcion: `Producto ${codigo}`, categoriaId, precio, stockMinimo: 0, stockInicial: stock });
}

let dni = 25_000_000;
const nuevoCliente = (datos: Record<string, unknown> = {}) =>
  crearCliente(admin, { tipoDoc: "DNI", nroDoc: String(++dni), nombre: `Cliente ${dni}`, ...datos });

async function existencia(id: number) {
  const [fila] = await db.select({ e: productos.existencia }).from(productos).where(eq(productos.id, id));
  return fila.e;
}

async function emitirContado(cookie = cookieVendedor, cantidad = 1, productoId?: number) {
  const id = productoId ?? (await nuevoProducto()).id;
  return esperarJson<FacturaPublica>(
    await emitir(cookie, { clienteId: null, items: [{ productoId: id, cantidad }], pago: { forma: "contado" } }),
    201,
  );
}

// ---------------------------------------------------------------------------
// GET /api/facturas
// ---------------------------------------------------------------------------

describe("GET /api/facturas", () => {
  it("49. 200 con { data, page, pageSize, total, totalEmitido } para ambos roles (listado vacío)", async () => {
    for (const cookie of [cookieAdmin, cookieVendedor]) {
      const lista = await esperarJson<ListaFacturas>(await listar(cookie), 200);
      expect(lista).toEqual({ data: [], page: 1, pageSize: 20, total: 0, totalEmitido: 0 });
    }
  });

  it("49. filtros y paginación por la URL; totalEmitido excluye anuladas", async () => {
    const f1 = await emitirContado();
    const f2 = await emitirContado(cookieAdmin);
    await esperarJson(await anular(cookieAdmin, f1.id, { motivo: "Anulada para la prueba" }), 200);

    const todas = await esperarJson<ListaFacturas>(await listar(cookieVendedor, "?pageSize=1"), 200);
    expect(todas).toMatchObject({ page: 1, pageSize: 1, total: 2, totalEmitido: f2.total });
    expect(todas.data.map((f) => f.id)).toEqual([f2.id]);
    expect(Object.keys(todas.data[0])).toEqual([
      "id", "puntoVenta", "numero", "numeroFormateado", "fecha", "estado", "cliente", "vendedor", "formaPago", "total",
    ]);

    const anuladas = await esperarJson<ListaFacturas>(await listar(cookieVendedor, "?estado=anulada&forma=contado"), 200);
    expect(anuladas.data.map((f) => f.id)).toEqual([f1.id]);
    expect(anuladas.totalEmitido).toBe(0);

    const porNumero = await esperarJson<ListaFacturas>(await listar(cookieVendedor, `?q=${f2.numeroFormateado}`), 200);
    expect(porNumero.data.map((f) => f.id)).toEqual([f2.id]);
  });

  it("parámetros inválidos o desconocidos → 422 VALIDACION", async () => {
    await esperarError(await listar(cookieVendedor, "?desde=2026-10-10&hasta=2026-10-01"), 422, "VALIDACION");
    await esperarError(await listar(cookieVendedor, "?pageSize=101"), 422, "VALIDACION");
    await esperarError(await listar(cookieVendedor, "?forma=efectivo"), 422, "VALIDACION");
    const e = await esperarError(await listar(cookieVendedor, "?ordenar=total"), 422, "VALIDACION");
    expect(e.error.details).toEqual([{ campo: "ordenar", mensaje: "Campo no permitido." }]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/facturas/{id}
// ---------------------------------------------------------------------------

describe("GET /api/facturas/{id}", () => {
  it("50. 200 con la misma forma que la emisión (sin saldoCliente) para ambos roles", async () => {
    const p = await nuevoProducto(10, 50_000);
    const c = await nuevoCliente({ nombre: "Mariana López", cuentaCorriente: true, domicilio: "Las Heras 455" });
    const emitida = await esperarJson<FacturaPublica>(
      await emitir(cookieVendedor, { clienteId: c.id, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } }),
      201,
    );
    const { saldoCliente, ...sinSaldo } = emitida;
    expect(saldoCliente).toBe(100_000);
    for (const cookie of [cookieAdmin, cookieVendedor]) {
      expect(await esperarJson<FacturaPublica>(await detalle(cookie, emitida.id), 200)).toEqual(sinSaldo);
    }
  });

  it("21. inexistente → 404 NO_ENCONTRADO; id inválido → 422 VALIDACION", async () => {
    await esperarError(await detalle(cookieVendedor, 999_999), 404, "NO_ENCONTRADO");
    await esperarError(await detalle(cookieVendedor, "abc"), 422, "VALIDACION");
    await esperarError(await detalle(cookieVendedor, "0"), 422, "VALIDACION");
  });

  it("el segmento fijo proximo-numero sigue funcionando junto a [id]", async () => {
    const r = await esperarJson<{ numeroFormateado: string }>(
      await rutaProximo.GET(pedido("/api/facturas/proximo-numero", { cookie: cookieVendedor }), sinParametros),
      200,
    );
    expect(r.numeroFormateado).toMatch(/^0001-\d{8}$/);
    // Si "proximo-numero" llegara a [id], sería un id inválido (422), nunca una factura.
    await esperarError(await detalle(cookieVendedor, "proximo-numero"), 422, "VALIDACION");
  });
});

// ---------------------------------------------------------------------------
// POST /api/facturas/{id}/anulacion
// ---------------------------------------------------------------------------

describe("POST /api/facturas/{id}/anulacion", () => {
  it("51. admin: 200 con la factura anulada; stock reingresado", async () => {
    const p = await nuevoProducto(5);
    const f = await emitirContado(cookieVendedor, 3, p.id);
    expect(await existencia(p.id)).toBe(2);
    const anulada = await esperarJson<FacturaPublica>(await anular(cookieAdmin, f.id, { motivo: "  Error en la carga de cantidades  " }), 200);
    expect(anulada).toMatchObject({ id: f.id, estado: "anulada", anulacion: { usuario: { id: admin.id, nombre: "Laura Méndez" }, motivo: "Error en la carga de cantidades" } });
    expect(await existencia(p.id)).toBe(5);
    expect(await esperarJson<FacturaPublica>(await detalle(cookieVendedor, f.id), 200)).toEqual(anulada);
  });

  it("51. cuenta corriente sin pagos: 200 y el saldo vuelve a 0", async () => {
    const p = await nuevoProducto(5, 30_000);
    const c = await nuevoCliente({ cuentaCorriente: true });
    const f = await esperarJson<FacturaPublica>(
      await emitir(cookieVendedor, { clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }),
      201,
    );
    await esperarJson(await anular(cookieAdmin, f.id, { motivo: "Venta cargada por error" }), 200);
    expect(await obtenerSaldo(db, c.id)).toBe(0);
  });

  it("27. vendedor → 403 SIN_PERMISO y nada cambia", async () => {
    const p = await nuevoProducto(5);
    const f = await emitirContado(cookieVendedor, 1, p.id);
    await esperarError(await anular(cookieVendedor, f.id, { motivo: "Intento del vendedor" }), 403, "SIN_PERMISO");
    expect((await esperarJson<FacturaPublica>(await detalle(cookieVendedor, f.id), 200)).estado).toBe("emitida");
    expect(await existencia(p.id)).toBe(4);
  });

  it("errores: 404, 409 FACTURA_ANULADA, 422 motivo vacío o campos extra, 422 pagos aplicados (C1)", async () => {
    await esperarError(await anular(cookieAdmin, 999_999, { motivo: "Motivo válido" }), 404, "NO_ENCONTRADO");

    const f = await emitirContado();
    const vacio = await esperarError(await anular(cookieAdmin, f.id, { motivo: "" }), 422, "VALIDACION");
    expect(vacio.error.details).toEqual([{ campo: "motivo", mensaje: "Es obligatorio." }]);
    await esperarError(await anular(cookieAdmin, f.id, {}), 422, "VALIDACION");
    const extra = await esperarError(await anular(cookieAdmin, f.id, { motivo: "Motivo válido", estado: "anulada" }), 422, "VALIDACION");
    expect((extra.error.details as { campo: string }[]).map((d) => d.campo)).toEqual(["estado"]);

    await esperarJson(await anular(cookieAdmin, f.id, { motivo: "Primera anulación" }), 200);
    await esperarError(await anular(cookieAdmin, f.id, { motivo: "Segunda anulación" }), 409, "FACTURA_ANULADA");

    const p = await nuevoProducto(5, 10_000);
    const c = await nuevoCliente({ cuentaCorriente: true });
    const fc = await esperarJson<FacturaPublica>(
      await emitir(cookieVendedor, { clienteId: c.id, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } }),
      201,
    );
    const { registrarPago } = await import("@/servicios/pagos");
    await registrarPago(admin, { id: String(c.id) }, { importe: 5_000, medio: "efectivo" });
    const c1 = await esperarError(await anular(cookieAdmin, fc.id, { motivo: "Intento con pagos" }), 422, "VALIDACION");
    expect(c1.error.details).toEqual({ saldoActual: 15_000, totalFactura: 20_000 });
    expect(c1.error.message).toMatch(/pagos aplicados/);
    expect(await existencia(p.id)).toBe(3);
  });

  it("52. JSON inválido o vacío → 400 JSON_INVALIDO", async () => {
    const f = await emitirContado();
    await esperarError(await anular(cookieAdmin, f.id, "{roto"), 400, "JSON_INVALIDO");
    await esperarError(await anular(cookieAdmin, f.id, ""), 400, "JSON_INVALIDO");
  });
});

// ---------------------------------------------------------------------------
// Sesión, métodos y arquitectura
// ---------------------------------------------------------------------------

describe("sesión, métodos y arquitectura", () => {
  it("53. sin sesión o con cookie manipulada → 401 en las tres rutas", async () => {
    for (const cookie of [undefined, "cookie-manipulada"]) {
      await esperarError(await listar(cookie), 401, "NO_AUTENTICADO");
      await esperarError(await detalle(cookie, 1), 401, "NO_AUTENTICADO");
      await esperarError(await anular(cookie, 1, { motivo: "Motivo válido" }), 401, "NO_AUTENTICADO");
    }
  });

  it("54. un usuario desactivado pierde el acceso aunque conserve la cookie", async () => {
    const u = await crearUsuarioDePrueba(db, { email: "baja@prueba.test", password: "clave-prueba-1", rol: "admin" });
    const cookie = await firmarSesion(u.id);
    const f = await emitirContado();
    await esperarJson(await listar(cookie), 200);
    await esperarJson(await detalle(cookie, f.id), 200);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, u.id));
    await esperarError(await listar(cookie), 401, "NO_AUTENTICADO");
    await esperarError(await detalle(cookie, f.id), 401, "NO_AUTENTICADO");
    await esperarError(await anular(cookie, f.id, { motivo: "Motivo válido" }), 401, "NO_AUTENTICADO");
    expect((await esperarJson<FacturaPublica>(await detalle(cookieVendedor, f.id), 200)).estado).toBe("emitida");
  });

  it("55. no existe DELETE ni PATCH de factura", () => {
    const metodos = (modulo: object) => Object.keys(modulo).filter((m) => /^[A-Z]+$/.test(m)).sort();
    expect(metodos(rutaFacturas)).toEqual(["GET", "POST"]);
    expect(metodos(rutaFactura)).toEqual(["GET"]);
    expect(metodos(rutaAnulacion)).toEqual(["POST"]);
    for (const modulo of [rutaFacturas, rutaFactura, rutaAnulacion]) {
      expect("DELETE" in modulo).toBe(false);
      expect("PATCH" in modulo).toBe(false);
      expect("PUT" in modulo).toBe(false);
    }
  });

  it("56. las rutas son adaptadores finos: solo llaman al servicio", () => {
    for (const archivo of ["route.ts", join("[id]", "route.ts"), join("[id]", "anulacion", "route.ts")]) {
      const fuente = readFileSync(join(process.cwd(), "src", "app", "api", "facturas", archivo), "utf8");
      const imports = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
      expect(imports).toEqual(["@/lib/http/ruta", "@/servicios/facturas"]);
      expect(fuente).toMatch(/rutaProtegida/);
      expect(fuente).not.toMatch(/ApiError|@\/db|moverStock|registrarCredito|registrarDebito|exigirRol|estado\s*[=:]|existencia|z\./);
    }
  });

  it("58. las pruebas no modifican local.db", () => {
    expect(huella()).toBe(huellaInicial);
  });
});
