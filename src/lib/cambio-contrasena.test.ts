/**
 * Pruebas de la lógica del formulario «Cambiar contraseña» de /perfil
 * (RF-U5): validación, cuerpo enviado, respuestas de la API y envío único.
 */
import { describe, expect, it, vi } from "vitest";

import {
  CAMPOS_VACIOS,
  camposTrasEnvio,
  crearEnvioUnico,
  enviarCambioContrasena,
  interpretarErrorCambio,
  MENSAJE_ERROR_SEGURO,
  RUTA_CAMBIO_CONTRASENA,
  validarCambioContrasena,
  type CamposContrasena,
} from "./cambio-contrasena";
import { ErrorDeApi } from "./cliente-api";

// Valores ficticios, solo para estas pruebas.
const validos: CamposContrasena = { actual: "clave-actual-1", nueva: "clave-nueva-22", confirmacion: "clave-nueva-22" };

function errores(campos: CamposContrasena) {
  const r = validarCambioContrasena(campos);
  if (r.ok) throw new Error("se esperaba un error de validación");
  return r.errores;
}

describe("validarCambioContrasena", () => {
  it("todos los campos son obligatorios", () => {
    expect(errores(CAMPOS_VACIOS)).toEqual({ actual: "Es obligatorio.", nueva: "Es obligatorio.", confirmacion: "Es obligatorio." });
  });

  it("la nueva debe tener al menos 8 caracteres", () => {
    expect(errores({ ...validos, nueva: "corta12", confirmacion: "corta12" }).nueva).toBe("Debe tener al menos 8 caracteres.");
  });

  it("acepta exactamente 8 y 72 caracteres", () => {
    for (const nueva of ["a".repeat(8), "a".repeat(72)]) {
      expect(validarCambioContrasena({ ...validos, nueva, confirmacion: nueva }).ok).toBe(true);
    }
  });

  it("la nueva no puede superar los 72 caracteres", () => {
    const larga = "a".repeat(73);
    expect(errores({ ...validos, nueva: larga, confirmacion: larga }).nueva).toBe("No puede superar los 72 caracteres.");
  });

  it("la confirmación debe coincidir", () => {
    expect(errores({ ...validos, confirmacion: "otra-clave-99" })).toEqual({ confirmacion: "No coincide con la contraseña nueva." });
  });

  it("la nueva debe ser distinta de la actual", () => {
    expect(errores({ actual: "misma-clave-1", nueva: "misma-clave-1", confirmacion: "misma-clave-1" })).toEqual({
      nueva: "Debe ser distinta de la contraseña actual.",
    });
  });

  it("no recorta espacios: la contraseña se envía tal como se escribió", () => {
    const r = validarCambioContrasena({ ...validos, nueva: " con espacios ", confirmacion: " con espacios " });
    expect(r.ok && r.cuerpo.nueva).toBe(" con espacios ");
  });

  it("el cuerpo contiene únicamente actual y nueva (nunca la confirmación)", () => {
    const r = validarCambioContrasena(validos);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.cuerpo).sort()).toEqual(["actual", "nueva"]);
      expect(r.cuerpo).toEqual({ actual: validos.actual, nueva: validos.nueva });
    }
  });
});

describe("enviarCambioContrasena", () => {
  it("hace un único PUT a /api/auth/password con { actual, nueva } en JSON", async () => {
    const llamar = vi.fn().mockResolvedValue(null);
    expect(await enviarCambioContrasena(validos, llamar)).toEqual({ tipo: "exito" });
    expect(llamar).toHaveBeenCalledTimes(1);
    const [url, init] = llamar.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RUTA_CAMBIO_CONTRASENA);
    expect(url).not.toContain("?");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ actual: validos.actual, nueva: validos.nueva });
  });

  it("con errores de validación no llama al servidor", async () => {
    const llamar = vi.fn();
    const r = await enviarCambioContrasena({ ...validos, confirmacion: "x" }, llamar);
    expect(r.tipo).toBe("campos");
    expect(llamar).not.toHaveBeenCalled();
  });

  it("traduce el error de la API", async () => {
    const llamar = vi.fn().mockRejectedValue(
      new ErrorDeApi("La contraseña actual es incorrecta.", 422, "CONTRASENA_ACTUAL_INCORRECTA", { actual: "La contraseña actual es incorrecta." }),
    );
    expect(await enviarCambioContrasena(validos, llamar)).toEqual({ tipo: "campos", errores: { actual: "La contraseña actual es incorrecta." } });
  });
});

describe("interpretarErrorCambio", () => {
  it("CONTRASENA_ACTUAL_INCORRECTA: error junto al campo de la contraseña actual", () => {
    const r = interpretarErrorCambio(new ErrorDeApi("La contraseña actual es incorrecta.", 422, "CONTRASENA_ACTUAL_INCORRECTA"));
    expect(r).toEqual({ tipo: "campos", errores: { actual: "La contraseña actual es incorrecta." } });
  });

  it("VALIDACION: errores junto a cada campo", () => {
    const r = interpretarErrorCambio(new ErrorDeApi("Datos inválidos.", 422, "VALIDACION", { nueva: "Debe tener al menos 8 caracteres." }));
    expect(r).toEqual({ tipo: "campos", errores: { nueva: "Debe tener al menos 8 caracteres." } });
  });

  it("NO_AUTENTICADO: vuelve al flujo de sesión", () => {
    expect(interpretarErrorCambio(new ErrorDeApi("Debe iniciar sesión.", 401, "NO_AUTENTICADO"))).toEqual({ tipo: "sesion" });
  });

  it("ERROR_INTERNO y errores desconocidos: mensaje seguro, sin detalles técnicos", () => {
    const interno = interpretarErrorCambio(new ErrorDeApi("SQLITE_BUSY: database is locked at /srv/app", 500, "ERROR_INTERNO"));
    expect(interno).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_SEGURO });
    expect(interpretarErrorCambio(new TypeError("x is undefined"))).toEqual({ tipo: "error", mensaje: MENSAJE_ERROR_SEGURO });
  });
});

describe("camposTrasEnvio", () => {
  it("el éxito limpia todos los campos", () => {
    expect(camposTrasEnvio(validos, { tipo: "exito" })).toEqual(CAMPOS_VACIOS);
  });

  it("si la actual es incorrecta conserva la nueva y su confirmación", () => {
    const r = camposTrasEnvio(validos, { tipo: "campos", errores: { actual: "La contraseña actual es incorrecta." } });
    expect(r.nueva).toBe(validos.nueva);
    expect(r.confirmacion).toBe(validos.confirmacion);
  });
});

describe("crearEnvioUnico", () => {
  it("ignora un segundo envío mientras el primero está en curso", async () => {
    const envio = crearEnvioUnico();
    let terminar!: () => void;
    const operacion = vi.fn(() => new Promise<string>((r) => (terminar = () => r("ok"))));
    const primero = envio.ejecutar(operacion);
    const segundo = envio.ejecutar(operacion);
    expect(envio.enCurso).toBe(true);
    expect(await segundo).toBeUndefined();
    terminar();
    expect(await primero).toBe("ok");
    expect(operacion).toHaveBeenCalledTimes(1);
    expect(envio.enCurso).toBe(false);
  });

  it("libera el candado aunque la operación falle", async () => {
    const envio = crearEnvioUnico();
    await expect(envio.ejecutar(() => Promise.reject(new Error("falla")))).rejects.toThrow("falla");
    expect(await envio.ejecutar(async () => 1)).toBe(1);
  });
});
