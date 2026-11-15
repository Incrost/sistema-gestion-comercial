/**
 * Pruebas de la anulación de facturas (RF-V9; reglas 2, 5, 7, 8 y 11;
 * decisión temporal C1; sección 10.8, puntos 3 y 5).
 *
 * Base SQLite temporal REAL, con claves foráneas, CHECK e índices únicos de
 * las migraciones: la atomicidad y la concurrencia no se simulan. Para
 * provocar fallas a mitad de la anulación se crean triggers que abortan:
 * - el cambio de estado (motivo «FALLA-ESTADO»);
 * - el movimiento de anulación de un producto con código «FALLA-ANUL», que
 *   puede ser el primer renglón o uno posterior;
 * - el crédito de cuenta corriente (cliente «Cliente FALLA-CREDITO»).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import { MOTIVO_ANULACION } from "@/config/motivos-stock";
import * as moduloDb from "@/db";
import { db } from "@/db";
import { facturas, movimientosCuenta, movimientosStock, productos } from "@/db/schema";
import { ApiError, normalizarError } from "@/lib/api-error";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import type { UsuarioAutenticado } from "./auth";
import { crearCategoria } from "./categorias";
import { crearCliente } from "./clientes";
import { obtenerSaldo } from "./cuenta-corriente";
import { anularFactura, emitirFactura, exigirAnulacionSinSaldoAFavor, obtenerFactura, type FacturaPublica } from "./facturas";
import { registrarPago } from "./pagos";
import { crearProducto } from "./productos";

const { cliente: libsql, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
let admin2: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin", nombre: "Laura Méndez" });
  const a2 = await crearUsuarioDePrueba(db, { email: "admin2@prueba.test", password: "clave-de-prueba-1", rol: "admin", nombre: "Segundo Admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  admin2 = { id: a2.id, nombre: a2.nombre, email: a2.email, rol: a2.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
  categoriaId = (await crearCategoria(admin, { nombre: "Anulación" })).id;

  await libsql.execute(`
    CREATE TRIGGER falla_estado BEFORE UPDATE OF estado ON facturas
    WHEN NEW.estado = 'anulada' AND NEW.motivo_anulacion = 'FALLA-ESTADO'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
  await libsql.execute(`
    CREATE TRIGGER falla_mov_anulacion BEFORE INSERT ON movimientos_stock
    WHEN NEW.tipo = 'anulacion' AND (SELECT codigo FROM productos WHERE id = NEW.producto_id) = 'FALLA-ANUL'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
  await libsql.execute(`
    CREATE TRIGGER falla_credito BEFORE INSERT ON movimientos_cuenta
    WHEN NEW.tipo = 'credito' AND NEW.factura_id IS NOT NULL
      AND (SELECT nombre FROM clientes WHERE id = NEW.cliente_id) = 'Cliente FALLA-CREDITO'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

let n = 0;
async function nuevoProducto(datos: { stock?: number; precio?: number; codigo?: string } = {}) {
  const codigo = datos.codigo ?? `AN-${++n}`;
  return crearProducto(admin, {
    codigo,
    descripcion: `Producto ${codigo}`,
    categoriaId,
    precio: datos.precio ?? 10_000,
    stockMinimo: 0,
    stockInicial: datos.stock ?? 20,
  });
}

let dni = 50_000_000;
const nuevoCliente = (datos: Record<string, unknown> = {}) =>
  crearCliente(admin, { tipoDoc: "DNI", nroDoc: String(++dni), nombre: `Cliente ${dni}`, cuentaCorriente: true, ...datos });

type Item = { productoId: number; cantidad: number };
const contado = (items: Item[]) => emitirFactura(vendedor, { clienteId: null, items, pago: { forma: "contado" } });
const tarjeta = (items: Item[]) =>
  emitirFactura(vendedor, { clienteId: null, items, pago: { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "1234" } } });
const aCuenta = (clienteId: number, items: Item[]) =>
  emitirFactura(vendedor, { clienteId, items, pago: { forma: "cuenta_corriente" } });

const anular = (factura: { id: number }, motivo = "Error en la carga de cantidades", usuario = admin) =>
  anularFactura(usuario, { id: String(factura.id) }, { motivo });

const pagar = (clienteId: number, importe: number) => registrarPago(vendedor, { id: String(clienteId) }, { importe, medio: "efectivo" });

/** Ejecuta y devuelve el error normalizado como lo vería la API (sin ensuciar el log). */
async function fallo(promesa: Promise<unknown>): Promise<ApiError> {
  const espia = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await promesa;
  } catch (error) {
    return normalizarError(error);
  } finally {
    espia.mockRestore();
  }
  throw new Error("Se esperaba un error");
}

async function existencia(id: number) {
  const [fila] = await db.select({ e: productos.existencia }).from(productos).where(eq(productos.id, id));
  return fila.e;
}

const contar = async (tabla: typeof movimientosStock | typeof movimientosCuenta) => (await db.select({ n: count() }).from(tabla))[0].n;

async function filaFactura(id: number) {
  const [fila] = await db.select().from(facturas).where(eq(facturas.id, id));
  return fila;
}

/** Foto de todo lo que una anulación podría modificar. */
async function instantanea(facturaId: number, productoIds: number[], clienteId?: number) {
  const f = await filaFactura(facturaId);
  return {
    estado: f.estado,
    motivo: f.motivoAnulacion,
    fecha: f.fechaAnulacion,
    anuladaPor: f.anuladaPorId,
    movimientosStock: await contar(movimientosStock),
    movimientosCuenta: await contar(movimientosCuenta),
    existencias: await Promise.all(productoIds.map(existencia)),
    saldo: clienteId === undefined ? null : await obtenerSaldo(db, clienteId),
  };
}

const movimientosAnulacion = (facturaId: number) =>
  db.select().from(movimientosStock).where(sql`${movimientosStock.facturaId} = ${facturaId} and ${movimientosStock.tipo} = 'anulacion'`).orderBy(movimientosStock.id);

const creditosDeFactura = (facturaId: number) =>
  db.select().from(movimientosCuenta).where(sql`${movimientosCuenta.facturaId} = ${facturaId} and ${movimientosCuenta.tipo} = 'credito'`);

/** Regla 2: la suma de movimientos de cada producto coincide con su existencia. */
async function esperarStockCuadrado() {
  const sumas = await db
    .select({ productoId: movimientosStock.productoId, suma: sql<number>`sum(${movimientosStock.cantidad})` })
    .from(movimientosStock)
    .groupBy(movimientosStock.productoId);
  const sumaPorProducto = new Map(sumas.map((s) => [s.productoId, Number(s.suma)]));
  const filas = await db.select({ id: productos.id, existencia: productos.existencia }).from(productos);
  for (const fila of filas) expect(sumaPorProducto.get(fila.id) ?? 0).toBe(fila.existencia);
}

// ---------------------------------------------------------------------------
// Casos felices
// ---------------------------------------------------------------------------

describe("anulación exitosa", () => {
  it("24/32/33/34/35. contado: anulada, stock reingresado, un movimiento por renglón y sin crédito", async () => {
    const p1 = await nuevoProducto({ stock: 10 });
    const p2 = await nuevoProducto({ stock: 5 });
    const f = await contado([{ productoId: p1.id, cantidad: 3 }, { productoId: p2.id, cantidad: 2 }]);
    expect([await existencia(p1.id), await existencia(p2.id)]).toEqual([7, 3]);
    const cuentaAntes = await contar(movimientosCuenta);
    const antes = Date.now();

    const anulada = await anular(f);

    expect(anulada.estado).toBe("anulada");
    expect(anulada.anulacion).toEqual({ fecha: expect.any(String), usuario: { id: admin.id, nombre: "Laura Méndez" }, motivo: "Error en la carga de cantidades" });
    expect(anulada).toEqual(await obtenerFactura(vendedor, { id: String(f.id) }));
    // La factura no cambia en nada más (regla 5) y sigue existiendo.
    expect({ ...anulada, estado: "emitida", anulacion: undefined }).toEqual(f);

    // 32. Reingreso de stock.
    expect([await existencia(p1.id), await existencia(p2.id)]).toEqual([10, 5]);

    // 33/34. Un movimiento de anulación por renglón, en el orden de la factura.
    const movs = await movimientosAnulacion(f.id);
    expect(movs).toHaveLength(2);
    expect(movs.map((m) => [m.productoId, m.cantidad, m.existenciaResultante])).toEqual([
      [p1.id, 3, 10],
      [p2.id, 2, 5],
    ]);
    for (const m of movs) {
      expect(m).toMatchObject({ tipo: "anulacion", usuarioId: admin.id, facturaId: f.id, motivo: MOTIVO_ANULACION, observacion: null });
      expect(m.cantidad).toBeGreaterThan(0);
      expect(m.fecha.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    }

    // 35. Contado no crea crédito.
    expect(await contar(movimientosCuenta)).toBe(cuentaAntes);
    expect(await creditosDeFactura(f.id)).toEqual([]);

    // Datos de anulación guardados (regla 11).
    const fila = await filaFactura(f.id);
    expect(fila).toMatchObject({ estado: "anulada", motivoAnulacion: "Error en la carga de cantidades", anuladaPorId: admin.id });
    expect(fila.fechaAnulacion!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    await esperarStockCuadrado();
  });

  it("25/36. tarjeta: reingresa stock y no crea crédito", async () => {
    const p = await nuevoProducto({ stock: 4 });
    const f = await tarjeta([{ productoId: p.id, cantidad: 4 }]);
    expect(await existencia(p.id)).toBe(0);
    const cuentaAntes = await contar(movimientosCuenta);
    const anulada = await anular(f, "Cobro duplicado con tarjeta");
    expect(anulada.pago).toEqual(f.pago);
    expect(await existencia(p.id)).toBe(4);
    expect(await movimientosAnulacion(f.id)).toHaveLength(1);
    expect(await contar(movimientosCuenta)).toBe(cuentaAntes);
    await esperarStockCuadrado();
  });

  it("26/37/39. cuenta corriente sin pagos: un único crédito por el total y el saldo vuelve al valor anterior", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ precio: 12_345, stock: 10 });
    const previa = await aCuenta(c.id, [{ productoId: p.id, cantidad: 1 }]); // deuda previa que no se toca
    const saldoAnterior = await obtenerSaldo(db, c.id);
    expect(saldoAnterior).toBe(12_345);

    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 3 }]);
    expect(await obtenerSaldo(db, c.id)).toBe(saldoAnterior + 37_035);

    const anulada = await anular(f);
    expect(anulada.pago).toEqual({ forma: "cuenta_corriente" });
    expect("saldoCliente" in anulada).toBe(false);

    const creditos = await creditosDeFactura(f.id);
    expect(creditos).toHaveLength(1);
    expect(creditos[0]).toMatchObject({ clienteId: c.id, tipo: "credito", importe: 37_035, facturaId: f.id, pagoId: null });
    expect(creditos[0].descripcion).toBe(`Anulación factura ${f.numeroFormateado}`);
    expect(creditos[0].fecha.getTime()).toBe(Date.parse(anulada.anulacion!.fecha));
    expect(await obtenerSaldo(db, c.id)).toBe(saldoAnterior);
    expect(await existencia(p.id)).toBe(9);
    expect((await creditosDeFactura(previa.id))).toEqual([]);
    await esperarStockCuadrado();
  });

  it("38. la suma de movimientos de stock coincide con la existencia tras varias ventas y anulaciones", async () => {
    const p = await nuevoProducto({ stock: 30 });
    const facturasEmitidas: FacturaPublica[] = [];
    for (let i = 1; i <= 4; i++) facturasEmitidas.push(await contado([{ productoId: p.id, cantidad: i }]));
    await anular(facturasEmitidas[1]);
    await anular(facturasEmitidas[3]);
    expect(await existencia(p.id)).toBe(30 - 1 - 3);
    await esperarStockCuadrado();
  });

  it("un producto dado de baja después de la venta no impide anular ni reingresar su stock", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ stock: 5 });
    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 2 }]);
    await db.update(productos).set({ activo: false }).where(eq(productos.id, p.id));
    const anulada = await anular(f);
    expect(anulada.estado).toBe("anulada");
    expect(await existencia(p.id)).toBe(5);
    expect(await obtenerSaldo(db, c.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validación, permisos y estado
// ---------------------------------------------------------------------------

describe("validación, permisos y estado", () => {
  it("27. el vendedor recibe 403 SIN_PERMISO y nada cambia", async () => {
    const p = await nuevoProducto();
    const f = await contado([{ productoId: p.id, cantidad: 1 }]);
    const antes = await instantanea(f.id, [p.id]);
    expect(await fallo(anular(f, "Motivo válido de prueba", vendedor))).toMatchObject({ status: 403, code: "SIN_PERMISO" });
    expect(await instantanea(f.id, [p.id])).toEqual(antes);
    expect((await fallo(anularFactura(null as never, { id: String(f.id) }, { motivo: "Motivo válido" }))).code).toBe("NO_AUTENTICADO");
  });

  it("28. motivo vacío, ausente, solo espacios, corto o largo → 422 VALIDACION", async () => {
    const p = await nuevoProducto();
    const f = await contado([{ productoId: p.id, cantidad: 1 }]);
    const antes = await instantanea(f.id, [p.id]);
    for (const datos of [{}, { motivo: "" }, { motivo: "    " }, { motivo: null }, { motivo: 123 }, { motivo: "abc" }, { motivo: "x".repeat(201) }]) {
      const e = await fallo(anularFactura(admin, { id: String(f.id) }, datos));
      expect(e).toMatchObject({ status: 422, code: "VALIDACION" });
      expect((e.details as { campo: string }[]).map((d) => d.campo)).toEqual(["motivo"]);
    }
    const vacio = await fallo(anularFactura(admin, { id: String(f.id) }, { motivo: "   " }));
    expect(vacio.details).toEqual([{ campo: "motivo", mensaje: "Es obligatorio." }]);
    expect((await fallo(anularFactura(admin, { id: String(f.id) }, null))).code).toBe("VALIDACION");
    expect(await instantanea(f.id, [p.id])).toEqual(antes);
  });

  it("29. campos adicionales → 422 VALIDACION y nada cambia", async () => {
    const p = await nuevoProducto();
    const f = await contado([{ productoId: p.id, cantidad: 1 }]);
    const antes = await instantanea(f.id, [p.id]);
    for (const extra of [
      { estado: "anulada" },
      { usuarioId: vendedor.id },
      { fecha: "2026-01-01T00:00:00Z" },
      { total: 0 },
      { items: [] },
      { clienteId: 1 },
      { cualquierOtro: true },
    ]) {
      const e = await fallo(anularFactura(admin, { id: String(f.id) }, { motivo: "Motivo válido de prueba", ...extra }));
      expect(e).toMatchObject({ status: 422, code: "VALIDACION" });
      expect((e.details as { campo: string }[]).map((d) => d.campo)).toEqual(Object.keys(extra));
    }
    expect(await instantanea(f.id, [p.id])).toEqual(antes);
  });

  it("30. factura inexistente → 404 NO_ENCONTRADO; id inválido → 422", async () => {
    expect(await fallo(anularFactura(admin, { id: "999999" }, { motivo: "Motivo válido" }))).toMatchObject({ status: 404, code: "NO_ENCONTRADO" });
    expect((await fallo(anularFactura(admin, { id: "abc" }, { motivo: "Motivo válido" }))).code).toBe("VALIDACION");
  });

  it("31. factura ya anulada → 409 FACTURA_ANULADA; la anulación original se conserva", async () => {
    const p = await nuevoProducto({ stock: 5 });
    const f = await contado([{ productoId: p.id, cantidad: 2 }]);
    await anular(f, "Primera anulación");
    const antes = await instantanea(f.id, [p.id]);
    expect(await fallo(anular(f, "Segunda anulación", admin2))).toMatchObject({ status: 409, code: "FACTURA_ANULADA" });
    expect(await instantanea(f.id, [p.id])).toEqual(antes);
    expect(antes).toMatchObject({ motivo: "Primera anulación", anuladaPor: admin.id, existencias: [5] });
  });
});

// ---------------------------------------------------------------------------
// Decisión temporal C1: factura a cuenta con pagos aplicados
// ---------------------------------------------------------------------------

describe("decisión C1: factura a cuenta con pagos aplicados", () => {
  it("la regla está centralizada en exigirAnulacionSinSaldoAFavor()", () => {
    expect(() => exigirAnulacionSinSaldoAFavor(1_000, 1_000)).not.toThrow();
    expect(() => exigirAnulacionSinSaldoAFavor(5_000, 1_000)).not.toThrow();
    const e = (() => {
      try {
        exigirAnulacionSinSaldoAFavor(999, 1_000);
      } catch (error) {
        return error as ApiError;
      }
    })();
    expect(e).toMatchObject({ status: 422, code: "VALIDACION", details: { saldoActual: 999, totalFactura: 1_000 } });
    expect(e!.message).toMatch(/pagos aplicados/);
  });

  it("40/42. parcialmente pagada: 422 VALIDACION con saldoActual y totalFactura; nada cambia", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ precio: 10_000, stock: 10 });
    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 2 }]); // 20.000
    await pagar(c.id, 5_000); // saldo 15.000
    const antes = await instantanea(f.id, [p.id], c.id);
    const e = await fallo(anular(f));
    expect(e).toMatchObject({ status: 422, code: "VALIDACION", details: { saldoActual: 15_000, totalFactura: 20_000 } });
    expect(e.message).toMatch(/pagos aplicados/);
    expect(JSON.stringify(e.aRespuesta())).not.toMatch(/SQL|select|movimientos_cuenta/i);
    expect(await instantanea(f.id, [p.id], c.id)).toEqual(antes);
    expect(antes).toMatchObject({ estado: "emitida", motivo: null, fecha: null, anuladaPor: null, saldo: 15_000 });
    expect(await creditosDeFactura(f.id)).toEqual([]);
    expect(await movimientosAnulacion(f.id)).toEqual([]);
  });

  it("41/42. totalmente pagada: 422 VALIDACION; nada cambia", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ precio: 10_000, stock: 10 });
    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 1 }]);
    await pagar(c.id, 10_000); // saldo 0
    const antes = await instantanea(f.id, [p.id], c.id);
    expect(await fallo(anular(f))).toMatchObject({ status: 422, code: "VALIDACION", details: { saldoActual: 0, totalFactura: 10_000 } });
    expect(await instantanea(f.id, [p.id], c.id)).toEqual(antes);
  });

  it("con otras deudas que cubren el total, se anula sin saldo a favor", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ precio: 10_000, stock: 10 });
    const f1 = await aCuenta(c.id, [{ productoId: p.id, cantidad: 3 }]); // 30.000
    const f2 = await aCuenta(c.id, [{ productoId: p.id, cantidad: 1 }]); // 10.000 → saldo 40.000
    await pagar(c.id, 25_000); // saldo 15.000 ≥ 10.000
    await anular(f2);
    expect(await obtenerSaldo(db, c.id)).toBe(5_000);
    // f1 (30.000) ya no puede anularse: dejaría saldo a favor.
    expect((await fallo(anular(f1))).details).toEqual({ saldoActual: 5_000, totalFactura: 30_000 });
  });
});

// ---------------------------------------------------------------------------
// Atomicidad: una falla en cualquier paso no deja nada
// ---------------------------------------------------------------------------

describe("atomicidad (rollback)", () => {
  it("43. falla al marcar la factura: no cambia estado, stock ni cuenta", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ stock: 10 });
    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 2 }]);
    const antes = await instantanea(f.id, [p.id], c.id);
    expect(await fallo(anular(f, "FALLA-ESTADO"))).toMatchObject({ status: 500, code: "ERROR_INTERNO" });
    expect(await instantanea(f.id, [p.id], c.id)).toEqual(antes);
  });

  it("44. falla el primer movimiento de anulación: revierte el estado", async () => {
    const pFalla = await nuevoProducto({ codigo: "FALLA-ANUL", stock: 10 });
    const p2 = await nuevoProducto({ stock: 10 });
    const f = await contado([{ productoId: pFalla.id, cantidad: 1 }, { productoId: p2.id, cantidad: 2 }]);
    const antes = await instantanea(f.id, [pFalla.id, p2.id]);
    expect((await fallo(anular(f))).code).toBe("ERROR_INTERNO");
    expect(await instantanea(f.id, [pFalla.id, p2.id])).toEqual(antes);
    expect(antes.estado).toBe("emitida");
  });

  it("45. falla un movimiento posterior: revierte los reingresos anteriores y el estado", async () => {
    const p1 = await nuevoProducto({ stock: 10 });
    const p2 = await nuevoProducto({ stock: 10 });
    const [pFalla] = await db.select().from(productos).where(eq(productos.codigo, "FALLA-ANUL"));
    const f = await contado([
      { productoId: p1.id, cantidad: 3 },
      { productoId: p2.id, cantidad: 1 },
      { productoId: pFalla.id, cantidad: 1 },
    ]);
    const antes = await instantanea(f.id, [p1.id, p2.id, pFalla.id]);
    expect((await fallo(anular(f))).code).toBe("ERROR_INTERNO");
    expect(await instantanea(f.id, [p1.id, p2.id, pFalla.id])).toEqual(antes);
    expect(await movimientosAnulacion(f.id)).toEqual([]);
    await esperarStockCuadrado();
  });

  it("46. falla el crédito: revierte estado, stock y movimientos", async () => {
    const c = await nuevoCliente({ nombre: "Cliente FALLA-CREDITO" });
    const p1 = await nuevoProducto({ stock: 10 });
    const p2 = await nuevoProducto({ stock: 10 });
    const f = await aCuenta(c.id, [{ productoId: p1.id, cantidad: 2 }, { productoId: p2.id, cantidad: 1 }]);
    const antes = await instantanea(f.id, [p1.id, p2.id], c.id);
    expect((await fallo(anular(f))).code).toBe("ERROR_INTERNO");
    expect(await instantanea(f.id, [p1.id, p2.id], c.id)).toEqual(antes);
    expect(await movimientosAnulacion(f.id)).toEqual([]);
    expect(await creditosDeFactura(f.id)).toEqual([]);
    await esperarStockCuadrado();
  });

  it("después de una falla, la misma factura se puede anular normalmente", async () => {
    const p = await nuevoProducto({ stock: 3 });
    const f = await contado([{ productoId: p.id, cantidad: 3 }]);
    expect((await fallo(anular(f, "FALLA-ESTADO"))).code).toBe("ERROR_INTERNO");
    expect((await anular(f, "Reintento luego de la falla")).estado).toBe("anulada");
    expect(await existencia(p.id)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Concurrencia
// ---------------------------------------------------------------------------

describe("concurrencia", () => {
  it("47/48. dos administradores anulan a la vez la misma factura de contado: solo una confirma", async () => {
    const p = await nuevoProducto({ stock: 10 });
    const f = await contado([{ productoId: p.id, cantidad: 4 }]);
    const resultados = await Promise.allSettled([anular(f, "Anula el primer admin", admin), anular(f, "Anula el segundo admin", admin2)]);
    const ok = resultados.filter((r): r is PromiseFulfilledResult<FacturaPublica> => r.status === "fulfilled");
    const rechazadas = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect(normalizarError(rechazadas[0].reason)).toMatchObject({ status: 409, code: "FACTURA_ANULADA" });
    // 48. El stock se reingresa una sola vez.
    expect(await existencia(p.id)).toBe(10);
    expect(await movimientosAnulacion(f.id)).toHaveLength(1);
    const fila = await filaFactura(f.id);
    expect(fila.anuladaPorId).toBe(ok[0].value.anulacion!.usuario.id);
    await esperarStockCuadrado();
  });

  it("47. dos anulaciones simultáneas de una factura a cuenta: un solo crédito", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ precio: 7_000, stock: 10 });
    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 2 }]);
    const resultados = await Promise.allSettled([anular(f, "Anula el primer admin", admin), anular(f, "Anula el segundo admin", admin2)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazo = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(normalizarError(rechazo.reason).code).toBe("FACTURA_ANULADA");
    expect(await creditosDeFactura(f.id)).toHaveLength(1);
    expect(await obtenerSaldo(db, c.id)).toBe(0);
    expect(await existencia(p.id)).toBe(10);
  });

  it("anulación y pago simultáneos sobre la misma deuda: el saldo nunca queda negativo", async () => {
    const c = await nuevoCliente();
    const p = await nuevoProducto({ precio: 10_000, stock: 10 });
    const f = await aCuenta(c.id, [{ productoId: p.id, cantidad: 1 }]);
    const resultados = await Promise.allSettled([anular(f), pagar(c.id, 10_000)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await obtenerSaldo(db, c.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Arquitectura
// ---------------------------------------------------------------------------

/** Archivos .ts/.tsx de una carpeta, recursivamente (sin pruebas). */
function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.ts$/.test(nombre) ? [ruta] : [];
  });
}

describe("arquitectura", () => {
  it("57. ningún archivo modifica la existencia fuera de moverStock() (src/servicios/stock.ts)", () => {
    const raiz = process.cwd();
    const archivos = [...fuentes(join(raiz, "src")), ...fuentes(join(raiz, "scripts"))];
    expect(archivos.length).toBeGreaterThan(20);
    const infractores = archivos.filter((archivo) => {
      if (relative(raiz, archivo).replace(/\\/g, "/") === "src/servicios/stock.ts") return false;
      const fuente = readFileSync(archivo, "utf8");
      return (
        /\.set\(\s*\{[^}]*\bexistencia\b/.test(fuente) ||
        /update\s+productos\s+set[^;]*existencia/i.test(fuente) ||
        /insert\(\s*movimientosStock\s*\)/.test(fuente)
      );
    });
    expect(infractores).toEqual([]);
  });

  it("el servicio de anulación delega en moverStock() y registrarCredito() y no borra facturas", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "servicios", "facturas.ts"), "utf8");
    expect(fuente).toMatch(/tipo: "anulacion"/);
    expect(fuente).toMatch(/registrarCredito\(tx,/);
    expect(fuente).not.toMatch(/\.delete\(/);
    expect(fuente).not.toMatch(/insert\(\s*(movimientosStock|movimientosCuenta)\s*\)/);
    expect(fuente).not.toMatch(/\.update\(\s*facturaItems\s*\)/);
  });
});
