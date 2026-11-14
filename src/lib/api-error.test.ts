import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError, errorDeValidacion, normalizarError } from "./api-error";
import { CODIGOS_ERROR } from "./codigos-error";
import { textoObligatorio } from "./validacion";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApiError", () => {
  it("produce el formato público de la sección 11.1", () => {
    const error = new ApiError(404, "NO_ENCONTRADO", "El producto no existe.");
    expect(error.status).toBe(404);
    expect(error.aRespuesta()).toEqual({
      error: { code: "NO_ENCONTRADO", message: "El producto no existe." },
    });
  });

  it("toma estado y mensaje del catálogo e incluye details si existen", () => {
    const details = [{ productoId: 4, solicitado: 3, disponible: 1 }];
    const error = ApiError.desdeCodigo("STOCK_INSUFICIENTE", undefined, details);
    expect(error.status).toBe(409);
    expect(error.aRespuesta()).toEqual({
      error: {
        code: "STOCK_INSUFICIENTE",
        message: CODIGOS_ERROR.STOCK_INSUFICIENTE.mensaje,
        details,
      },
    });
  });

  it("el catálogo contiene los 22 códigos de la sección 11.8", () => {
    expect(Object.keys(CODIGOS_ERROR)).toHaveLength(22);
  });
});

describe("conversión de errores de Zod", () => {
  const esquema = z.strictObject({
    codigo: textoObligatorio(),
    items: z.array(z.object({ cantidad: z.number().int().positive("Debe ser mayor que 0.") })),
  });

  it("convierte un ZodError en 422 VALIDACION con detalle por campo", () => {
    const resultado = esquema.safeParse({ items: [{ cantidad: 0 }] });
    if (resultado.success) throw new Error("Se esperaba un error de validación.");

    const error = errorDeValidacion(resultado.error);
    expect(error.status).toBe(422);
    expect(error.aRespuesta()).toEqual({
      error: {
        code: "VALIDACION",
        message: "Hay campos con errores.",
        details: [
          { campo: "codigo", mensaje: "Es obligatorio." },
          { campo: "items.0.cantidad", mensaje: "Debe ser mayor que 0." },
        ],
      },
    });
  });

  it("informa cada campo no permitido por su nombre", () => {
    const resultado = esquema.safeParse({ codigo: "HE-001", items: [], existencia: 5 });
    if (resultado.success) throw new Error("Se esperaba un error de validación.");

    expect(errorDeValidacion(resultado.error).details).toEqual([
      { campo: "existencia", mensaje: "Campo no permitido." },
    ]);
  });
});

describe("normalizarError", () => {
  it("devuelve un ApiError sin cambios", () => {
    const original = ApiError.desdeCodigo("SIN_PERMISO");
    expect(normalizarError(original)).toBe(original);
  });

  it("convierte un ZodError lanzado en VALIDACION", () => {
    const resultado = textoObligatorio().safeParse("");
    if (resultado.success) throw new Error("Se esperaba un error de validación.");
    expect(normalizarError(resultado.error).code).toBe("VALIDACION");
  });

  it("oculta los detalles de un error inesperado y lo registra en el log", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const inesperado = new Error("SQLITE_CONSTRAINT: SELECT * FROM usuarios en C:\\Repos\\src\\db");

    const error = normalizarError(inesperado);
    const cuerpo = JSON.stringify(error.aRespuesta());

    expect(error.status).toBe(500);
    expect(error.aRespuesta()).toEqual({
      error: { code: "ERROR_INTERNO", message: CODIGOS_ERROR.ERROR_INTERNO.mensaje },
    });
    expect(cuerpo).not.toContain("SQLITE");
    expect(cuerpo).not.toContain("usuarios");
    expect(cuerpo).not.toContain("Repos");
    expect(log).toHaveBeenCalledWith("[ERROR_INTERNO]", inesperado);
  });

  it("tampoco expone detalles si se crea ERROR_INTERNO manualmente con información interna", () => {
    const error = new ApiError(500, "ERROR_INTERNO", "stack: at db.ts:10", { sql: "SELECT 1" });
    expect(error.aRespuesta()).toEqual({
      error: { code: "ERROR_INTERNO", message: CODIGOS_ERROR.ERROR_INTERNO.mensaje },
    });
  });
});
