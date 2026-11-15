/**
 * Pruebas de RF-T3: los 5 productos más vendidos del mes (servicio del
 * tablero). Base SQLite temporal real; facturas emitidas con emitirFactura()
 * dentro de conFechaSimulada().
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import type { UsuarioAutenticado } from "./auth";
import { crearCategoria } from "./categorias";
import { anularFactura, emitirFactura } from "./facturas";
import { actualizarProducto, crearProducto, type ProductoPublico } from "./productos";
import { conFechaSimulada } from "./reloj";
import { CANTIDAD_MAS_VENDIDOS, obtenerTablero, type ProductoMasVendido } from "./tablero";

const { cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

const REFERENCIA = "2026-10-25T12:00:00-03:00";

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
  categoriaId = (await crearCategoria(admin, { nombre: "Más vendidos" })).id;
});

const tableroEn = (iso: string) => conFechaSimulada(new Date(iso), () => obtenerTablero(vendedor));

function producto(codigo: string, descripcion: string, precio: number) {
  return crearProducto(admin, { codigo, descripcion, categoriaId, precio, stockMinimo: 0, stockInicial: 500 });
}

/** Factura de contado con varios renglones, emitida en la fecha simulada `iso`. */
function vender(iso: string, items: [ProductoPublico, number][]) {
  return conFechaSimulada(new Date(iso), () =>
    emitirFactura(vendedor, {
      clienteId: null,
      items: items.map(([p, cantidad]) => ({ productoId: p.id, cantidad })),
      pago: { forma: "contado" },
    }),
  );
}

describe("sin ventas", () => {
  it("devuelve []", async () => {
    expect((await tableroEn(REFERENCIA)).masVendidos).toEqual([]);
  });
});

describe("cinco más vendidos del mes", () => {
  let p: Record<string, ProductoPublico>;
  let top: ProductoMasVendido[];

  beforeAll(async () => {
    p = {
      p1: await producto("MV-001", "Martillo original", 1_000),
      p2: await producto("MV-002", "Pinza", 2_000),
      p3: await producto("MV-003", "Destornillador", 3_000),
      p4: await producto("MV-004", "Cinta métrica", 1_000),
      p5: await producto("MV-005", "Nivel", 1_000),
      p6: await producto("MV-006", "Serrucho", 1_000),
      p7: await producto("MV-007", "Taladro", 1_000),
      p8: await producto("MV-008", "Llave inglesa", 1_000),
    };

    // P1: 4 u. a $ 10,00 y, tras subir el precio, 6 u. a $ 15,00 (precio congelado).
    await vender("2026-10-02T10:00:00-03:00", [[p.p1, 4], [p.p2, 3], [p.p4, 6]]);
    await actualizarProducto(admin, { id: String(p.p1.id) }, { precio: 1_500 });
    await vender("2026-10-05T10:00:00-03:00", [[p.p1, 6], [p.p2, 5], [p.p3, 8]]);
    await vender("2026-10-06T10:00:00-03:00", [[p.p5, 6], [p.p6, 3]]);

    // Anulada: P7 (20 u.) y P1 (50 u.) no deben contarse.
    const anulada = await vender("2026-10-07T10:00:00-03:00", [[p.p7, 20], [p.p1, 50]]);
    await conFechaSimulada(new Date("2026-10-07T11:00:00-03:00"), () =>
      anularFactura(admin, { id: String(anulada.id) }, { motivo: "Prueba de más vendidos" }),
    );

    // Septiembre: P8 (100 u.) es de otro mes.
    await vender("2026-09-30T23:00:00-03:00", [[p.p8, 100]]);

    // Después de vender, el catálogo cambia código y descripción de P1.
    await actualizarProducto(admin, { id: String(p.p1.id) }, { codigo: "MV-901", descripcion: "Martillo renombrado" });

    top = (await tableroEn(REFERENCIA)).masVendidos;
  });

  it("ordena por unidades de mayor a menor y devuelve como máximo cinco", () => {
    expect(top).toHaveLength(CANTIDAD_MAS_VENDIDOS);
    expect(top.map((t) => t.unidades)).toEqual([10, 8, 8, 6, 6]);
    // P6 (3 u.) queda sexto y no aparece.
    expect(top.map((t) => t.productoId)).not.toContain(p.p6.id);
  });

  it("desempate estable: a igual unidades, mayor importe; a igual importe, menor productoId", () => {
    // P3 y P2 tienen 8 u.: P3 vendió $ 240,00 y P2 $ 160,00.
    // P4 y P5 tienen 6 u. y $ 60,00: va primero el de menor id (P4).
    expect(top.map((t) => t.productoId)).toEqual([p.p1.id, p.p3.id, p.p2.id, p.p4.id, p.p5.id]);
  });

  it("excluye los renglones de facturas anuladas y de otros meses", () => {
    const ids = top.map((t) => t.productoId);
    expect(ids).not.toContain(p.p7.id);
    expect(ids).not.toContain(p.p8.id);
    expect(top[0].unidades).toBe(10); // sin las 50 u. anuladas de P1
  });

  it("importe = suma de los subtotales congelados", () => {
    expect(top[0].importe).toBe(4 * 1_000 + 6 * 1_500);
    expect(top.find((t) => t.productoId === p.p2.id)!.importe).toBe(8 * 2_000);
    expect(top.find((t) => t.productoId === p.p3.id)!.importe).toBe(8 * 3_000);
  });

  it("usa el código y la descripción congelados en la factura, no los del catálogo", () => {
    expect(top[0]).toEqual({
      productoId: p.p1.id,
      codigo: "MV-001",
      descripcion: "Martillo original",
      unidades: 10,
      importe: 13_000,
    });
  });

  it("es determinista: dos consultas devuelven el mismo orden", async () => {
    expect((await tableroEn(REFERENCIA)).masVendidos).toEqual(top);
  });

  it("solo considera el mes actual: en septiembre el único vendido es P8", async () => {
    const sep = (await tableroEn("2026-09-30T23:30:00-03:00")).masVendidos;
    expect(sep).toEqual([{ productoId: p.p8.id, codigo: "MV-008", descripcion: "Llave inglesa", unidades: 100, importe: 100_000 }]);
  });

  it("si un producto se vendió con dos descripciones en el mes, toma la del renglón más reciente", async () => {
    // P1 ahora se llama «Martillo renombrado» en el catálogo; una venta nueva la congela.
    await vender("2026-10-20T10:00:00-03:00", [[p.p1, 1]]);
    const primero = (await tableroEn(REFERENCIA)).masVendidos[0];
    expect(primero).toMatchObject({ productoId: p.p1.id, codigo: "MV-901", descripcion: "Martillo renombrado", unidades: 11 });
  });
});
