/**
 * Pruebas del seed parcial de usuarios (RF-U3): idempotencia y solo hashes.
 * Usa una base SQLite temporal (no toca local.db ni Turso).
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { verificarContrasena } from "@/lib/contrasenas";
import type { ModuloDbPrueba } from "@/test/base-de-prueba";

import { sembrarUsuarios, USUARIOS_ACADEMICOS } from "./usuarios";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

describe("sembrarUsuarios", () => {
  it("define un administrador y un vendedor con emails de prueba (.test)", () => {
    expect(USUARIOS_ACADEMICOS.map((u) => u.rol).sort()).toEqual(["admin", "vendedor"]);
    for (const u of USUARIOS_ACADEMICOS) expect(u.email).toMatch(/@[a-z.]+\.test$/);
  });

  it("crea los usuarios activos y guarda solo el hash", async () => {
    const resultado = await sembrarUsuarios(db);
    expect(resultado).toEqual(
      USUARIOS_ACADEMICOS.map((u) => ({ email: u.email, estado: "creado" })),
    );
    expect(JSON.stringify(resultado)).not.toMatch(/password|hash/i);

    const filas = await db.select().from(usuarios);
    expect(filas).toHaveLength(2);
    for (const u of USUARIOS_ACADEMICOS) {
      const fila = filas.find((f) => f.email === u.email)!;
      expect(fila).toMatchObject({ nombre: u.nombre, rol: u.rol, activo: true });
      expect(fila.passwordHash).not.toBe(u.password);
      expect(await verificarContrasena(u.password, fila.passwordHash)).toBe(true);
    }
  });

  it("es idempotente: no duplica ni modifica usuarios existentes", async () => {
    const antes = await db.select().from(usuarios);
    const resultado = await sembrarUsuarios(db);
    expect(resultado.every((r) => r.estado === "existente")).toBe(true);
    expect(await db.select().from(usuarios)).toEqual(antes);
  });
});
