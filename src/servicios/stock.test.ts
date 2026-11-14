/**
 * Pruebas de moverStock() y de las transacciones (reglas 1 y 2; RF-P2, RF-P4,
 * RF-P5; sección 10.8, puntos 3, 4 y 5).
 *
 * Usan una base SQLite temporal REAL: la atomicidad no se simula. Para provocar
 * una falla a mitad de la operación se crea un trigger que aborta la
 * inserción del movimiento DESPUÉS de que el UPDATE de la existencia ya corrió.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { movimientosStock, productos } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import type { UsuarioAutenticado } from "./auth";
import { crearCategoria } from "./categorias";
import { actualizarProducto, crearProducto } from "./productos";
import { moverStock, registrarMovimientoManual } from "./stock";

const { cliente, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
  categoriaId = (await crearCategoria(admin, { nombre: "Stock" })).id;

  // Falla simulada en la BASE: aborta la inserción del movimiento de los
  // productos cuyo código empieza con FALLA-.
  await cliente.execute(`
    CREATE TRIGGER falla_simulada BEFORE INSERT ON movimientos_stock
    WHEN (SELECT codigo FROM productos WHERE id = NEW.producto_id) LIKE 'FALLA-%'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
});

let n = 0;
async function nuevoProducto(stockInicial = 0, codigo = `ST-${++n}`) {
  return crearProducto(admin, {
    codigo,
    descripcion: `Producto ${codigo}`,
    categoriaId,
    precio: 1000,
    stockMinimo: 0,
    stockInicial,
  });
}

async function existencia(id: number) {
  const [fila] = await db.select({ e: productos.existencia }).from(productos).where(eq(productos.id, id));
  return fila?.e;
}

async function movimientosDe(id: number) {
  return db.select().from(movimientosStock).where(eq(movimientosStock.productoId, id));
}

/** El error (o alguna de sus causas) es el RAISE del trigger de la base. */
function esFallaSimulada(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e.message.includes("falla simulada")) return true;
  }
  return false;
}

async function capturar(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un error");
}

describe("moverStock()", () => {
  it("ingreso: suma la existencia y graba el movimiento positivo con usuario y fecha", async () => {
    const p = await nuevoProducto(2);
    const antes = Date.now();
    const mov = await moverStock(admin, { productoId: p.id, tipo: "ingreso", cantidad: 5, motivo: "Reposición" });
    expect(mov).toMatchObject({
      tipo: "ingreso",
      cantidad: 5,
      existenciaResultante: 7,
      motivo: "Reposición",
      observacion: null,
      referencia: null,
      usuario: { id: admin.id, nombre: admin.nombre },
      producto: { id: p.id, codigo: p.codigo },
    });
    expect(Date.parse(mov.fecha)).toBeGreaterThanOrEqual(antes - 1000);
    expect(await existencia(p.id)).toBe(7);
  });

  it("egreso: resta la existencia y graba la cantidad con signo negativo", async () => {
    const p = await nuevoProducto(10);
    const mov = await moverStock(admin, {
      productoId: p.id, tipo: "egreso", cantidad: 4, motivo: "Rotura", observacion: "Caída",
    });
    expect(mov).toMatchObject({ cantidad: -4, existenciaResultante: 6, observacion: "Caída" });
    expect(await existencia(p.id)).toBe(6);
  });

  it("egreso insuficiente: 409 STOCK_INSUFICIENTE, sin cambiar la existencia ni crear movimiento", async () => {
    const p = await nuevoProducto(3);
    const error = await capturar(
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 4, motivo: "Rotura" }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "STOCK_INSUFICIENTE",
      details: [{ productoId: p.id, solicitado: 4, disponible: 3 }],
    });
    expect(await existencia(p.id)).toBe(3);
    expect(await movimientosDe(p.id)).toHaveLength(1); // solo el stock inicial
  });

  it("permite dejar la existencia exactamente en 0, nunca negativa", async () => {
    const p = await nuevoProducto(2);
    await moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 2, motivo: "Uso interno" });
    expect(await existencia(p.id)).toBe(0);
    await expect(
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 1, motivo: "Uso interno" }),
    ).rejects.toMatchObject({ code: "STOCK_INSUFICIENTE" });
  });

  it("producto inexistente: 404", async () => {
    await expect(
      moverStock(admin, { productoId: 999999, tipo: "ingreso", cantidad: 1, motivo: "Reposición" }),
    ).rejects.toMatchObject({ status: 404, code: "NO_ENCONTRADO" });
  });

  it("permisos según el origen: el vendedor no hace ingresos, egresos ni anulaciones", async () => {
    const p = await nuevoProducto(5);
    for (const [tipo, motivo] of [["ingreso", "Reposición"], ["egreso", "Rotura"]]) {
      await expect(
        moverStock(vendedor, { productoId: p.id, tipo, cantidad: 1, motivo }),
      ).rejects.toMatchObject({ status: 403, code: "SIN_PERMISO" });
    }
    await expect(
      moverStock(vendedor, { productoId: p.id, tipo: "anulacion", cantidad: 1, motivo: "Anulación", facturaId: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await existencia(p.id)).toBe(5);
  });

  it("valida los datos antes de tocar la base", async () => {
    const p = await nuevoProducto(5);
    await expect(
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 0, motivo: "Rotura" }),
    ).rejects.toThrow();
    await expect(
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 1, motivo: "Inventado" }),
    ).rejects.toThrow();
    expect(await existencia(p.id)).toBe(5);
  });

  it("la suma de los movimientos coincide con la existencia (regla 2)", async () => {
    const p = await nuevoProducto(10);
    await registrarMovimientoManual(admin, { id: String(p.id) }, { tipo: "egreso", cantidad: 3, motivo: "Rotura" });
    await registrarMovimientoManual(admin, { id: String(p.id) }, { tipo: "ingreso", cantidad: 8, motivo: "Reposición" });
    const [{ suma }] = await db
      .select({ suma: sql<number>`sum(${movimientosStock.cantidad})` })
      .from(movimientosStock)
      .where(eq(movimientosStock.productoId, p.id));
    expect(suma).toBe(15);
    expect(await existencia(p.id)).toBe(15);
  });
});

describe("transacciones reales (rollback)", () => {
  it("alta con stock inicial: producto y movimiento se graban juntos", async () => {
    const p = await nuevoProducto(12);
    expect(p.existencia).toBe(12);
    const movs = await movimientosDe(p.id);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ tipo: "ingreso", cantidad: 12, existenciaResultante: 12, motivo: "Stock inicial" });
  });

  it("si falla el movimiento inicial, el producto no queda creado", async () => {
    expect(esFallaSimulada(await capturar(nuevoProducto(5, "FALLA-ALTA")))).toBe(true);
    const filas = await db.select().from(productos).where(eq(productos.codigo, "FALLA-ALTA"));
    expect(filas).toHaveLength(0);
    // El código quedó libre: la transacción se revirtió por completo.
    await cliente.execute("DROP TRIGGER falla_simulada");
    try {
      const p = await nuevoProducto(5, "FALLA-ALTA");
      expect(p.existencia).toBe(5);
    } finally {
      await cliente.execute(`
        CREATE TRIGGER falla_simulada BEFORE INSERT ON movimientos_stock
        WHEN (SELECT codigo FROM productos WHERE id = NEW.producto_id) LIKE 'FALLA-%'
        BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
    }
  });

  it("una falla después de actualizar la existencia revierte la operación completa", async () => {
    // Sin stock inicial no se inserta movimiento, así que el alta funciona.
    const p = await nuevoProducto(0, "FALLA-MOV");
    const error = await capturar(
      moverStock(admin, { productoId: p.id, tipo: "ingreso", cantidad: 3, motivo: "Reposición" }),
    );
    expect(esFallaSimulada(error)).toBe(true);
    // El UPDATE de la existencia corrió antes del INSERT que falló, y se revirtió.
    expect(await existencia(p.id)).toBe(0);
    expect(await movimientosDe(p.id)).toHaveLength(0);
  });

  it("moverStock() dentro de una transacción ajena se revierte con ella", async () => {
    const p = await nuevoProducto(4);
    const { enTransaccion } = await import("@/db/transaccion");
    await expect(
      enTransaccion(async (tx) => {
        await moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 4, motivo: "Rotura" }, tx);
        throw new Error("falla posterior de la operación mayor");
      }),
    ).rejects.toThrow(/falla posterior/);
    expect(await existencia(p.id)).toBe(4);
    expect(await movimientosDe(p.id)).toHaveLength(1);
  });
});

describe("concurrencia (regla 1; sección 10.8, punto 4)", () => {
  it("dos egresos simultáneos de la última unidad: solo uno se registra", async () => {
    const p = await nuevoProducto(1);
    const resultados = await Promise.allSettled([
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 1, motivo: "Rotura" }),
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 1, motivo: "Rotura" }),
    ]);
    const exitos = resultados.filter((r) => r.status === "fulfilled");
    const fallas = resultados.filter((r) => r.status === "rejected");
    expect(exitos).toHaveLength(1);
    expect(fallas).toHaveLength(1);
    expect((fallas[0] as PromiseRejectedResult).reason).toMatchObject({ code: "STOCK_INSUFICIENTE" });
    expect(await existencia(p.id)).toBe(0);
    expect((await movimientosDe(p.id)).filter((m) => m.tipo === "egreso")).toHaveLength(1);
  });

  it("muchas operaciones simultáneas mantienen la existencia exacta", async () => {
    const p = await nuevoProducto(10);
    const pedidos = Array.from({ length: 15 }, () =>
      moverStock(admin, { productoId: p.id, tipo: "egreso", cantidad: 1, motivo: "Uso interno" }),
    );
    const resultados = await Promise.allSettled(pedidos);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(await existencia(p.id)).toBe(0);
  });

  it("si OTRA conexión tiene tomada la escritura, espera y reintenta el BEGIN", async () => {
    const p = await nuevoProducto(2);
    const ajena = await cliente.transaction("write"); // bloqueo de escritura de otra conexión
    const pendiente = moverStock(admin, { productoId: p.id, tipo: "ingreso", cantidad: 1, motivo: "Reposición" });
    await new Promise((r) => setTimeout(r, 120));
    await ajena.commit();
    await expect(pendiente).resolves.toMatchObject({ existenciaResultante: 3 });
  });
});

describe("edición y baja no alteran la existencia ni el historial", () => {
  it("editar y desactivar conserva existencia y movimientos", async () => {
    const p = await nuevoProducto(9);
    await actualizarProducto(admin, { id: String(p.id) }, { precio: 5000, descripcion: "Otro nombre" });
    const baja = await actualizarProducto(admin, { id: String(p.id) }, { activo: false });
    expect(baja).toMatchObject({ activo: false, existencia: 9, precio: 5000 });
    expect(await movimientosDe(p.id)).toHaveLength(1);
  });
});

describe("única vía de escritura de la existencia (sección 10.2)", () => {
  it("ningún archivo fuera de src/servicios/stock.ts escribe productos.existencia", () => {
    const raiz = join(process.cwd(), "src");
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) archivos.push(ruta);
      }
    };
    recorrer(raiz);

    // .set({ ... existencia ... }) o SQL "set existencia".
    const escribeExistencia = /\.set\(\s*\{[^}]*\bexistencia\b|set\s+["`]?existencia/i;
    const infractores = archivos
      .filter((ruta) => escribeExistencia.test(readFileSync(ruta, "utf8")))
      .map((ruta) => relative(raiz, ruta).replaceAll("\\", "/"));
    expect(infractores).toEqual(["servicios/stock.ts"]);
  });
});
