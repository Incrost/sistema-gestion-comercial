/**
 * /api/productos — RF-P1, RF-P2 (sección 11.4).
 *
 * - GET (ambos roles): `q`, `categoriaId`, `bajoMinimo`, `activo` (por defecto
 *   `true`; `false`/`todos` solo admin), `page`, `pageSize`
 *   → 200 { data, page, pageSize, total }.
 * - POST (admin): { codigo, descripcion, categoriaId, precio, stockMinimo,
 *   stockInicial? } → 201 con el producto; 409 CODIGO_DUPLICADO;
 *   422 VALIDACION (por ejemplo, si llega `existencia`).
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/productos.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { crearProducto, listarProductos } from "@/servicios/productos";

export const GET = rutaProtegida(async (req, { usuario }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await listarProductos(usuario, consulta));
});

export const POST = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await crearProducto(usuario, await leerJson(req)), 201);
});
