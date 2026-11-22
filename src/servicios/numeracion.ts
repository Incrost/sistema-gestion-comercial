/**
 * Numeración correlativa sin huecos (regla 4, decisión D3): ÚNICO lugar que asigna
 * números de factura y de recibo, con un UPDATE atómico de `secuencias` DENTRO de
 * la transacción del comprobante (si falla, el número no se consume).
 * Solo servidor.
 */
import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { secuencias, type ClaveSecuencia } from "@/db/schema";
import type { Conexion, Transaccion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";

/** Mayor número representable con 8 dígitos (0001-99999999). */
export const NUMERO_MAXIMO = 99_999_999;

export type Talonario = { clave: ClaveSecuencia; puntoVenta: number };

/**
 * Regla 4: asigna el próximo número del talonario DENTRO de la transacción
 * `tx` del comprobante y lo devuelve. Crea la fila de la secuencia la primera
 * vez (empezando en 1).
 */
export async function asignarNumero(tx: Transaccion, { clave, puntoVenta }: Talonario): Promise<number> {
  // Primera vez para este talonario: crea la fila en 0 (si ya existe, no hace nada).
  await tx
    .insert(secuencias)
    .values({ clave, puntoVenta, ultimoNumero: 0 })
    .onConflictDoNothing({ target: [secuencias.clave, secuencias.puntoVenta] });

  // Incremento atómico: lee y escribe en una sola sentencia.
  const [fila] = await tx
    .update(secuencias)
    .set({ ultimoNumero: sql`${secuencias.ultimoNumero} + 1`, actualizadoEn: new Date() })
    .where(
      and(
        eq(secuencias.clave, clave),
        eq(secuencias.puntoVenta, puntoVenta),
        lt(secuencias.ultimoNumero, NUMERO_MAXIMO),
      ),
    )
    .returning({ numero: secuencias.ultimoNumero });

  if (!fila) {
    // Talonario agotado: se informa como error interno (no es un error del usuario).
    throw new ApiError(500, "ERROR_INTERNO", `La numeración de ${clave} está agotada.`);
  }
  return fila.numero;
}

/**
 * Próximo número que se ASIGNARÍA (último + 1). Solo informativo (p. ej.
 * GET /api/facturas/proximo-numero): el número real se asigna al confirmar.
 */
export async function consultarProximoNumero(conexion: Conexion, { clave, puntoVenta }: Talonario): Promise<number> {
  const [fila] = await conexion
    .select({ ultimo: secuencias.ultimoNumero })
    .from(secuencias)
    .where(and(eq(secuencias.clave, clave), eq(secuencias.puntoVenta, puntoVenta)))
    .limit(1);
  return (fila?.ultimo ?? 0) + 1;
}
