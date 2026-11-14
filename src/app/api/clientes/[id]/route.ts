/**
 * /api/clientes/{id} — RF-C2, RF-C3, RF-C7 (sección 11.5).
 *
 * - GET (ambos roles): el cliente con saldo, disponible y `ultimasFacturas`
 *   (máximo 6, de la más reciente); 404 NO_ENCONTRADO (al vendedor, también
 *   si el cliente está inactivo).
 * - PATCH (ambos roles): cualquier campo del alta, más `activo` (solo admin)
 *   → 200; 404; 409 DOCUMENTO_DUPLICADO; 422 SALDO_PENDIENTE si se desactiva
 *   o se le quita la cuenta corriente con saldo distinto de cero.
 *
 * No hay DELETE: la baja es lógica con { "activo": false } (RF-C7, regla 12).
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/clientes.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { actualizarCliente, obtenerCliente } from "@/servicios/clientes";

export const GET = rutaProtegida<{ id: string }>(async (_req, { usuario, params }) => {
  return responderJson(await obtenerCliente(usuario, await params));
});

export const PATCH = rutaProtegida<{ id: string }>(async (req, { usuario, params }) => {
  return responderJson(await actualizarCliente(usuario, await params, await leerJson(req)));
});
