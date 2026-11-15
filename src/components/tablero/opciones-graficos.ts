/**
 * Datos y opciones de los gráficos del tablero (RF-T2), separados de los
 * componentes para poder probarlos como funciones puras.
 *
 * Los importes llegan SIEMPRE en centavos enteros (regla 10) y se muestran
 * con formatearMoneda(): el gráfico nunca formatea por su cuenta.
 *
 * Módulo compartido: no importa Chart.js (eso lo hace registro-chart.ts).
 */
import type { FormaPago } from "@/db/schema"; // solo el tipo
import { formatearDia, formatearDiaCorto, formatearMoneda } from "@/lib/formatos";
import { ETIQUETAS_FORMA_PAGO } from "@/lib/validacion-facturas";
import type { VentaDiaria, VentaPorForma } from "@/servicios/tablero"; // solo los tipos

/** Colores diferenciables (también en escala de grises) por forma de pago. */
export const COLORES_FORMA_PAGO: Record<FormaPago, string> = {
  contado: "#2563eb", // azul
  tarjeta: "#f59e0b", // ámbar
  cuenta_corriente: "#059669", // verde
};

export const COLOR_VENTAS_DIARIAS = "#2563eb";

/** Valor de Chart.js (número en centavos) → pesos. Tolera valores no enteros de los ejes. */
export function formatearCentavos(valor: number | string | null | undefined): string {
  const numero = Number(valor ?? 0);
  return formatearMoneda(Number.isFinite(numero) ? Math.round(numero) : 0);
}

/** Etiqueta del eje de importes: pesos enteros, sin centavos ("$ 25.000"). */
export function formatearEjeImporte(valor: number | string): string {
  const centavos = Math.round(Number(valor) / 100) * 100;
  return formatearCentavos(centavos).replace(/,00$/, "");
}

/** Indica si no hay ningún importe distinto de cero (también con la lista vacía). */
export function todosEnCero(valores: readonly { importe: number }[]): boolean {
  return valores.every((v) => v.importe === 0);
}

/** Barras de ventas diarias: un rótulo dd/mm por día, sin huecos. */
export function datosVentasDiarias(ventas: readonly VentaDiaria[]) {
  return {
    labels: ventas.map((v) => formatearDiaCorto(v.fecha)),
    datasets: [
      {
        label: "Ventas",
        data: ventas.map((v) => v.importe),
        backgroundColor: COLOR_VENTAS_DIARIAS,
        borderRadius: 3,
        maxBarThickness: 24,
      },
    ],
  };
}

/** Título del tooltip con la fecha completa: "17/10/2026". */
export function tituloDiaVentas(ventas: readonly VentaDiaria[], indice: number): string {
  const venta = ventas[indice];
  return venta ? formatearDia(venta.fecha) : "";
}

/** Dona de formas de pago: etiquetas en español y un color por forma. */
export function datosFormasPago(formas: readonly VentaPorForma[]) {
  return {
    labels: formas.map((f) => ETIQUETAS_FORMA_PAGO[f.forma]),
    datasets: [
      {
        label: "Ventas del mes",
        data: formas.map((f) => f.importe),
        backgroundColor: formas.map((f) => COLORES_FORMA_PAGO[f.forma]),
        borderWidth: 1,
      },
    ],
  };
}

/**
 * Porcentaje de cada forma sobre el total, con un decimal ("57,0 %").
 * Con total 0 devuelve "0,0 %".
 */
export function porcentaje(importe: number, total: number): string {
  const valor = total > 0 ? (importe * 100) / total : 0;
  return `${valor.toFixed(1).replace(".", ",")} %`;
}
