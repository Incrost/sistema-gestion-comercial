/**
 * /api/facturas — RF-V1 a RF-V6 y RF-V8 (sección 11.6). Ambos roles.
 *
 * - GET: `q` (número o nombre del comprador), `desde`, `hasta` (AAAA-MM-DD,
 *   hora de Argentina), `clienteId`, `vendedorId`, `forma`, `estado`, `page`,
 *   `pageSize` → 200 { data, page, pageSize, total, totalEmitido }, de la más
 *   nueva a la más vieja y sin renglones. 422 VALIDACION si un parámetro es
 *   inválido o desconocido.
 * - POST: { clienteId (null = consumidor final), items: [{ productoId, cantidad }],
 *   pago: { forma, ... } } → 201 con la factura emitida.
 *   Errores: 400 JSON_INVALIDO; 401; 404 NO_ENCONTRADO; 409 STOCK_INSUFICIENTE;
 *   422 VALIDACION, PRODUCTO_INACTIVO, CUENTA_CORRIENTE_NO_HABILITADA,
 *   LIMITE_CREDITO_EXCEDIDO, MONTO_INSUFICIENTE.
 *
 * Solo adapta HTTP: validación, permisos, reglas y transacción están en
 * src/servicios/facturas.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { emitirFactura, listarFacturas } from "@/servicios/facturas";

export const GET = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await listarFacturas(usuario, Object.fromEntries(req.nextUrl.searchParams)));
});

export const POST = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await emitirFactura(usuario, await leerJson(req)), 201);
});
