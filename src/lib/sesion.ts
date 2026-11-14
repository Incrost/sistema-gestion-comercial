/**
 * Sesión del usuario: de la cookie firmada al usuario de la base (sección 10.5).
 *
 * - `resolverSesion()` verifica la cookie y vuelve a leer al usuario de la base
 *   EN CADA PEDIDO: si fue desactivado o cambió de rol, se refleja de inmediato.
 * - `crearCookieSesion()` / `eliminarCookieSesion()` escriben la cookie en una
 *   respuesta (las usan los Route Handlers de /api/auth).
 *
 * Las páginas usan src/lib/sesion-pagina.ts, que se apoya en este módulo.
 *
 * Solo servidor.
 */
import "server-only";

import type { NextResponse } from "next/server";

import { ApiError } from "@/lib/api-error";
import {
  firmarSesion,
  NOMBRE_COOKIE_SESION,
  opcionesCookieSesion,
  verificarSesion,
} from "@/lib/sesion-token";
import { obtenerUsuarioActivo, type UsuarioAutenticado } from "@/servicios/auth";

/**
 * Resultado de leer la sesión. Distingue los casos para el servidor (por
 * ejemplo, para borrar una cookie inútil), pero hacia afuera los tres casos
 * negativos responden lo mismo: 401 NO_AUTENTICADO, sin dar más detalle.
 */
export type ResultadoSesion =
  | { estado: "valida"; usuario: UsuarioAutenticado }
  | { estado: "ausente" } // no hay cookie
  | { estado: "invalida" } // firma alterada, vencida o mal formada
  | { estado: "desactivado" }; // firma correcta, pero el usuario ya no existe o está inactivo

/** RF-U2: obtiene el usuario autenticado a partir del valor de la cookie. */
export async function resolverSesion(token: string | undefined): Promise<ResultadoSesion> {
  if (!token) return { estado: "ausente" };

  const datos = await verificarSesion(token);
  if (!datos) return { estado: "invalida" };

  const usuario = await obtenerUsuarioActivo(datos.usuarioId);
  if (!usuario) return { estado: "desactivado" };

  return { estado: "valida", usuario };
}

/** Igual que `resolverSesion()`, pero lanza 401 NO_AUTENTICADO si no es válida. */
export async function exigirSesion(token: string | undefined): Promise<UsuarioAutenticado> {
  const resultado = await resolverSesion(token);
  if (resultado.estado !== "valida") throw ApiError.desdeCodigo("NO_AUTENTICADO");
  return resultado.usuario;
}

/** Agrega a la respuesta la cookie firmada de sesión (RF-U1). */
export async function crearCookieSesion(
  respuesta: NextResponse,
  usuarioId: number,
): Promise<void> {
  const token = await firmarSesion(usuarioId);
  respuesta.cookies.set(NOMBRE_COOKIE_SESION, token, opcionesCookieSesion());
}

/** Agrega a la respuesta la orden de borrar la cookie de sesión (RF-U1). */
export function eliminarCookieSesion(respuesta: NextResponse): void {
  respuesta.cookies.set(NOMBRE_COOKIE_SESION, "", { ...opcionesCookieSesion(), maxAge: 0 });
}
