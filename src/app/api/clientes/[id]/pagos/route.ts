/**
 * POST /api/clientes/{id}/pagos — RF-C5 (sección 11.5). Ambos roles.
 *
 * Cuerpo: { importe (centavos), medio, observacion? } → 201 con el recibo y
 * el saldo nuevo del cliente (`saldoCliente`).
 * Errores: 404; 422 VALIDACION; 422 CUENTA_CORRIENTE_NO_HABILITADA;
 * 422 PAGO_SUPERA_DEUDA (regla 8).
 *
 * Solo adapta HTTP: validación, permisos, reglas y transacción están en
 * src/servicios/pagos.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { registrarPago } from "@/servicios/pagos";

export const POST = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(await registrarPago(usuario, await params, await leerJson(req)), 201);
});
