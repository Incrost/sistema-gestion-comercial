/**
 * Transacciones de escritura (sección 10.2: «toda operación que toca más de
 * una tabla se resuelve en una transacción: o se graba todo o nada»).
 *
 * Por qué existe este módulo en lugar de llamar a `db.transaction()` directo
 * (comportamiento verificado con @libsql/client 0.18 y drizzle-orm 0.45):
 *
 * 1. Drizzle llama a `client.transaction()` SIN modo, y libSQL usa "write",
 *    que abre la transacción con `BEGIN IMMEDIATE`: toma el bloqueo de
 *    escritura desde el principio. Si algo falla, Drizzle hace ROLLBACK.
 *
 * 2. Con SQLite local, libSQL tiene un pool de conexiones y cada transacción
 *    toma una conexión propia. Si dos pedidos del MISMO proceso abren a la vez
 *    una transacción de escritura, el segundo `BEGIN IMMEDIATE` falla al
 *    instante con SQLITE_BUSY (el cliente no espera). Configurar un
 *    "busy timeout" no sirve: el driver es sincrónico y la espera bloquearía
 *    el único hilo de Node, impidiendo que la primera transacción confirme.
 *
 *    Solución: una COLA dentro del proceso. Las transacciones de escritura se
 *    ejecutan de a una, en orden de llegada. Así, si dos vendedores venden la
 *    última unidad a la vez (regla 1), la segunda transacción empieza cuando
 *    la primera ya confirmó, ve la existencia actualizada y su
 *    `UPDATE ... WHERE existencia >= ?` no modifica ninguna fila
 *    → 409 STOCK_INSUFICIENTE (y no un 500).
 *
 * 3. Si el bloqueo lo tiene OTRO proceso (p. ej. `pnpm run db:seed` mientras
 *    corre `next dev`), el BEGIN se reintenta unas veces con espera creciente.
 *    Solo se reintenta si la transacción todavía no empezó: nunca se repite
 *    trabajo ya hecho.
 *
 * Con Turso (producción) la transacción es interactiva sobre el protocolo
 * Hrana y el servidor serializa las escrituras; la cola y los reintentos
 * funcionan igual.
 *
 * IMPORTANTE: no llamar a `enTransaccion()` dentro de otra transacción (se
 * esperaría a sí misma). Las funciones que pueden formar parte de una
 * operación mayor reciben la transacción `tx` como parámetro (ver moverStock()).
 *
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
