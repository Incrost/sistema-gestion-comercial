/**
 * Pruebas de los datos iniciales del catálogo (secciones 8 y 10.7):
 * cantidades, idempotencia y coherencia del stock (regla 2). Base temporal.
 */
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { categorias, movimientosStock, productos, usuarios } from "@/db/schema";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { CATEGORIAS_SEMILLA, PRODUCTOS_SEMILLA, sembrarCatalogo } from "./catalogo";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
beforeAll(async () => {
  const fila = await crearUsuarioDePrueba(db, {
    email: "admin@prueba.test",
    password: "clave-prueba-1",
    rol: "admin",
  });
  admin = { id: fila.id, nombre: fila.nombre, email: fila.email, rol: fila.rol };
});

async function totales() {
  const [[c], [p], [m], [u]] = await Promise.all([
    db.select({ n: count() }).from(categorias),
    db.select({ n: count() }).from(productos),
    db.select({ n: count() }).from(movimientosStock),
    db.select({ n: count() }).from(usuarios),
  ]);
  return { categorias: c.n, productos: p.n, movimientos: m.n, usuarios: u.n };
}

const MOVIMIENTOS_ESPERADOS =
  PRODUCTOS_SEMILLA.filter((p) => p.stockInicial > 0).length +
  PRODUCTOS_SEMILLA.reduce((suma, p) => suma + (p.movimientos?.length ?? 0), 0);

describe("sembrarCatalogo()", () => {
  it("los datos cumplen el mínimo de la consigna", () => {
    expect(CATEGORIAS_SEMILLA.length).toBeGreaterThanOrEqual(5);
    expect(PRODUCTOS_SEMILLA).toHaveLength(30);
    expect(new Set(PRODUCTOS_SEMILLA.map((p) => p.codigo)).size).toBe(30);
    expect(PRODUCTOS_SEMILLA.some((p) => p.activo === false)).toBe(true);
    expect(PRODUCTOS_SEMILLA.every((p) => Number.isInteger(p.precio) && p.precio > 0)).toBe(true);
  });

  it("crea las categorías, los 30 productos y su stock inicial mediante movimientos", async () => {
    expect(await sembrarCatalogo(admin)).toEqual({
      categoriasCreadas: CATEGORIAS_SEMILLA.length,
      categoriasExistentes: 0,
      productosCreados: 30,
      productosExistentes: 0,
      movimientosCreados: MOVIMIENTOS_ESPERADOS,
    });
    expect(await totales()).toEqual({
      categorias: CATEGORIAS_SEMILLA.length,
      productos: 30,
      movimientos: MOVIMIENTOS_ESPERADOS,
      usuarios: 1, // no toca los usuarios
    });
  });

  it("es idempotente: una segunda ejecución no duplica nada", async () => {
    const antes = await totales();
    expect(await sembrarCatalogo(admin)).toEqual({
      categoriasCreadas: 0,
      categoriasExistentes: CATEGORIAS_SEMILLA.length,
      productosCreados: 0,
      productosExistentes: 30,
      movimientosCreados: 0,
    });
    expect(await totales()).toEqual(antes);
  });

  it("la existencia de cada producto coincide con la suma de sus movimientos (regla 2)", async () => {
    const filas = await db
      .select({
        codigo: productos.codigo,
        existencia: productos.existencia,
        suma: sql<number>`coalesce(sum(${movimientosStock.cantidad}), 0)`,
      })
      .from(productos)
      .leftJoin(movimientosStock, eq(movimientosStock.productoId, productos.id))
      .groupBy(productos.id);
    expect(filas).toHaveLength(30);
    for (const fila of filas) expect(fila.suma, fila.codigo).toBe(fila.existencia);
  });

  it("hay productos bajo el mínimo, uno inactivo y distintos niveles de existencia", async () => {
    const todos = await db.select().from(productos);
    expect(todos.filter((p) => p.activo && p.existencia < p.stockMinimo).length).toBeGreaterThanOrEqual(3);
    expect(todos.filter((p) => !p.activo).map((p) => p.codigo)).toEqual(["JA-005"]);
    expect(new Set(todos.map((p) => p.existencia)).size).toBeGreaterThan(10);

    // Trazabilidad (regla 11): todos los movimientos a nombre del administrador.
    const ajenos = await db
      .select({ id: movimientosStock.id })
      .from(movimientosStock)
      .where(sql`${movimientosStock.usuarioId} <> ${admin.id}`);
    expect(ajenos).toHaveLength(0);
    const [{ n }] = await db
      .select({ n: count() })
      .from(movimientosStock)
      .where(eq(movimientosStock.motivo, "Stock inicial"));
    expect(n).toBe(PRODUCTOS_SEMILLA.filter((p) => p.stockInicial > 0).length);
  });
});
