/**
 * Transacciones de escritura, todo o nada (sección 10.2), con BEGIN IMMEDIATE y
 * una COLA en el proceso: si dos venden la última unidad, la segunda ve la
 * existencia ya descontada → 409 (regla 1). No anidar: pasar `tx`.
 * Solo servidor.
 */
import "server-only";

import { db, type BaseDeDatos } from "@/db";
import { esBloqueoDeBase } from "@/lib/errores-base";

/** Transacción de Drizzle: se usa igual que `db` (select, insert, update...). */
export type Transaccion = Parameters<Parameters<BaseDeDatos["transaction"]>[0]>[0];

/** Base o transacción: para consultas que pueden correr dentro o fuera de una. */
export type Conexion = BaseDeDatos | Transaccion;

/** Intentos de BEGIN ante un bloqueo de otro proceso. */
const INTENTOS_MAXIMOS = 6;
const ESPERA_BASE_MS = 50;

/** Última transacción encolada en este proceso. */
let cola: Promise<unknown> = Promise.resolve();

/**
 * Ejecuta `trabajo` dentro de una transacción de escritura. Si `trabajo`
 * lanza un error, la transacción se revierte por completo y el error se
 * propaga; si termina bien, se confirma y se devuelve su resultado.
 */
export function enTransaccion<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T> {
  const turno = cola.then(() => ejecutarConReintentos(trabajo));
  // La cola sigue aunque esta transacción falle.
  cola = turno.catch(() => undefined);
  return turno;
}

async function ejecutarConReintentos<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    let comenzo = false;
    try {
      return await db.transaction(async (tx) => {
        comenzo = true;
        return trabajo(tx);
      });
    } catch (error) {
      if (comenzo || intento >= INTENTOS_MAXIMOS || !esBloqueoDeBase(error)) throw error;
      await new Promise((resolver) => setTimeout(resolver, ESPERA_BASE_MS * 2 ** (intento - 1)));
    }
  }
}
