/**
 * Pruebas de esViolacionDeUnicidad(): con errores REALES de SQLite (base
 * temporal) y con la forma en que los informa Turso (Hrana), que no puede
 * usarse en las pruebas.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import type { ModuloDbPrueba } from "@/test/base-de-prueba";

import { esViolacionDeUnicidad } from "./errores-base";

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
