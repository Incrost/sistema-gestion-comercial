/**
 * /api/facturas — RF-V1 a RF-V6 (sección 11.6). Ambos roles.
 *
 * - POST: { clienteId (null = consumidor final), items: [{ productoId, cantidad }],
 *   pago: { forma, ... } } → 201 con la factura emitida.
 *   Errores: 400 JSON_INVALIDO; 401; 404 NO_ENCONTRADO; 409 STOCK_INSUFICIENTE;
 *   422 VALIDACION, PRODUCTO_INACTIVO, CUENTA_CORRIENTE_NO_HABILITADA,
 *   LIMITE_CREDITO_EXCEDIDO, MONTO_INSUFICIENTE.
 *
 * (El listado GET llegará con RF-V8.)
 *
 * Solo adapta HTTP: validación, permisos, reglas y transacción están en
 * src/servicios/facturas.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { emitirFactura } from "@/servicios/facturas";

export const POST = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await emitirFactura(usuario, await leerJson(req)), 201);
});
