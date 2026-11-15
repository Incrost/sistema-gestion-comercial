/**
 * GET /api/tablero — RF-T1 a RF-T3 (sección 11.2). Ambos roles.
 *
 * → 200 { hoy, mes, cuentasCorrientes, bajoMinimo, ventasDiarias,
 *         porFormaDePago, masVendidos } (importes en centavos).
 * Sin sesión, o con un usuario desactivado → 401 NO_AUTENTICADO.
 *
 * No recibe parámetros: el período lo define el reloj del servidor.
 * Solo adapta HTTP: los cálculos están en src/servicios/tablero.ts.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";
import { obtenerTablero } from "@/servicios/tablero";

export const GET = rutaProtegida(async (_req, { usuario }) => {
  return responderJson(await obtenerTablero(usuario));
});
