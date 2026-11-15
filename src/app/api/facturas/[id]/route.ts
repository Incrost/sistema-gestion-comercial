/**
 * GET /api/facturas/{id} — RF-V7 (sección 11.6). Ambos roles.
 *
 * 200 con la factura completa, con la misma forma que la respuesta de
 * emisión (datos congelados del comprador, renglones y forma de pago). Si
 * está anulada agrega `anulacion: { fecha, usuario, motivo }`. `saldoCliente`
 * no se incluye: no se guarda en la factura. 404 NO_ENCONTRADO si no existe.
 *
 * El segmento fijo /api/facturas/proximo-numero tiene prioridad sobre [id].
 * No hay PATCH ni DELETE: una factura confirmada no se modifica (regla 5).
 *
 * Solo adapta HTTP: las reglas están en src/servicios/facturas.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { obtenerFactura } from "@/servicios/facturas";

export const GET = rutaProtegida<{ id: string }>(async (_req, { usuario, params }) => {
  return responderJson(await obtenerFactura(usuario, await params));
});
