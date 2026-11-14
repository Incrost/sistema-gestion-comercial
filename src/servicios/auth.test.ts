/**
 * Pruebas de integración del servicio de autenticación, contra una base
 * SQLite temporal con las migraciones reales (no toca local.db ni Turso).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import { CODIGOS_ERROR } from "@/lib/codigos-error";
import { verificarContrasena } from "@/lib/contrasenas";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import {
  aUsuarioPublico,
  cambiarContrasena,
  obtenerUsuarioActivo,
  validarCredenciales,
  type UsuarioAutenticado,
} from "./auth";

// Credenciales ficticias, solo para estas pruebas.
const CLAVE = "clave-de-prueba-123";

let activo: UsuarioAutenticado;
let inactivoId: number;

beforeAll(async () => {
  const fila = await crearUsuarioDePrueba(db, {
    email: "activo@prueba.test",
    password: CLAVE,
    nombre: "Ana Activa",
    rol: "admin",
  });
  activo = aUsuarioPublico(fila);
  const inactivo = await crearUsuarioDePrueba(db, {
    email: "inactivo@prueba.test",
    password: CLAVE,
    activo: false,
  });
  inactivoId = inactivo.id;
});

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

async function capturar(promesa: Promise<unknown>): Promise<ApiError> {
  const error = await promesa.then(
    () => {
      throw new Error("Se esperaba un error");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("aUsuarioPublico", () => {
  it("nunca incluye passwordHash ni otros campos internos", async () => {
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, activo.id));
    const publico = aUsuarioPublico(fila);
    expect(Object.keys(publico).sort()).toEqual(["email", "id", "nombre", "rol"]);
    expect(JSON.stringify(publico)).not.toContain(fila.passwordHash);
  });
});

describe("validarCredenciales (RF-U1)", () => {
  it("con credenciales correctas devuelve el usuario público", async () => {
    const usuario = await validarCredenciales({ email: "activo@prueba.test", password: CLAVE });
    expect(usuario).toEqual({
      id: activo.id,
      nombre: "Ana Activa",
      email: "activo@prueba.test",
      rol: "admin",
    });
    expect(usuario).not.toHaveProperty("passwordHash");
  });

  it("normaliza el email (espacios y mayúsculas)", async () => {
    const usuario = await validarCredenciales({ email: "  ACTIVO@Prueba.test ", password: CLAVE });
    expect(usuario.id).toBe(activo.id);
  });

  it.each([
    ["email inexistente", { email: "nadie@prueba.test", password: CLAVE }],
    ["contraseña incorrecta", { email: "activo@prueba.test", password: "otra-clave-123" }],
    ["usuario inactivo", { email: "inactivo@prueba.test", password: CLAVE }],
  ])("%s → 401 CREDENCIALES_INVALIDAS con el mismo mensaje", async (_caso, datos) => {
    const error = await capturar(validarCredenciales(datos));
    expect(error.status).toBe(401);
    expect(error.code).toBe("CREDENCIALES_INVALIDAS");
    expect(error.message).toBe(CODIGOS_ERROR.CREDENCIALES_INVALIDAS.mensaje);
    expect(error.details).toBeUndefined();
  });

  it("datos inválidos lanzan ZodError (→ 422 VALIDACION en el adaptador)", async () => {
    await expect(validarCredenciales({ email: "no-es-email", password: "" })).rejects.toThrow();
    await expect(validarCredenciales({ email: "activo@prueba.test" })).rejects.toThrow();
    await expect(validarCredenciales(null)).rejects.toThrow();
  });
});

describe("obtenerUsuarioActivo (RF-U2, sección 10.5)", () => {
  it("devuelve el usuario activo leído de la base", async () => {
    expect(await obtenerUsuarioActivo(activo.id)).toEqual(activo);
  });

  it("devuelve null si el usuario está inactivo o no existe", async () => {
    expect(await obtenerUsuarioActivo(inactivoId)).toBeNull();
    expect(await obtenerUsuarioActivo(999_999)).toBeNull();
  });
});

describe("cambiarContrasena (RF-U5)", () => {
  it("contraseña actual incorrecta → 422 CONTRASENA_ACTUAL_INCORRECTA", async () => {
    const error = await capturar(
      cambiarContrasena(activo, { actual: "equivocada-123", nueva: "nueva-clave-456" }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("CONTRASENA_ACTUAL_INCORRECTA");
  });

  it("rechaza una nueva contraseña de menos de 8 caracteres o igual a la actual", async () => {
    await expect(cambiarContrasena(activo, { actual: CLAVE, nueva: "corta" })).rejects.toThrow();
    await expect(cambiarContrasena(activo, { actual: CLAVE, nueva: CLAVE })).rejects.toThrow();
  });

  it("un usuario desactivado ya no puede cambiarla → 401 NO_AUTENTICADO", async () => {
    const inactivo = { ...activo, id: inactivoId };
    const error = await capturar(
      cambiarContrasena(inactivo, { actual: CLAVE, nueva: "nueva-clave-456" }),
    );
    expect(error.code).toBe("NO_AUTENTICADO");
  });

  it("con la actual correcta guarda solo el hash de la nueva", async () => {
    const usuario = aUsuarioPublico(
      await crearUsuarioDePrueba(db, { email: "cambia@prueba.test", password: CLAVE }),
    );
    await cambiarContrasena(usuario, { actual: CLAVE, nueva: "nueva-clave-456" });

    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(fila.passwordHash).not.toContain("nueva-clave-456");
    expect(await verificarContrasena("nueva-clave-456", fila.passwordHash)).toBe(true);

    await expect(
      validarCredenciales({ email: "cambia@prueba.test", password: CLAVE }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(
      await validarCredenciales({ email: "cambia@prueba.test", password: "nueva-clave-456" }),
    ).toEqual(usuario);
  });
});
