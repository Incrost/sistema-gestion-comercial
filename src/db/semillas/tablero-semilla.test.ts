/**
 * El seed académico produce un tablero coherente (RF-T1 a RF-T3; sección 8:
 * «para que el tablero muestre información desde el primer arranque»).
 *
 * Carga el seed completo en una base SQLite temporal RECIÉN MIGRADA (nunca
 * local.db ni Turso) y compara el tablero con cálculos independientes hechos
 * en JavaScript a partir de las filas de la base.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { clientes, facturaItems, facturas, productos, usuarios } from "@/db/schema";
import { diaEnArgentina } from "@/lib/fechas";
import { obtenerUsuarioActivo, type UsuarioAutenticado } from "@/servicios/auth";
import { obtenerSaldo } from "@/servicios/cuenta-corriente";
import { conFechaSimulada } from "@/servicios/reloj";
import { calcularPeriodos, obtenerTablero, type Tablero } from "@/servicios/tablero";
import type { ModuloDbPrueba } from "@/test/base-de-prueba";

import { sembrarCatalogo } from "./catalogo";
import { sembrarClientes } from "./clientes";
import { CANTIDAD_FACTURAS_ACADEMICAS, fechaStockInicialSemilla, sembrarFacturas } from "./facturas";
import { sembrarUsuarios } from "./usuarios";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

const huellaLocalDb = () =>
  existsSync("local.db") ? createHash("sha256").update(readFileSync("local.db")).digest("hex") : null;
const huellaAntes = huellaLocalDb();

const referencia = new Date();
let tablero: Tablero;
let filas: { id: number; fecha: Date; total: number; formaPago: string; estado: string }[];

beforeAll(async () => {
  await sembrarUsuarios(db);
  const u = await db.select({ id: usuarios.id, rol: usuarios.rol }).from(usuarios);
  const admin = (await obtenerUsuarioActivo(u.find((x) => x.rol === "admin")!.id)) as UsuarioAutenticado;
  const vendedor = (await obtenerUsuarioActivo(u.find((x) => x.rol === "vendedor")!.id)) as UsuarioAutenticado;
  await conFechaSimulada(fechaStockInicialSemilla(referencia), () => sembrarCatalogo(admin));
  await sembrarClientes(admin);
  await sembrarFacturas({ admin, vendedor }, referencia);

  tablero = await conFechaSimulada(referencia, () => obtenerTablero(vendedor));
  filas = await db
    .select({ id: facturas.id, fecha: facturas.fecha, total: facturas.total, formaPago: facturas.formaPago, estado: facturas.estado })
    .from(facturas);
}, 120_000);

describe("tablero con el seed académico", () => {
  const periodos = () => calcularPeriodos(referencia);
  const emitidas = () => filas.filter((f) => f.estado === "emitida");
  const delMes = () => emitidas().filter((f) => f.fecha >= periodos().mes.desde && f.fecha < periodos().mes.hasta);
  const suma = (xs: { total: number }[]) => xs.reduce((s, f) => s + f.total, 0);

  it("el seed cargó 50 facturas, algunas anuladas", () => {
    expect(filas).toHaveLength(CANTIDAD_FACTURAS_ACADEMICAS);
    expect(filas.some((f) => f.estado === "anulada")).toBe(true);
  });

  it("hay ventas de hoy y coinciden con las facturas emitidas del día argentino", () => {
    const hoy = emitidas().filter((f) => diaEnArgentina(f.fecha) === periodos().dia);
    expect(tablero.hoy.cantidad).toBeGreaterThan(0);
    expect(tablero.hoy).toEqual({ cantidad: hoy.length, importe: suma(hoy) });
  });

  it("ventas del mes y ticket promedio coinciden con el cálculo independiente", () => {
    const mes = delMes();
    expect(tablero.mes.cantidad).toBe(mes.length);
    expect(tablero.mes.importe).toBe(suma(mes));
    expect(tablero.mes.ticketPromedio).toBe(mes.length ? Math.round(suma(mes) / mes.length) : 0);
  });

  it("las ventas diarias suman todas las emitidas de la ventana (las 50 caen en los últimos 30 días)", () => {
    expect(tablero.ventasDiarias).toHaveLength(30);
    expect(tablero.ventasDiarias.at(-1)!.fecha).toBe(periodos().dia);
    expect(tablero.ventasDiarias.reduce((s, v) => s + v.importe, 0)).toBe(suma(emitidas()));
    for (const { fecha, importe } of tablero.ventasDiarias) {
      expect(importe).toBe(suma(emitidas().filter((f) => diaEnArgentina(f.fecha) === fecha)));
    }
  });

  it("las formas de pago suman el importe del mes", () => {
    expect(tablero.porFormaDePago.map((f) => f.forma)).toEqual(["contado", "tarjeta", "cuenta_corriente"]);
    expect(tablero.porFormaDePago.reduce((s, f) => s + f.importe, 0)).toBe(tablero.mes.importe);
    for (const { forma, importe } of tablero.porFormaDePago) {
      expect(importe).toBe(suma(delMes().filter((f) => f.formaPago === forma)));
    }
  });

  it("cuentas corrientes: coincide con el saldo de cada cliente y hay deudas", async () => {
    const ids = (await db.select({ id: clientes.id }).from(clientes)).map((c) => c.id);
    const positivos = (await Promise.all(ids.map((id) => obtenerSaldo(db, id)))).filter((s) => s > 0);
    expect(tablero.cuentasCorrientes).toEqual({
      totalAdeudado: positivos.reduce((a, b) => a + b, 0),
      clientesConSaldo: positivos.length,
    });
    expect(tablero.cuentasCorrientes.clientesConSaldo).toBeGreaterThan(0);
  });

  it("productos bajo el mínimo: activos con existencia < stockMinimo", async () => {
    const todos = await db.select().from(productos).where(eq(productos.activo, true));
    expect(tablero.bajoMinimo.cantidad).toBe(todos.filter((p) => p.existencia < p.stockMinimo).length);
  });

  it("más vendidos: como máximo 5, ordenados y con las unidades de los renglones emitidos del mes", async () => {
    expect(tablero.masVendidos.length).toBeGreaterThan(0);
    expect(tablero.masVendidos.length).toBeLessThanOrEqual(5);
    const idsMes = new Set(delMes().map((f) => f.id));
    const items = (await db.select().from(facturaItems)).filter((i) => idsMes.has(i.facturaId));
    const unidades = new Map<number, number>();
    for (const i of items) unidades.set(i.productoId, (unidades.get(i.productoId) ?? 0) + i.cantidad);
    const maximo = Math.max(...unidades.values());
    expect(tablero.masVendidos[0].unidades).toBe(maximo);
    for (const p of tablero.masVendidos) expect(p.unidades).toBe(unidades.get(p.productoId));
    const orden = tablero.masVendidos.map((p) => p.unidades);
    expect([...orden].sort((a, b) => b - a)).toEqual(orden);
  });

  it("no modificó local.db", () => {
    expect(huellaLocalDb()).toBe(huellaAntes);
  });
});
