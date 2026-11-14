import { describe, expect, it, vi } from "vitest";

import {
  generarContrasenaTemporal,
  hashearContrasena,
  LONGITUD_CONTRASENA_TEMPORAL,
  obtenerHashDeRelleno,
  verificarContrasena,
} from "./contrasenas";
import { esquemaContrasena } from "./validacion";

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

describe("generarContrasenaTemporal (RF-U5)", () => {
  it("cumple el esquema de contraseñas y usa solo el alfabeto sin caracteres ambiguos", () => {
    for (let i = 0; i < 200; i++) {
      const temporal = generarContrasenaTemporal();
      expect(temporal).toHaveLength(LONGITUD_CONTRASENA_TEMPORAL);
      expect(temporal).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
      expect(esquemaContrasena.safeParse(temporal).success).toBe(true);
    }
  });

  it("no se repite entre llamadas", () => {
    const generadas = new Set(Array.from({ length: 500 }, () => generarContrasenaTemporal()));
    expect(generadas.size).toBe(500);
  });

  it("usa el generador criptográfico, no Math.random", () => {
    const azar = vi.spyOn(Math, "random");
    const cripto = vi.spyOn(crypto, "getRandomValues");
    generarContrasenaTemporal();
    expect(azar).not.toHaveBeenCalled();
    expect(cripto).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
