/**
 * GET /api/pagos/{id} — RF-C5 (sección 11.5). Ambos roles.
 *
 * Devuelve el mismo objeto que el registro del pago, para reimprimir el
 * recibo. `saldoCliente` es el saldo histórico guardado al registrarlo.
 * 404 NO_ENCONTRADO si no existe.
 *
 * Solo adapta HTTP: las reglas están en src/servicios/pagos.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { obtenerPago } from "@/servicios/pagos";

export const GET = rutaProtegida<{ id: string }>(async (_req, { usuario, params }) => {
  return responderJson(await obtenerPago(usuario, await params));
});
