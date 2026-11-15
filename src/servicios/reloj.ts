/**
 * Reloj de los servicios (regla 11: trazabilidad con fecha y hora).
 *
 * `ahora()` es la ÚNICA fuente del instante que los servicios graban como
 * fecha de una factura, de su anulación, de un movimiento de stock o de un
 * pago. En la aplicación devuelve siempre la hora real del servidor.
 *
 * `conFechaSimulada()` permite que el script de datos iniciales y las pruebas
 * registren operaciones de días anteriores (sección 8: «50 facturas
 * repartidas en los últimos 30 días»), pasando por los MISMOS servicios y
 * reglas que la aplicación.
 *
 * Seguridad:
 * - No hay ninguna ruta, Server Action ni campo de un esquema de Zod que
 *   reciba una fecha de emisión: el cliente nunca elige la fecha. Este módulo
 *   solo lo importan los servicios, scripts/seed.ts y las pruebas.
 * - La fecha simulada vive en un AsyncLocalStorage: solo la ve el trabajo
 *   que se ejecuta dentro de `conFechaSimulada()`, nunca otro pedido que
 *   corra al mismo tiempo en el servidor.
 * - No se aceptan fechas futuras ni inválidas.
 *
 * `creado_en` NO usa este reloj: siempre registra el momento real de la
 * inserción, de modo que se distingue cuándo se cargó cada dato.
 *
 * Solo servidor.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

const fechaSimulada = new AsyncLocalStorage<number>();

/** Instante actual para grabar en una operación: el real o el simulado. */
export function ahora(): Date {
  const simulada = fechaSimulada.getStore();
  return new Date(simulada ?? Date.now());
}

/**
 * Ejecuta `trabajo` con `ahora()` fijo en `fecha`. Uso interno: datos
 * iniciales y pruebas. Rechaza fechas inválidas o posteriores al momento real.
 */
export function conFechaSimulada<T>(fecha: Date, trabajo: () => Promise<T>): Promise<T> {
  const instante = fecha.getTime();
  if (!Number.isFinite(instante)) {
    throw new RangeError("La fecha simulada no es válida.");
  }
  if (instante > Date.now()) {
    throw new RangeError("La fecha simulada no puede ser posterior al momento actual.");
  }
  return fechaSimulada.run(instante, trabajo);
}
