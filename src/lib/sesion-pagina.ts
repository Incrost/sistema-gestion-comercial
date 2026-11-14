/**
 * Sesión en páginas y layouts (Server Components): segunda barrera de la
 * sección 10.5. El proxy ya redirigió si faltaba la cookie firmada; aquí se
 * vuelve a comprobar, contra la base, que el usuario exista y esté activo.
 *
 * Uso en una página protegida:
 *
 *   const usuario = await exigirUsuarioDePagina();
 *
 * Solo servidor.
 */
import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { resolverSesion } from "@/lib/sesion";
import { NOMBRE_COOKIE_SESION } from "@/lib/sesion-token";
import type { UsuarioAutenticado } from "@/servicios/auth";

/**
 * Usuario del pedido actual, o `null`. `cache` hace que layout y página
 * compartan una sola consulta a la base dentro del MISMO pedido; cada pedido
 * nuevo vuelve a consultar.
 */
export const obtenerUsuarioDePagina = cache(async (): Promise<UsuarioAutenticado | null> => {
  const token = (await cookies()).get(NOMBRE_COOKIE_SESION)?.value;
  const resultado = await resolverSesion(token);
  return resultado.estado === "valida" ? resultado.usuario : null;
});

/** RF-U2: devuelve el usuario o redirige al login si la sesión no es válida. */
export async function exigirUsuarioDePagina(): Promise<UsuarioAutenticado> {
  const usuario = await obtenerUsuarioDePagina();
  // Desde /login nunca se redirige de vuelta automáticamente si la sesión no
  // es válida, así que no puede formarse un ciclo de redirecciones.
  if (!usuario) redirect("/login");
  return usuario;
}
