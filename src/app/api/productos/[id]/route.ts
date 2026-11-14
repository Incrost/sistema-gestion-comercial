/**
 * /api/productos/{id} — RF-P1, RF-P2, RF-P3 (sección 11.4).
 *
 * - GET (ambos roles): el producto; 404 NO_ENCONTRADO (al vendedor, también
 *   si el producto está inactivo).
 * - PATCH (admin): cualquiera de `codigo`, `descripcion`, `categoriaId`,
 *   `precio`, `stockMinimo`, `activo` → 200; 404; 409 CODIGO_DUPLICADO;
 *   422 si llega `existencia`.
 *
 * No hay DELETE: la baja es lógica con { "activo": false } (RF-P3, regla 12).
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/productos.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { actualizarProducto, obtenerProducto } from "@/servicios/productos";

export const GET = rutaProtegida<{ id: string }>(async (_req, { usuario, params }) => {
  return responderJson(await obtenerProducto(usuario, await params));
});

export const PATCH = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(await actualizarProducto(usuario, await params, await leerJson(req)));
});
