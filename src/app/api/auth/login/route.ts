/**
 * POST /api/auth/login — RF-U1 (sección 11.3). Única ruta pública de la API.
 * 200 con el usuario público y la cookie de sesión; 401 CREDENCIALES_INVALIDAS.
 */
import { leerJson, responderJson, rutaPublica } from "@/lib/http/ruta";
import { crearCookieSesion } from "@/lib/sesion";
import { validarCredenciales } from "@/servicios/auth";

export const POST = rutaPublica(async (req) => {
  const usuario = await validarCredenciales(await leerJson(req));
  const respuesta = responderJson(usuario);
  await crearCookieSesion(respuesta, usuario.id);
  return respuesta;
});
