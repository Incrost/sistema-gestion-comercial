/**
 * Clase única de error de la aplicación (consigna, secciones 10.4 y 11.1).
 *
 * Los servicios lanzan siempre `ApiError(status, code, message, details)`.
 * Los adaptadores (Route Handlers y Server Actions) convierten cualquier error
 * con `normalizarError()` y responden con `aRespuesta()`, que produce el
 * formato público uniforme:
 *
 *   { "error": { "code": "VALIDACION", "message": "...", "details": [...] } }
 *
 * Un error inesperado (falla de la base, error de programación, etc.) se
 * registra en el log y se transforma en ERROR_INTERNO: el cliente nunca recibe
 * el stack, el SQL, rutas de archivos ni ningún otro detalle interno.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import { CODIGOS_ERROR, type CodigoError } from "./codigos-error";

/** Detalle de un campo inválido: `{ campo: "codigo", mensaje: "Es obligatorio." }`. */
export type DetalleCampo = { campo: string; mensaje: string };

/** Forma pública de toda respuesta de error (sección 11.1). */
export type RespuestaError = {
  error: { code: CodigoError; message: string; details?: unknown };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: CodigoError;
  readonly details?: unknown;

  constructor(status: number, code: CodigoError, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * Crea el error tomando el estado HTTP (y, si no se indica, el mensaje) del
   * catálogo de la sección 11.8. Ej.: `ApiError.desdeCodigo("NO_ENCONTRADO")`.
   */
  static desdeCodigo(code: CodigoError, message?: string, details?: unknown): ApiError {
    const { status, mensaje } = CODIGOS_ERROR[code];
    return new ApiError(status, code, message ?? mensaje, details);
  }

  /** Cuerpo JSON público de la respuesta. */
  aRespuesta(): RespuestaError {
    // Protección: un ERROR_INTERNO responde siempre el mensaje genérico y sin
    // details, aunque alguien lo haya creado con información interna.
    if (this.code === "ERROR_INTERNO") {
      return { error: { code: this.code, message: CODIGOS_ERROR.ERROR_INTERNO.mensaje } };
    }
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

/**
 * Convierte un error de Zod en `422 VALIDACION` con el detalle por campo.
 * La ruta anidada se une con puntos: `items.0.cantidad`, `tarjeta.ultimos4`.
 * Un campo no permitido (esquemas estrictos) se informa con su propio nombre.
 */
export function errorDeValidacion(error: z.ZodError): ApiError {
  const details: DetalleCampo[] = [];

  for (const issue of error.issues) {
    const ruta = issue.path.map(String).join(".");
    if (issue.code === "unrecognized_keys") {
      for (const clave of issue.keys) {
        details.push({ campo: ruta ? `${ruta}.${clave}` : clave, mensaje: "Campo no permitido." });
      }
    } else {
      details.push({ campo: ruta, mensaje: issue.message });
    }
  }

  return ApiError.desdeCodigo("VALIDACION", undefined, details);
}

/**
 * Lleva cualquier valor lanzado a un `ApiError` seguro para responder:
 * - `ApiError` → se devuelve tal cual;
 * - `ZodError` → `422 VALIDACION` con detalle por campo;
 * - cualquier otra cosa → se registra en el log y se devuelve `500 ERROR_INTERNO`.
 */
export function normalizarError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) return errorDeValidacion(error);

  console.error("[ERROR_INTERNO]", error);
  return ApiError.desdeCodigo("ERROR_INTERNO");
}
