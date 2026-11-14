/**
 * POST /api/usuarios/{id}/reset-password — RF-U5 (sección 11.3). Solo administrador.
 *
 * Sin cuerpo. 200 con { "passwordTemporal": "…" }, que se entrega una sola vez;
 * 404 NO_ENCONTRADO. La respuesta no se guarda en ninguna caché (`no-store`).
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/usuarios.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { restablecerContrasena } from "@/servicios/usuarios";

export const POST = rutaProtegida<{ id: string }>(async (_req, { usuario, params }) => {
  const respuesta = responderJson(await restablecerContrasena(usuario, await params));
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
});
