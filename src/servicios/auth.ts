/**
 * Servicio de autenticación (sección 10.2: un módulo por parte del dominio).
 *
 * No conoce HTTP, cookies ni componentes: recibe datos sin validar (y, cuando
 * corresponde, el usuario autenticado) y devuelve datos con la forma pública.
 * Lo usan los Route Handlers de /api/auth y el módulo de sesión.
 *
 * Orden de cada función: validar entrada → recuperar al usuario → verificar
 * sesión o permiso → aplicar la regla → devolver la representación pública.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { usuarios, type Rol, type Usuario } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import {
  hashearContrasena,
  obtenerHashDeRelleno,
  verificarContrasena,
} from "@/lib/contrasenas";
import { esquemaCambioContrasena, esquemaLogin } from "@/lib/validacion";

/** Representación pública de un usuario: NUNCA incluye passwordHash. */
export type UsuarioPublico = {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
};

/** Usuario que inició sesión, ya verificado contra la base en este pedido. */
export type UsuarioAutenticado = UsuarioPublico;

/**
 * Arma la forma pública eligiendo campo por campo (lista blanca): aunque la
 * tabla gane columnas nuevas, el hash no puede filtrarse por accidente.
 */
export function aUsuarioPublico(fila: Usuario): UsuarioPublico {
  return { id: fila.id, nombre: fila.nombre, email: fila.email, rol: fila.rol };
}

async function buscarPorEmail(email: string): Promise<Usuario | undefined> {
  const [fila] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
  return fila;
}

async function buscarPorId(id: number): Promise<Usuario | undefined> {
  const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
  return fila;
}

/**
 * RF-U1: valida email y contraseña. RF-U4: un usuario desactivado no entra.
 *
 * Email inexistente, contraseña incorrecta y usuario inactivo responden el
 * MISMO error 401 CREDENCIALES_INVALIDAS (sección 11.3), para no revelar qué
 * emails existen ni el estado de las cuentas.
 */
export async function validarCredenciales(datos: unknown): Promise<UsuarioPublico> {
  // 1. Validar entrada (email normalizado en minúsculas).
  const { email, password } = esquemaLogin.parse(datos);

  // 2. Recuperar al usuario.
  const fila = await buscarPorEmail(email);

  // 3-4. Verificar la contraseña siempre, aun sin usuario, para que el tiempo
  // de respuesta no delate si el email existe.
  const hash = fila?.passwordHash ?? (await obtenerHashDeRelleno());
  const coincide = await verificarContrasena(password, hash);

  if (!fila || !coincide || !fila.activo) {
    throw ApiError.desdeCodigo("CREDENCIALES_INVALIDAS");
  }

  // 5. Forma pública.
  return aUsuarioPublico(fila);
}

/**
 * RF-U2 y sección 10.5: resuelve el usuario de una sesión contra la base en
 * cada pedido. Devuelve `null` si ya no existe o fue desactivado (RF-U4): así
 * la baja o el cambio de rol tienen efecto inmediato aunque la cookie siga viva.
 */
export async function obtenerUsuarioActivo(id: number): Promise<UsuarioAutenticado | null> {
  const fila = await buscarPorId(id);
  if (!fila || !fila.activo) return null;
  return aUsuarioPublico(fila);
}

/**
 * RF-U5: el usuario cambia SU PROPIA contraseña indicando la actual.
 * La contraseña actual incorrecta responde 422 CONTRASENA_ACTUAL_INCORRECTA.
 */
export async function cambiarContrasena(
  usuario: UsuarioAutenticado,
  datos: unknown,
): Promise<void> {
  // 1. Validar entrada (nueva: mínimo 8 caracteres).
  const { actual, nueva } = esquemaCambioContrasena.parse(datos);

  // 2. Recuperar al usuario (con su hash) desde la base.
  const fila = await buscarPorId(usuario.id);

  // 3. Verificar la sesión: si lo desactivaron entre medio, ya no puede operar.
  if (!fila || !fila.activo) {
    throw ApiError.desdeCodigo("NO_AUTENTICADO");
  }

  // 4. Aplicar la regla: la contraseña actual debe coincidir.
  if (!(await verificarContrasena(actual, fila.passwordHash))) {
    throw ApiError.desdeCodigo("CONTRASENA_ACTUAL_INCORRECTA", undefined, [
      { campo: "actual", mensaje: "La contraseña actual es incorrecta." },
    ]);
  }

  // Solo se guarda el hash de la nueva contraseña.
  await db
    .update(usuarios)
    .set({ passwordHash: await hashearContrasena(nueva) })
    .where(eq(usuarios.id, fila.id));
}
