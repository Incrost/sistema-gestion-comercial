/**
 * Token de sesión firmado (decisión D1: sesión propia en cookie firmada).
 *
 * Es el ÚNICO lugar donde se define el nombre, la duración y las opciones de la
 * cookie, y donde se firma y verifica su contenido. No consulta la base ni usa
 * `next/headers`: por eso lo pueden usar tanto el proxy (src/proxy.ts) como el
 * módulo de sesión (src/lib/sesion.ts) y las pruebas.
 *
 * Formato: JWT firmado con HMAC-SHA256 (HS256) mediante la biblioteca `jose`.
 * Contenido mínimo: `sub` (id del usuario), `iat` (emisión) y `exp`
 * (vencimiento). El nombre, el email, el rol y el estado NO viajan en la
 * cookie: se leen de la base en cada pedido (sección 10.5).
 *
 * La firma impide modificar la cookie (por ejemplo, cambiar el id), pero su
 * contenido no está cifrado: por eso no se guarda en ella nada sensible.
 *
 * Solo servidor.
 */
import "server-only";

import { SignJWT, jwtVerify } from "jose";

/** Nombre de la cookie de sesión. */
export const NOMBRE_COOKIE_SESION = "sesion";

/** Duración de la sesión: 8 horas (una jornada de trabajo), en segundos. */
export const DURACION_SESION_SEGUNDOS = 8 * 60 * 60;

/** Longitud mínima del secreto (32 caracteres ≈ 256 bits si es aleatorio). */
export const LONGITUD_MINIMA_SECRETO = 32;

/**
 * Valor de ejemplo de .env.example. Sirve para levantar el proyecto en local
 * con `cp .env.example .env`, pero se rechaza en producción.
 */
export const SECRETO_DE_EJEMPLO =
  "inseguro-solo-para-desarrollo-cambiar-en-produccion-0000000000";

const ALGORITMO = "HS256";

/** Opciones de la cookie (sección 11.1). `secure` solo en producción (HTTPS). */
export function opcionesCookieSesion(env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true, // el JavaScript del navegador no puede leerla
    sameSite: "lax" as const, // no viaja en pedidos POST desde otros sitios
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACION_SESION_SEGUNDOS,
  };
}

/**
 * Lee y valida SESSION_SECRET. Falla con un mensaje claro si falta, es corto
 * o, en producción, si sigue siendo el valor de ejemplo. Se lee al usarlo (no
 * al importar el módulo) para que `next build` no lo exija.
 */
export function obtenerSecretoSesion(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const secreto = env.SESSION_SECRET?.trim();

  if (!secreto) {
    throw new Error(
      "Configuración de sesión incompleta: falta la variable de entorno SESSION_SECRET. Copie .env.example como .env (desarrollo) o cárguela en Vercel (producción).",
    );
  }
  if (secreto.length < LONGITUD_MINIMA_SECRETO) {
    throw new Error(
      `Configuración de sesión insegura: SESSION_SECRET debe tener al menos ${LONGITUD_MINIMA_SECRETO} caracteres.`,
    );
  }
  if (env.NODE_ENV === "production" && secreto === SECRETO_DE_EJEMPLO) {
    throw new Error(
      "Configuración de sesión insegura: en producción SESSION_SECRET no puede ser el valor de ejemplo de .env.example. Genere uno aleatorio.",
    );
  }

  return new TextEncoder().encode(secreto);
}

/** Datos que contiene una sesión válida. */
export type DatosSesion = { usuarioId: number };

/**
 * Firma una sesión para el usuario indicado.
 * `ahora` (en segundos) solo se usa en las pruebas para fabricar sesiones viejas.
 */
export async function firmarSesion(
  usuarioId: number,
  opciones: { ahora?: number; secreto?: Uint8Array } = {},
): Promise<string> {
  const ahora = opciones.ahora ?? Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITMO })
    .setSubject(String(usuarioId))
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + DURACION_SESION_SEGUNDOS)
    .sign(opciones.secreto ?? obtenerSecretoSesion());
}

/**
 * Verifica firma, algoritmo y vencimiento. Devuelve los datos de la sesión o
 * `null` si el token está ausente, mal formado, manipulado o vencido (no se
 * distingue cuál: para quien llama, en todos los casos la sesión no sirve).
 */
export async function verificarSesion(
  token: string | undefined,
  opciones: { secreto?: Uint8Array } = {},
): Promise<DatosSesion | null> {
  if (!token) return null;
  const secreto = opciones.secreto ?? obtenerSecretoSesion();

  try {
    const { payload } = await jwtVerify(token, secreto, {
      algorithms: [ALGORITMO],
      requiredClaims: ["sub", "iat", "exp"], // sin vencimiento no es válida
    });
    const usuarioId = Number(payload.sub);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) return null;
    return { usuarioId };
  } catch {
    // Firma inválida, token vencido o mal formado. No se registra el token.
    return null;
  }
}
