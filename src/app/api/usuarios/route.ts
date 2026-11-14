/**
 * /api/usuarios — RF-U4 (sección 11.3). Solo administrador (403 al vendedor).
 *
 * - GET:  `q`, `activo`, `page`, `pageSize` → 200 { data, page, pageSize, total }.
 * - POST: { nombre, email, rol, password } → 201 con el usuario; 409 EMAIL_DUPLICADO.
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/usuarios.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { crearUsuario, listarUsuarios } from "@/servicios/usuarios";

export const GET = rutaProtegida(async (req, { usuario }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await listarUsuarios(usuario, consulta));
});

export const POST = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await crearUsuario(usuario, await leerJson(req)), 201);
});
