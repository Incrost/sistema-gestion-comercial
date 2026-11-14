import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  esquemaAltaUsuario,
  esquemaConsultaUsuarios,
  esquemaEdicionUsuario,
  esquemaParametrosUsuario,
} from "./validacion-usuarios";

// Contraseña ficticia, solo para estas pruebas.
const CLAVE = "clave-de-prueba-123";

/** Campos con error (los no permitidos se informan por su nombre), ordenados. */
function campos(resultado: z.ZodSafeParseResult<unknown>): string[] {
  expect(resultado.success).toBe(false);
  return resultado
    .error!.issues.flatMap((i) =>
      i.code === "unrecognized_keys" ? i.keys : [i.path.map(String).join(".")],
    )
    .sort();
}

describe("esquemaConsultaUsuarios", () => {
  it("aplica los valores por defecto", () => {
    expect(esquemaConsultaUsuarios.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("convierte texto de la URL: page, pageSize, activo y q recortado", () => {
    expect(
      esquemaConsultaUsuarios.parse({ page: "2", pageSize: "5", activo: "false", q: "  ana " }),
    ).toEqual({ page: 2, pageSize: 5, activo: false, q: "ana" });
    expect(esquemaConsultaUsuarios.parse({ activo: "true" }).activo).toBe(true);
  });

  it("trata los filtros vacíos como ausentes", () => {
    expect(esquemaConsultaUsuarios.parse({ q: "", activo: "", page: "" })).toEqual({
      page: 1,
      pageSize: 20,
    });
  });

  it("rechaza valores inválidos y parámetros no previstos", () => {
    expect(
      campos(
        esquemaConsultaUsuarios.safeParse({ activo: "si", pageSize: "101", page: "0", orden: "x" }),
      ),
    ).toEqual(["activo", "orden", "page", "pageSize"]);
  });
});

describe("esquemaAltaUsuario", () => {
  const valido = {
    nombre: "  Ana Pérez ",
    email: " Ana@Correo.TEST ",
    rol: "vendedor",
    password: CLAVE,
  };

  it("normaliza nombre y email", () => {
    expect(esquemaAltaUsuario.parse(valido)).toEqual({
      nombre: "Ana Pérez",
      email: "ana@correo.test",
      rol: "vendedor",
      password: CLAVE,
    });
  });

  it("exige todos los campos", () => {
    expect(campos(esquemaAltaUsuario.safeParse({}))).toEqual([
      "email",
      "nombre",
      "password",
      "rol",
    ]);
  });

  it.each([
    [{ nombre: "   " }, "nombre"],
    [{ nombre: "x".repeat(101) }, "nombre"],
    [{ email: "no-es-email" }, "email"],
    [{ rol: "gerente" }, "rol"],
    [{ password: "corta" }, "password"],
    [{ password: "x".repeat(73) }, "password"],
  ])("rechaza %j", (cambio, campo) => {
    expect(campos(esquemaAltaUsuario.safeParse({ ...valido, ...cambio }))).toEqual([campo]);
  });

  it("acepta contraseñas de 8 y de 72 caracteres", () => {
    for (const password of ["x".repeat(8), "x".repeat(72)]) {
      expect(esquemaAltaUsuario.safeParse({ ...valido, password }).success).toBe(true);
    }
  });

  it("rechaza campos extra como activo o passwordHash", () => {
    expect(
      campos(esquemaAltaUsuario.safeParse({ ...valido, activo: false, passwordHash: "x" })),
    ).toEqual(["activo", "passwordHash"]);
  });
});

describe("esquemaEdicionUsuario", () => {
  it("acepta cualquier subconjunto de campos y normaliza", () => {
    expect(esquemaEdicionUsuario.parse({ email: " X@Y.TEST " })).toEqual({ email: "x@y.test" });
    expect(esquemaEdicionUsuario.parse({ activo: false })).toEqual({ activo: false });
    expect(esquemaEdicionUsuario.parse({ nombre: " B ", rol: "admin" })).toEqual({
      nombre: "B",
      rol: "admin",
    });
  });

  it("exige al menos un campo", () => {
    const resultado = esquemaEdicionUsuario.safeParse({});
    expect(resultado.success).toBe(false);
    expect(resultado.error!.issues[0].message).toBe(
      "Debe indicar al menos un campo para modificar.",
    );
  });

  it("rechaza passwordHash, password y otros campos extra", () => {
    expect(
      campos(esquemaEdicionUsuario.safeParse({ nombre: "B", passwordHash: "x", password: CLAVE })),
    ).toEqual(["password", "passwordHash"]);
  });

  it("activo debe ser booleano, no texto", () => {
    expect(campos(esquemaEdicionUsuario.safeParse({ activo: "false" }))).toEqual(["activo"]);
  });
});

describe("esquemaParametrosUsuario", () => {
  it("convierte el id de la URL a número", () => {
    expect(esquemaParametrosUsuario.parse({ id: "12" })).toEqual({ id: 12 });
  });

  it.each(["0", "-1", "1.5", "abc", ""])("rechaza id %j", (id) => {
    expect(campos(esquemaParametrosUsuario.safeParse({ id }))).toEqual(["id"]);
  });
});
