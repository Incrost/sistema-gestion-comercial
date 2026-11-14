import { describe, expect, it } from "vitest";

import { hashearContrasena, obtenerHashDeRelleno, verificarContrasena } from "./contrasenas";

// Contraseñas ficticias, solo para estas pruebas.
const CONTRASENA = "clave-de-prueba-123";

describe("hash de contraseñas (bcrypt)", () => {
  it("genera un hash bcrypt distinto de la contraseña y lo verifica", async () => {
    const hash = await hashearContrasena(CONTRASENA);
    expect(hash).not.toContain(CONTRASENA);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    expect(await verificarContrasena(CONTRASENA, hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashearContrasena(CONTRASENA);
    expect(await verificarContrasena("otra-clave-123", hash)).toBe(false);
    expect(await verificarContrasena("", hash)).toBe(false);
  });

  it("usa una sal aleatoria: la misma contraseña produce hashes distintos", async () => {
    const [a, b] = await Promise.all([hashearContrasena(CONTRASENA), hashearContrasena(CONTRASENA)]);
    expect(a).not.toBe(b);
    expect(await verificarContrasena(CONTRASENA, b)).toBe(true);
  });

  it("el hash de relleno es válido y no coincide con contraseñas comunes", async () => {
    const relleno = await obtenerHashDeRelleno();
    expect(relleno).toMatch(/^\$2[aby]\$/);
    expect(await verificarContrasena(CONTRASENA, relleno)).toBe(false);
  });
});
