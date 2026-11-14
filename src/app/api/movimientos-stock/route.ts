/**
 * GET /api/movimientos-stock — RF-P6 (sección 11.4). Ambos roles.
 *
 * Filtros: `productoId`, `tipo`, `desde` y `hasta` (AAAA-MM-DD, hora de
 * Argentina) y paginación → 200 { data, page, pageSize, total }, del más
 * nuevo al más viejo.
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/stock.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { listarMovimientosStock } from "@/servicios/stock";

export const GET = rutaProtegida(async (req, { usuario }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await listarMovimientosStock(usuario, consulta));
});
