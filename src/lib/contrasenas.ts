/**
 * Hash de contraseñas con bcrypt (`bcryptjs`, sin módulos nativos) (RF-U5). Solo
 * se guarda el hash con sal; la contraseña en claro nunca se guarda ni se loguea.
 * bcrypt usa hasta 72 bytes: por eso el máximo de 72 en esquemaContrasena. Solo servidor.
 */
import "server-only";

import bcrypt from "bcryptjs";

/**
 * Costo de bcrypt (2^COSTO iteraciones). 11 ronda los 100–200 ms por hash en
 * JavaScript puro: suficientemente lento para un atacante y aceptable para
 * un inicio de sesión. Subirlo encarece cada login.
 */
export const COSTO_HASH = 11;

/** Devuelve el hash bcrypt de la contraseña (incluye sal y costo). */
export function hashearContrasena(contrasena: string): Promise<string> {
  return bcrypt.hash(contrasena, COSTO_HASH);
}

/** Compara una contraseña en claro con un hash guardado, en tiempo constante. */
export function verificarContrasena(contrasena: string, hash: string): Promise<boolean> {
  return bcrypt.compare(contrasena, hash);
}

/**
 * Alfabeto de las contraseñas temporales: letras y dígitos sin los caracteres
 * que se confunden al dictarlos o copiarlos (0/O, 1/l/I).
 */
const ALFABETO_TEMPORAL = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Longitud de la contraseña temporal (≈ 93 bits de entropía con este alfabeto). */
export const LONGITUD_CONTRASENA_TEMPORAL = 16;

/**
 * RF-U5: genera una contraseña temporal con el generador criptográfico del
 * sistema (`crypto.getRandomValues`), nunca con Math.random. Usa muestreo por
 * rechazo para que todos los caracteres del alfabeto sean equiprobables.
 * Quien la recibe debe mostrarla una sola vez y no registrarla en el log.
 */
export function generarContrasenaTemporal(longitud = LONGITUD_CONTRASENA_TEMPORAL): string {
  const n = ALFABETO_TEMPORAL.length;
  // Mayor múltiplo de n que entra en un byte: los bytes por encima se descartan.
  const limite = 256 - (256 % n);
  let resultado = "";
  while (resultado.length < longitud) {
    for (const byte of crypto.getRandomValues(new Uint8Array(longitud * 2))) {
      if (byte < limite) resultado += ALFABETO_TEMPORAL[byte % n];
      if (resultado.length === longitud) break;
    }
  }
  return resultado;
}

let hashDeRelleno: Promise<string> | undefined;

/**
 * Hash de relleno para cuando el email no existe: se compara igual contra él
 * para que la respuesta tarde lo mismo y no revele qué emails están registrados.
 * Es el hash de un texto aleatorio que nadie conoce; se calcula una sola vez.
 */
export function obtenerHashDeRelleno(): Promise<string> {
  hashDeRelleno ??= hashearContrasena(crypto.randomUUID());
  return hashDeRelleno;
}
