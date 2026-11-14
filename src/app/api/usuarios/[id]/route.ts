/**
 * PATCH /api/usuarios/{id} — RF-U4 (sección 11.3). Solo administrador.
 *
 * Cuerpo: cualquiera de `nombre`, `email`, `rol`, `activo`. 200 con el usuario;
 * 404 NO_ENCONTRADO; 409 EMAIL_DUPLICADO; 422 OPERACION_SOBRE_SI_MISMO.
 * No hay DELETE: la baja es lógica con { "activo": false } (regla 12).
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/usuarios.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { actualizarUsuario } from "@/servicios/usuarios";

export const PATCH = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(await actualizarUsuario(usuario, await params, await leerJson(req)));
});
