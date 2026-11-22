/**
 * GET /api/clientes/{id}/cuenta — RF-C4 (sección 11.5). Ambos roles.
 *
 * Filtros opcionales `desde` y `hasta` (AAAA-MM-DD, días de Argentina) →
 * 200 { cliente, saldoAnterior, movimientos, saldo }, en orden cronológico y
 * con el saldo acumulado en cada renglón. 404 si el cliente no existe;
 * 422 VALIDACION si `desde` es posterior a `hasta`.
 *
 * Solo lectura: no hay ruta para crear movimientos de cuenta (los graban los
 * servicios de pagos y de facturas).
 * Solo adapta HTTP: las reglas están en src/servicios/cuenta-corriente.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { obtenerCuentaCorriente } from "@/servicios/cuenta-corriente";

export const GET = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await obtenerCuentaCorriente(usuario, await params, consulta));
});
