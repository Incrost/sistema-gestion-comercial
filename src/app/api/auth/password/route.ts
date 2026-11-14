/**
 * PUT /api/auth/password — RF-U5 (sección 11.3). Exige sesión.
 * Cuerpo: { actual, nueva }. 204; 422 CONTRASENA_ACTUAL_INCORRECTA.
 */
import { leerJson, responderSinContenido, rutaProtegida } from "@/lib/http/ruta";
import { cambiarContrasena } from "@/servicios/auth";

export const PUT = rutaProtegida(async (req, { usuario }) => {
  await cambiarContrasena(usuario, await leerJson(req));
  return responderSinContenido();
});
