/**
 * /api/categorias — RF-P7 (sección 11.4).
 *
 * - GET (ambos roles): categorías activas ordenadas por nombre, sin paginar.
 *   `incluirInactivas=true` (solo admin) agrega las inactivas.
 * - POST (admin): { nombre } → 201 con la categoría; 409 NOMBRE_DUPLICADO.
 *
 * No hay DELETE: la baja es lógica con PATCH { "activa": false } (regla 12).
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/categorias.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { crearCategoria, listarCategorias } from "@/servicios/categorias";

export const GET = rutaProtegida(async (req, { usuario }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await listarCategorias(usuario, consulta));
});

export const POST = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await crearCategoria(usuario, await leerJson(req)), 201);
});
