/**
 * Llamadas a la API REST desde los componentes de cliente.
 *
 * Traduce la respuesta de error estándar (sección 11.1) a un mensaje general
 * y a mensajes por campo, para mostrarlos junto a cada input.
 *
 * Módulo compartido (solo usa fetch): puede importarse desde el cliente.
 */
import type { z } from "zod";

import type { RespuestaError } from "./api-error";

export type ErroresCampo = Record<string, string>;

/** Error de la API traducido a un mensaje general y a mensajes por campo. */
export class ErrorDeApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly campos: ErroresCampo = {},
  ) {
    super(message);
  }
}

/** Llama a la API y devuelve el cuerpo JSON; si la respuesta es de error, lanza ErrorDeApi. */
export async function llamarApi<T>(url: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ErrorDeApi("No fue posible comunicarse con el servidor. Intente nuevamente.", 0, "RED");
  }
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const error = (cuerpo as RespuestaError | null)?.error;
    const campos: ErroresCampo = {};
    if (Array.isArray(error?.details)) {
      for (const d of error.details as { campo?: unknown; mensaje?: unknown }[]) {
        if (typeof d.campo === "string" && typeof d.mensaje === "string") campos[d.campo] = d.mensaje;
      }
    }
    throw new ErrorDeApi(
      error?.message ?? "Ocurrió un error inesperado.",
      respuesta.status,
      error?.code ?? "ERROR_INTERNO",
      campos,
    );
  }
  return cuerpo as T;
}

/** Errores de Zod por campo (el primero de cada uno), con la misma ruta que la API. */
export function erroresDeZod(error: z.ZodError): ErroresCampo {
  const campos: ErroresCampo = {};
  for (const issue of error.issues) campos[issue.path.map(String).join(".")] ??= issue.message;
  return campos;
}
