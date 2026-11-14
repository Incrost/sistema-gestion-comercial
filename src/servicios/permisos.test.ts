import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-error";

import type { UsuarioAutenticado } from "./auth";
import { exigirRol, tieneRol } from "./permisos";

const admin: UsuarioAutenticado = { id: 1, nombre: "Admin", email: "a@prueba.test", rol: "admin" };
const vendedor: UsuarioAutenticado = {
  id: 2,
  nombre: "Vendedor",
  email: "v@prueba.test",
  rol: "vendedor",
};

function capturar(fn: () => void): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Se esperaba un ApiError");
}

describe("exigirRol", () => {
  it("un vendedor recibe 403 SIN_PERMISO al exigir rol admin", () => {
    const error = capturar(() => exigirRol(vendedor, "admin"));
    expect(error.status).toBe(403);
    expect(error.code).toBe("SIN_PERMISO");
  });

  it("el administrador pasa", () => {
    expect(() => exigirRol(admin, "admin")).not.toThrow();
  });

  it("acepta varios roles", () => {
    expect(() => exigirRol(vendedor, "admin", "vendedor")).not.toThrow();
    expect(tieneRol(vendedor, "admin")).toBe(false);
    expect(tieneRol(admin, "admin")).toBe(true);
  });

  it("sin usuario responde 401 NO_AUTENTICADO", () => {
    const error = capturar(() => exigirRol(null, "admin"));
    expect(error.status).toBe(401);
    expect(error.code).toBe("NO_AUTENTICADO");
  });
});
