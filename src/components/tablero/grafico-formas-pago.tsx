"use client";

/**
 * RF-T2 — Ventas del mes por forma de pago (dona).
 * Siempre recibe las tres formas, en centavos. Debajo del gráfico se lista
 * cada forma con su importe y porcentaje (también sirve como texto accesible).
 */
import "./registro-chart";

import type { ChartOptions } from "chart.js";
import { Doughnut } from "react-chartjs-2";

import { formatearMoneda } from "@/lib/formatos";
import { ETIQUETAS_FORMA_PAGO } from "@/lib/validacion-facturas";
import type { VentaPorForma } from "@/servicios/tablero";

import { COLORES_FORMA_PAGO, datosFormasPago, formatearCentavos, porcentaje, todosEnCero } from "./opciones-graficos";

export function GraficoFormasPago({ formas }: { formas: VentaPorForma[] }) {
  const total = formas.reduce((suma, f) => suma + f.importe, 0);

  const opciones: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (item) => ` ${item.label}: ${formatearCentavos(item.parsed)}` } },
    },
  };

  return (
    <div className="flex flex-col gap-4">
      {todosEnCero(formas) ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No se registraron ventas en el mes: todas las formas de pago suman $ 0,00.
        </p>
      ) : (
        <div className="relative mx-auto h-52 w-full max-w-64 min-w-0">
          <Doughnut data={datosFormasPago(formas)} options={opciones} role="img" aria-label="Ventas del mes por forma de pago" />
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {formas.map((f) => (
          <li key={f.forma} className="flex flex-wrap items-center justify-between gap-x-3">
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block size-3 rounded-sm" style={{ backgroundColor: COLORES_FORMA_PAGO[f.forma] }} />
              {ETIQUETAS_FORMA_PAGO[f.forma]}
            </span>
            <span className="text-right tabular-nums">
              {formatearMoneda(f.importe)} <span className="text-muted-foreground">({porcentaje(f.importe, total)})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
