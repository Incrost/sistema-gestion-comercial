/**
 * POST /api/facturas/{id}/anulacion — RF-V9 (sección 11.6). Solo admin.
 *
 * Cuerpo: { "motivo": "..." } (ningún otro campo) → 200 con la factura
 * anulada (stock reingresado y, si fue a cuenta corriente, crédito por el total).
 * Errores: 400 JSON_INVALIDO; 401; 403 SIN_PERMISO; 404 NO_ENCONTRADO;
 * 409 FACTURA_ANULADA; 422 VALIDACION (motivo faltante o inválido, campos
 * extra, o factura a cuenta con pagos aplicados: decisión temporal C1).
 *
 * Solo adapta HTTP: validación, permisos, reglas y transacción están en
 * src/servicios/facturas.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { anularFactura } from "@/servicios/facturas";

export const POST = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(await anularFactura(usuario, await params, await leerJson(req)));
});
