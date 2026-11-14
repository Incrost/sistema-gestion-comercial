/**
 * GET /api/auth/me — RF-U2 (sección 11.3).
 * 200 con el usuario conectado (leído de la base en este pedido); 401 sin sesión.
 */
import { responderJson, rutaProtegida } from "@/lib/http/ruta";

export const GET = rutaProtegida(async (_req, { usuario }) => responderJson(usuario));
