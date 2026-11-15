/**
 * Envoltorio común de los Route Handlers (sección 10.3).
 *
 * Concentra lo que comparten todas las rutas de /api para que cada `route.ts`
 * quede en pocas líneas (exigir sesión → leer datos → llamar al servicio →
 * responder):
 *
 * - exige la sesión (salvo en `rutaPublica`) y entrega el usuario ya leído de
 *   la base en este pedido;
 * - lee el JSON de forma segura (`leerJson`): un cuerpo inválido → 400 JSON_INVALIDO;
 * - convierte cualquier error con `normalizarError()`: ApiError tal cual,
 *   ZodError → 422 VALIDACION, otro → 500 ERROR_INTERNO (el detalle solo va al log);
 *   las señales internas de Next.js (p. ej. la interrupción del prerenderizado
 *   al leer cookies durante `next build`) se relanzan con `unstable_rethrow`
 *   para que no se registren ni respondan como ERROR_INTERNO;
 * - responde siempre con el formato de la sección 11.1.
 *
 * NO contiene reglas de negocio: esas viven en src/servicios.
 *
 * Solo servidor.
 */
import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { ApiError, normalizarError } from "@/lib/api-error";
import { eliminarCookieSesion, resolverSesion } from "@/lib/sesion";
import { NOMBRE_COOKIE_SESION } from "@/lib/sesion-token";
import type { UsuarioAutenticado } from "@/servicios/auth";

/** Segundo argumento que Next.js pasa a cada Route Handler. */
export type ContextoRuta<P = Record<string, string | string[]>> = { params: Promise<P> };

type Manejador<P> = (req: NextRequest, ctx: ContextoRuta<P>) => Promise<Response>;

type ManejadorProtegido<P> = (
  req: NextRequest,
  ctx: ContextoRuta<P> & { usuario: UsuarioAutenticado },
) => Promise<Response>;

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

/** Respuesta JSON exitosa (200 por defecto). */
export function responderJson(datos: unknown, status = 200): NextResponse {
  return NextResponse.json(datos, { status });
}

/** Respuesta 204 sin cuerpo. */
export function responderSinContenido(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Convierte cualquier error en la respuesta de error estándar (sección 11.1). */
export function responderError(error: unknown): NextResponse {
  const apiError = normalizarError(error);
  return NextResponse.json(apiError.aRespuesta(), { status: apiError.status });
}

// ---------------------------------------------------------------------------
// Lectura del cuerpo
// ---------------------------------------------------------------------------

/**
 * Lee el cuerpo como JSON. Si está vacío o no es JSON válido lanza
 * 400 JSON_INVALIDO. No valida su contenido: eso lo hace el servicio con Zod.
 */
export async function leerJson(req: Request): Promise<unknown> {
  let texto: string;
  try {
    texto = await req.text();
  } catch {
    throw ApiError.desdeCodigo("JSON_INVALIDO");
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw ApiError.desdeCodigo("JSON_INVALIDO");
  }
}

// ---------------------------------------------------------------------------
// Envoltorios
// ---------------------------------------------------------------------------

/** Ruta pública (solo POST /api/auth/login): no exige sesión. */
export function rutaPublica<P = Record<string, string | string[]>>(manejador: Manejador<P>) {
  return async (req: NextRequest, ctx: ContextoRuta<P>): Promise<Response> => {
    try {
      return await manejador(req, ctx);
    } catch (error) {
      unstable_rethrow(error);
      return responderError(error);
    }
  };
}

/**
 * Ruta protegida (RF-U2): sin sesión válida responde 401 NO_AUTENTICADO y, si
 * había una cookie inútil (manipulada, vencida o de un usuario desactivado),
 * la borra. Con sesión válida llama al manejador con el usuario autenticado.
 */
export function rutaProtegida<P = Record<string, string | string[]>>(
  manejador: ManejadorProtegido<P>,
) {
  return async (req: NextRequest, ctx: ContextoRuta<P>): Promise<Response> => {
    try {
      const sesion = await resolverSesion(req.cookies.get(NOMBRE_COOKIE_SESION)?.value);
      if (sesion.estado !== "valida") {
        const respuesta = responderError(ApiError.desdeCodigo("NO_AUTENTICADO"));
        if (sesion.estado !== "ausente") eliminarCookieSesion(respuesta);
        return respuesta;
      }
      return await manejador(req, { ...ctx, usuario: sesion.usuario });
    } catch (error) {
      unstable_rethrow(error);
      return responderError(error);
    }
  };
}
