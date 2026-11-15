/**
 * GET /api/facturas/proximo-numero — RF-V1 (sección 11.6). Ambos roles.
 *
 * 200 { "numeroFormateado": "0001-00000001" }. Solo informativo: no reserva
 * ni consume numeración; el número real se asigna al confirmar (regla 4).
 *
 * Solo adapta HTTP: las reglas están en src/servicios/facturas.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { consultarProximoNumero } from "@/servicios/facturas";

export const GET = rutaProtegida(async (_req, { usuario }) => {
  return responderJson(await consultarProximoNumero(usuario));
});
