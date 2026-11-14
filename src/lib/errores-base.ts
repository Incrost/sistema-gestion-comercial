/**
 * Reconocimiento de errores de la base de datos (SQLite local y Turso/libSQL).
 *
 * Los servicios usan `esViolacionDeUnicidad()` (o `traducirUnicidad()`) para
 * convertir el choque con un índice único en un error de negocio preciso:
 * - `usuarios.email`    → 409 EMAIL_DUPLICADO;
 * - `productos.codigo`  → 409 CODIGO_DUPLICADO;
 * - `categorias.nombre` → 409 NOMBRE_DUPLICADO.
 * `esBloqueoDeBase()` reconoce SQLITE_BUSY/SQLITE_LOCKED (otra conexión tiene
 * tomada la escritura); lo usa src/db/transaccion.ts para reintentar el BEGIN.
 * Cualquier otro error de la base NO se reconoce aquí y sigue su camino hasta
 * `normalizarError()`, que lo registra y responde 500 ERROR_INTERNO.
 *
 * Por qué se revisa la cadena de causas: Drizzle envuelve el error del driver
 * («Failed query: ...») y deja el original en `cause`. El error de libSQL
 * (`LibsqlError`) trae:
 * - SQLite local:  code "SQLITE_CONSTRAINT_UNIQUE" (o "SQLITE_CONSTRAINT"),
 *                  message "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: usuarios.email";
 * - Turso (Hrana): code "SQLITE_CONSTRAINT" y un mensaje con el mismo texto
 *                  "UNIQUE constraint failed: usuarios.email".
 * En ambos casos el texto «UNIQUE constraint failed: <tabla>.<columna>» lo
 * genera el propio motor SQLite, por lo que es la señal común más confiable.
 *
 * Solo servidor.
 */
import "server-only";

import { ApiError, type DetalleCampo } from "@/lib/api-error";
import type { CodigoError } from "@/lib/codigos-error";

/** Profundidad máxima de causas a revisar (evita ciclos). */
const PROFUNDIDAD_MAXIMA = 5;

type ErrorConCodigo = { code?: unknown; extendedCode?: unknown; message?: unknown; cause?: unknown };

function esRestriccion(error: ErrorConCodigo): boolean {
  return [error.code, error.extendedCode].some(
    (codigo) => typeof codigo === "string" && codigo.startsWith("SQLITE_CONSTRAINT"),
  );
}

/**
 * Indica si `error` (o alguna de sus causas) es la violación del índice único
 * sobre exactamente las columnas indicadas, p. ej. `"usuarios.email"`.
 * Para índices compuestos: `"clientes.nro_doc_normalizado, clientes.tipo_doc"`.
 */
export function esViolacionDeUnicidad(error: unknown, columnas: string): boolean {
  const esperado = `UNIQUE constraint failed: ${columnas}`;
  let actual: unknown = error;

  for (let i = 0; i < PROFUNDIDAD_MAXIMA && actual && typeof actual === "object"; i++) {
    const candidato = actual as ErrorConCodigo;
    const mensaje = typeof candidato.message === "string" ? candidato.message : "";
    // Se exige el código de restricción Y el texto exacto (sin más columnas a
    // continuación), para no confundir `usuarios.email` con otra columna que
    // empiece igual o con un índice compuesto, ni tomar por duplicado
    // cualquier otro error.
    if (
      esRestriccion(candidato) &&
      new RegExp(`${escaparRegExp(esperado)}(?![\\w.,])`).test(mensaje)
    ) {
      return true;
    }
    actual = candidato.cause;
  }
  return false;
}

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Si `error` es la violación de alguno de los índices únicos de `mapa`, lanza
 * el ApiError correspondiente (409) con el detalle del campo; si no, relanza
 * el error original (seguirá su camino como 500 ERROR_INTERNO).
 *
 *   .catch((e) => traducirUnicidad(e, {
 *     "productos.codigo": { code: "CODIGO_DUPLICADO", campo: "codigo" },
 *   }))
 */
export function traducirUnicidad(
  error: unknown,
  mapa: Record<string, { code: CodigoError; campo: string }>,
): never {
  for (const [columnas, { code, campo }] of Object.entries(mapa)) {
    if (esViolacionDeUnicidad(error, columnas)) {
      const base = ApiError.desdeCodigo(code);
      const details: DetalleCampo[] = [{ campo, mensaje: base.message }];
      throw ApiError.desdeCodigo(code, undefined, details);
    }
  }
  throw error;
}

/**
 * Indica si `error` (o alguna de sus causas) es un bloqueo de la base:
 * SQLITE_BUSY o SQLITE_LOCKED. Ocurre cuando otra conexión (por ejemplo,
 * `db:seed` mientras corre `next dev`) tiene tomada la escritura.
 */
export function esBloqueoDeBase(error: unknown): boolean {
  let actual: unknown = error;
  for (let i = 0; i < PROFUNDIDAD_MAXIMA && actual && typeof actual === "object"; i++) {
    const candidato = actual as ErrorConCodigo;
    const bloqueado = [candidato.code, candidato.extendedCode].some(
      (codigo) =>
        typeof codigo === "string" &&
        (codigo.startsWith("SQLITE_BUSY") || codigo.startsWith("SQLITE_LOCKED")),
    );
    if (bloqueado) return true;
    actual = candidato.cause;
  }
  return false;
}
