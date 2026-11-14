/**
 * PATCH /api/categorias/{id} — RF-P7 (sección 11.4). Solo administrador.
 *
 * Cuerpo: `nombre` y/o `activa`. 200 con la categoría; 404 NO_ENCONTRADO;
 * 409 NOMBRE_DUPLICADO; 409 CATEGORIA_EN_USO si se desactiva con productos activos.
 * No hay DELETE: la baja es lógica (regla 12).
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/categorias.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { actualizarCategoria } from "@/servicios/categorias";

export const PATCH = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(await actualizarCategoria(usuario, await params, await leerJson(req)));
});
