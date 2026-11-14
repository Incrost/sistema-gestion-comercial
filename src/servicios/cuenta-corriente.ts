/**
 * Cuenta corriente de clientes: ÚNICA fuente del saldo (regla 7, decisión C4,
 * sección 10.2: «el saldo del cliente sale de sus movimientos de cuenta»).
 *
 *   saldo = suma de débitos − suma de créditos   (en centavos)
 *
 * El saldo NO es una columna: se deriva siempre de movimientos_cuenta. Un
 * cliente sin movimientos tiene saldo 0 (por el `coalesce`).
 *
 * Todo lo que necesita el saldo usa lo que exporta este módulo:
 * - `saldoDelCliente`: expresión SQL correlacionada con `clientes.id`, para
 *   el listado (RF-C1), el filtro `conDeuda` y el orden por saldo (RF-C6), el
 *   total adeudado y la ficha (RF-C3);
 * - `obtenerSaldo()`: el saldo de un cliente, para las reglas de la baja y de
 *   quitar la cuenta corriente (RF-C7, 422 SALDO_PENDIENTE) y, más adelante,
 *   para el límite de crédito (regla 7) y el control de pagos (regla 8);
 * - `calcularDisponible()`: límite − saldo, o null sin límite.
 *
 * Próximo bloque (RF-C4, RF-C5): aquí se agregarán el historial con saldo
 * acumulado y la ÚNICA función que graba movimientos de cuenta (débito por
 * venta, crédito por pago o anulación), siempre dentro de la transacción de
 * la operación que los origina. En esta etapa NADA escribe movimientos.
 *
 * Solo servidor.
 */
import "server-only";

import { eq, getTableName, sql } from "drizzle-orm";

import { clientes, movimientosCuenta } from "@/db/schema";
import type { Conexion } from "@/db/transaccion";

/** Columna calificada con su tabla ("tabla"."columna"), escrita a mano. */
function calificada(tabla: string, columna: string) {
  return sql`${sql.identifier(tabla)}.${sql.identifier(columna)}`;
}

/** Importe con signo de un movimiento: + débito, − crédito. */
const importeConSigno = sql`case when ${calificada("mc", movimientosCuenta.tipo.name)} = 'debito' then ${calificada("mc", movimientosCuenta.importe.name)} else -${calificada("mc", movimientosCuenta.importe.name)} end`;

/**
 * Saldo del cliente de la fila actual de `clientes` (débitos − créditos).
 * Usar en consultas cuyo FROM es la tabla `clientes`.
 *
 * Las columnas se califican a mano: en una consulta sobre una sola tabla
 * Drizzle las escribe sin el nombre de la tabla, y dentro de la subconsulta
 * `id` se resolvería como `movimientos_cuenta.id` en lugar de `clientes.id`.
 */
export const saldoDelCliente = sql<number>`coalesce((select sum(${importeConSigno}) from ${movimientosCuenta} as ${sql.identifier("mc")} where ${calificada("mc", movimientosCuenta.clienteId.name)} = ${calificada(getTableName(clientes), clientes.id.name)}), 0)`.mapWith(
  Number,
);

/** Saldo actual de un cliente (0 si no tiene movimientos o no existe). */
export async function obtenerSaldo(conexion: Conexion, clienteId: number): Promise<number> {
  // Misma expresión que el listado y la ficha: una sola fuente del saldo.
  const [fila] = await conexion
    .select({ saldo: saldoDelCliente })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);
  return fila?.saldo ?? 0;
}

/**
 * Crédito disponible: límite − saldo cuando el cliente tiene límite; null
 * cuando no lo tiene (sección 11.5). Puede ser negativo si el límite se bajó
 * por debajo de la deuda.
 */
export function calcularDisponible(limiteCredito: number | null, saldo: number): number | null {
  return limiteCredito === null ? null : limiteCredito - saldo;
}
