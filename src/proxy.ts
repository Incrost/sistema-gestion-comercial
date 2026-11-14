/**
 * Proxy de Next.js 16 (antes «middleware»): PRIMERA barrera de la sección 10.5.
 *
 * Corre antes de cada pedido y solo verifica que exista una cookie de sesión
 * con firma válida y sin vencer. NO consulta la base (correría en cada
 * pedido, incluidas las precargas): que el usuario siga activo y su rol lo
 * comprueban las páginas (segunda barrera) y los servicios (tercera barrera).
 *
 * - Páginas: sin sesión firmada → redirige a /login?desde=<ruta>.
 * - API: sin sesión firmada → 401 NO_AUTENTICADO en el formato estándar,
 *   salvo POST /api/auth/login, la única operación pública (RF-U2).
 * - /login es pública y el proxy nunca redirige DESDE ella, así no puede
 *   formarse un ciclo (por ejemplo, con la cookie de un usuario desactivado).
 */
import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api-error";
import {
  NOMBRE_COOKIE_SESION,
  opcionesCookieSesion,
  verificarSesion,
} from "@/lib/sesion-token";

const RUTA_LOGIN = "/login";
const API_LOGIN = "/api/auth/login";

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Rutas públicas.
  if (pathname === RUTA_LOGIN || pathname === API_LOGIN) {
    return NextResponse.next();
  }

  const sesion = await verificarSesion(req.cookies.get(NOMBRE_COOKIE_SESION)?.value);
  if (sesion) return NextResponse.next();

  let respuesta: NextResponse;
  if (pathname.startsWith("/api/")) {
    const error = ApiError.desdeCodigo("NO_AUTENTICADO");
    respuesta = NextResponse.json(error.aRespuesta(), { status: error.status });
  } else {
    const destino = new URL(RUTA_LOGIN, req.url);
    if (pathname !== "/") destino.searchParams.set("desde", pathname + search);
    respuesta = NextResponse.redirect(destino);
  }

  // Si había una cookie pero no sirve (manipulada o vencida), se borra.
  if (req.cookies.has(NOMBRE_COOKIE_SESION)) {
    respuesta.cookies.set(NOMBRE_COOKIE_SESION, "", { ...opcionesCookieSesion(), maxAge: 0 });
  }
  return respuesta;
}

export const config = {
  // Todo excepto archivos internos de Next.js y archivos estáticos con extensión
  // (favicon.ico, imágenes de /public, etc.).
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
