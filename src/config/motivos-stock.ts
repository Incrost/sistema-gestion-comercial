/**
 * Motivos permitidos para los movimientos MANUALES de stock (RF-P4, RF-P5;
 * sección 11.4). Es el único lugar donde se definen: los usan los esquemas
 * de validación (servidor) y los formularios (cliente).
 *
 * Para agregar un motivo, sumarlo a la lista que corresponda. No requiere
 * migración: la base guarda el motivo como texto.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */

/** RF-P4: motivos de un ingreso de stock. */
export const MOTIVOS_INGRESO = ["Reposición", "Stock inicial", "Devolución de cliente"] as const;

/** RF-P5: motivos de un egreso de stock (obligatorio). */
export const MOTIVOS_EGRESO = ["Rotura", "Vencimiento", "Ajuste de inventario", "Uso interno"] as const;

/** Motivo con el que se registra el stock inicial de un producto nuevo (RF-P2). */
export const MOTIVO_STOCK_INICIAL = "Stock inicial" satisfies (typeof MOTIVOS_INGRESO)[number];

/**
 * Motivo con el que se registra el movimiento de cada renglón de una factura
 * emitida (RF-V6, regla 2). La factura queda referenciada en el movimiento.
 */
export const MOTIVO_VENTA = "Venta";

/**
 * Motivo con el que se registra el reingreso de cada renglón de una factura
 * anulada (RF-V9, regla 2). La factura queda referenciada en el movimiento;
 * el motivo escrito por el administrador se guarda en la factura.
 */
export const MOTIVO_ANULACION = "Anulación";

/** Tipos de movimiento que se cargan a mano. Venta y anulación salen de las facturas. */
export const TIPOS_MOVIMIENTO_MANUAL = ["ingreso", "egreso"] as const;
export type TipoMovimientoManual = (typeof TIPOS_MOVIMIENTO_MANUAL)[number];

/** Motivos permitidos según el tipo de movimiento manual. */
export const MOTIVOS_POR_TIPO: Record<TipoMovimientoManual, readonly string[]> = {
  ingreso: MOTIVOS_INGRESO,
  egreso: MOTIVOS_EGRESO,
};
