/**
 * Verificación centralizada de roles (sección 3 y sección 10.5).
 *
 * Es la tercera barrera: cada servicio que requiere un rol llama a
 * `exigirRol()` antes de aplicar sus reglas. Ocultar un botón en la interfaz
 * es solo una ayuda visual; quien decide el permiso es el servicio, que
 * responde 403 SIN_PERMISO aunque se llame a la API directamente (10.8, punto 2).
 *
 * Ejemplo de uso en un servicio futuro:
 *
 *   export async function crearProducto(usuario: UsuarioAutenticado, datos: unknown) {
 *     const entrada = esquemaProducto.parse(datos);
 *     exigirRol(usuario, "admin"); // RF-P2: solo el administrador
 *     ...
 *   }
 */
import type { Rol } from "@/db/schema";
import { ApiError } from "@/lib/api-error";

import type { UsuarioAutenticado } from "./auth";

/** Indica si el usuario tiene alguno de los roles indicados. */
export function tieneRol(usuario: Pick<UsuarioAutenticado, "rol">, ...roles: Rol[]): boolean {
  return roles.includes(usuario.rol);
}

/**
 * RF-U2: sin usuario → 401 NO_AUTENTICADO.
 * Sección 3: rol insuficiente → 403 SIN_PERMISO.
 */
export function exigirRol(
  usuario: UsuarioAutenticado | null | undefined,
  ...roles: Rol[]
): asserts usuario is UsuarioAutenticado {
  if (!usuario) throw ApiError.desdeCodigo("NO_AUTENTICADO");
  if (!tieneRol(usuario, ...roles)) throw ApiError.desdeCodigo("SIN_PERMISO");
}
