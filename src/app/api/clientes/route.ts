/**
 * /api/clientes — RF-C1, RF-C2, RF-C6 (sección 11.5).
 *
 * - GET (ambos roles): `q` (nombre o documento, sin importar puntos, espacios
 *   ni guiones), `conDeuda=true`, `orden=nombre|saldo`, `activo` (por defecto
 *   `true`; `false`/`todos` solo admin), `page`, `pageSize`
 *   → 200 { data, page, pageSize, total } y, con `conDeuda=true`, `totalAdeudado`.
 * - POST (ambos roles): { tipoDoc, nroDoc, nombre, domicilio?, telefono?,
 *   email?, cuentaCorriente?, limiteCredito? } → 201 con el cliente;
 *   409 DOCUMENTO_DUPLICADO; 422 VALIDACION (por ejemplo, si llega `saldo`).
 *
 * Solo adapta HTTP: validación, permisos y reglas están en src/servicios/clientes.ts.
 */
import { leerJson, responderJson, rutaProtegida } from "@/lib/http/ruta";
import { crearCliente, listarClientes } from "@/servicios/clientes";

export const GET = rutaProtegida(async (req, { usuario }) => {
  const consulta = Object.fromEntries(req.nextUrl.searchParams);
  return responderJson(await listarClientes(usuario, consulta));
});

export const POST = rutaProtegida(async (req, { usuario }) => {
  return responderJson(await crearCliente(usuario, await leerJson(req)), 201);
});
