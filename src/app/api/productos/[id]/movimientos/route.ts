/**
 * /api/productos/{id}/movimientos — RF-P4, RF-P5, RF-P6 (sección 11.4).
 *
 * - GET (ambos roles): historial del producto, del más nuevo al más viejo,
 *   paginado → 200 { data, page, pageSize, total }.
 * - POST (admin): { tipo: "ingreso" | "egreso", cantidad, motivo, observacion? }
 *   → 201 con el movimiento y la existencia resultante;
 *   409 STOCK_INSUFICIENTE si un egreso dejaría la existencia negativa.
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/stock.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { listarMovimientosProducto, registrarMovimientoManual } from "@/servicios/stock";

export const GET = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await listarMovimientosProducto(usuario, await params, consulta));
});

export const POST = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(
    await registrarMovimientoManual(usuario, await params, await leerJson(req)),
    201,
  );
});
