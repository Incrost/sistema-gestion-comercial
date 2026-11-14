/**
 * POST /api/auth/logout — RF-U1 (sección 11.3). Exige sesión.
 * 204 y borra la cookie de sesión.
 */
import { responderSinContenido, rutaProtegida } from "@/lib/http/ruta";
import { eliminarCookieSesion } from "@/lib/sesion";

export const POST = rutaProtegida(async () => {
  const respuesta = responderSinContenido();
  eliminarCookieSesion(respuesta);
  return respuesta;
});
