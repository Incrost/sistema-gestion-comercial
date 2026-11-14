/**
 * Pruebas de esViolacionDeUnicidad(): con errores REALES de SQLite (base
 * temporal) y con la forma en que los informa Turso (Hrana), que no puede
 * usarse en las pruebas.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { categorias, clientes, productos, usuarios } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import type { ModuloDbPrueba } from "@/test/base-de-prueba";

import {
  COLUMNAS_DOCUMENTO_CLIENTE,
  esBloqueoDeBase,
  esViolacionDeUnicidad,
  traducirUnicidad,
} from "./errores-base";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

async function capturar(promesa: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un error");
}

const fila = {
  nombre: "Ana",
  email: "ana@prueba.test",
  passwordHash: "x",
  rol: "vendedor" as const,
};

describe("esViolacionDeUnicidad con SQLite local", () => {
  it("reconoce el email duplicado a través del error envuelto por Drizzle", async () => {
    await db.insert(usuarios).values(fila);
    const error = await capturar(db.insert(usuarios).values(fila));
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(true);
    expect(esViolacionDeUnicidad(error, "usuarios.nombre")).toBe(false);
    expect(esViolacionDeUnicidad(error, "usuarios.e")).toBe(false);
  });

  it("no confunde una restricción CHECK con un duplicado", async () => {
    const error = await capturar(
      db.insert(usuarios).values({ ...fila, email: "otro@prueba.test", nombre: "   " }),
    );
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(false);
  });

  it("no confunde otros errores de la base", async () => {
    const { cliente } = moduloDb as unknown as ModuloDbPrueba;
    const error = await capturar(cliente.execute("select * from tabla_inexistente"));
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(false);
  });
});

describe("esViolacionDeUnicidad con la forma de Turso/libSQL remoto", () => {
  function errorLibsql(code: string, message: string) {
    return Object.assign(new Error(message), { name: "LibsqlError", code, rawCode: 2067 });
  }

  it("reconoce SQLITE_CONSTRAINT con el mensaje del motor, directo o como causa", () => {
    const remoto = errorLibsql(
      "SQLITE_CONSTRAINT",
      "SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: usuarios.email",
    );
    expect(esViolacionDeUnicidad(remoto, "usuarios.email")).toBe(true);
    const envuelto = new Error("Failed query: insert into ...", { cause: remoto });
    expect(esViolacionDeUnicidad(envuelto, "usuarios.email")).toBe(true);
  });

  it("reconoce el código extendido de libSQL", () => {
    const error = Object.assign(new Error("UNIQUE constraint failed: usuarios.email"), {
      code: "SQLITE_CONSTRAINT",
      extendedCode: "SQLITE_CONSTRAINT_UNIQUE",
    });
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(true);
  });

  it("exige el código de restricción: el texto solo no alcanza", () => {
    const error = new Error("UNIQUE constraint failed: usuarios.email");
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(false);
  });

  it("no toma un índice compuesto que empieza por la misma columna", () => {
    const error = errorLibsql(
      "SQLITE_CONSTRAINT",
      "UNIQUE constraint failed: usuarios.email, usuarios.rol",
    );
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(false);
  });

  it.each([null, undefined, "texto", 42, {}, errorLibsql("SQLITE_BUSY", "database is locked")])(
    "devuelve false para %j",
    (valor) => {
      expect(esViolacionDeUnicidad(valor, "usuarios.email")).toBe(false);
    },
  );
});

describe("duplicados de productos y categorías (SQLite local)", () => {
  it("reconoce productos.codigo y categorias.nombre sin confundirlos", async () => {
    const [cat] = await db.insert(categorias).values({ nombre: "Herramientas" }).returning();
    const errorCategoria = await capturar(db.insert(categorias).values({ nombre: "Herramientas" }));
    expect(esViolacionDeUnicidad(errorCategoria, "categorias.nombre")).toBe(true);
    expect(esViolacionDeUnicidad(errorCategoria, "productos.codigo")).toBe(false);

    const producto = { codigo: "HE-001", descripcion: "Martillo", categoriaId: cat.id, precio: 100 };
    await db.insert(productos).values(producto);
    const errorProducto = await capturar(db.insert(productos).values(producto));
    expect(esViolacionDeUnicidad(errorProducto, "productos.codigo")).toBe(true);
    expect(esViolacionDeUnicidad(errorProducto, "categorias.nombre")).toBe(false);
  });

  it("no toma por duplicado una clave foránea inexistente ni un CHECK", async () => {
    const errorFk = await capturar(
      db.insert(productos).values({ codigo: "FK-1", descripcion: "X", categoriaId: 9999, precio: 100 }),
    );
    expect(esViolacionDeUnicidad(errorFk, "productos.codigo")).toBe(false);
    const [cat] = await db.insert(categorias).values({ nombre: "Otra" }).returning();
    const errorCheck = await capturar(
      db.insert(productos).values({ codigo: "CK-1", descripcion: "X", categoriaId: cat.id, precio: -1 }),
    );
    expect(esViolacionDeUnicidad(errorCheck, "productos.codigo")).toBe(false);
  });

  it("también funciona dentro de una transacción", async () => {
    const error = await capturar(
      db.transaction(async (tx) => {
        await tx.insert(categorias).values({ nombre: "Herramientas" });
      }),
    );
    expect(esViolacionDeUnicidad(error, "categorias.nombre")).toBe(true);
  });

  it("reconoce la forma remota de Turso para ambos índices", () => {
    const remoto = (columna: string) =>
      new Error("Failed query", {
        cause: Object.assign(
          new Error(`SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: ${columna}`),
          { code: "SQLITE_CONSTRAINT" },
        ),
      });
    expect(esViolacionDeUnicidad(remoto("productos.codigo"), "productos.codigo")).toBe(true);
    expect(esViolacionDeUnicidad(remoto("categorias.nombre"), "categorias.nombre")).toBe(true);
    expect(esViolacionDeUnicidad(remoto("productos.codigo"), "categorias.nombre")).toBe(false);
  });
});

describe("documento de cliente duplicado (índice compuesto)", () => {
  const cliente = { tipoDoc: "DNI" as const, nroDoc: "28.456.123", nroDocNormalizado: "28456123", nombre: "Ana" };

  it("SQLite local: reconoce el índice completo, no una sola de sus columnas", async () => {
    await db.insert(clientes).values(cliente);
    const error = await capturar(db.insert(clientes).values({ ...cliente, nroDoc: "28456123" }));
    expect(esViolacionDeUnicidad(error, COLUMNAS_DOCUMENTO_CLIENTE)).toBe(true);
    expect(esViolacionDeUnicidad(error, "clientes.nro_doc_normalizado")).toBe(false);
    expect(esViolacionDeUnicidad(error, "clientes.tipo_doc")).toBe(false);
    expect(esViolacionDeUnicidad(error, "usuarios.email")).toBe(false);
    // Mismo número con otro tipo: no hay choque.
    await db.insert(clientes).values({ ...cliente, tipoDoc: "CUIT", nroDocNormalizado: "20284561234" });
  });

  it("SQLite local: un CHECK del documento no se toma por duplicado", async () => {
    const error = await capturar(
      db.insert(clientes).values({ ...cliente, nroDocNormalizado: "123", nroDoc: "123" }),
    );
    expect(esViolacionDeUnicidad(error, COLUMNAS_DOCUMENTO_CLIENTE)).toBe(false);
  });

  it("Turso/libSQL remoto: reconoce el mensaje del motor directo o como causa", () => {
    const remoto = Object.assign(
      new Error(`SQLITE_CONSTRAINT: SQLite error: UNIQUE constraint failed: ${COLUMNAS_DOCUMENTO_CLIENTE}`),
      { code: "SQLITE_CONSTRAINT" },
    );
    expect(esViolacionDeUnicidad(remoto, COLUMNAS_DOCUMENTO_CLIENTE)).toBe(true);
    expect(esViolacionDeUnicidad(new Error("Failed query", { cause: remoto }), COLUMNAS_DOCUMENTO_CLIENTE)).toBe(true);
    // Sin código de restricción, o con otro índice, no es un documento duplicado.
    expect(esViolacionDeUnicidad(new Error(remoto.message), COLUMNAS_DOCUMENTO_CLIENTE)).toBe(false);
    const otro = Object.assign(new Error("UNIQUE constraint failed: productos.codigo"), { code: "SQLITE_CONSTRAINT" });
    expect(esViolacionDeUnicidad(otro, COLUMNAS_DOCUMENTO_CLIENTE)).toBe(false);
  });

  it("traducirUnicidad() lo convierte en 409 DOCUMENTO_DUPLICADO", async () => {
    const error = await capturar(db.insert(clientes).values(cliente));
    let lanzado: unknown;
    try {
      traducirUnicidad(error, { [COLUMNAS_DOCUMENTO_CLIENTE]: { code: "DOCUMENTO_DUPLICADO", campo: "nroDoc" } });
    } catch (e) {
      lanzado = e;
    }
    expect(lanzado).toMatchObject({ status: 409, code: "DOCUMENTO_DUPLICADO", details: [{ campo: "nroDoc" }] });
  });
});

describe("traducirUnicidad()", () => {
  const mapa = {
    "productos.codigo": { code: "CODIGO_DUPLICADO", campo: "codigo" },
    "categorias.nombre": { code: "NOMBRE_DUPLICADO", campo: "nombre" },
  } as const;

  it("convierte el duplicado en el ApiError 409 que corresponde", () => {
    const error = Object.assign(new Error("UNIQUE constraint failed: categorias.nombre"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    let lanzado: unknown;
    try {
      traducirUnicidad(error, mapa);
    } catch (e) {
      lanzado = e;
    }
    expect(lanzado).toBeInstanceOf(ApiError);
    expect(lanzado).toMatchObject({ status: 409, code: "NOMBRE_DUPLICADO", details: [{ campo: "nombre" }] });
  });

  it("relanza cualquier otro error sin cambios", () => {
    const otro = new Error("no such table: productos");
    expect(() => traducirUnicidad(otro, mapa)).toThrow(otro);
  });
});

describe("esBloqueoDeBase()", () => {
  it("reconoce SQLITE_BUSY y SQLITE_LOCKED, directos o como causa", () => {
    const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    expect(esBloqueoDeBase(busy)).toBe(true);
    expect(esBloqueoDeBase(new Error("x", { cause: busy }))).toBe(true);
    expect(esBloqueoDeBase(Object.assign(new Error("x"), { code: "SQLITE_LOCKED_SHAREDCACHE" }))).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(esBloqueoDeBase(Object.assign(new Error("x"), { code: "SQLITE_CONSTRAINT" }))).toBe(false);
    expect(esBloqueoDeBase(new Error("database is locked"))).toBe(false);
    expect(esBloqueoDeBase(null)).toBe(false);
  });
});
