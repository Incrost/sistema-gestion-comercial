"use client";

/**
 * RF-T2 — Ventas diarias de los últimos 30 días (barras).
 * Recibe los 30 días ya completos (los días sin ventas valen 0), en centavos.
 */
import "./registro-chart";

import type { ChartOptions } from "chart.js";
import { Bar } from "react-chartjs-2";

import type { VentaDiaria } from "@/servicios/tablero";

import {
  datosVentasDiarias,
  formatearCentavos,
  formatearEjeImporte,
  tituloDiaVentas,
  todosEnCero,
} from "./opciones-graficos";

export function GraficoVentasDiarias({ ventas }: { ventas: VentaDiaria[] }) {
  if (todosEnCero(ventas)) {
    return <p className="py-10 text-center text-sm opacity-70">No se registraron ventas en los últimos 30 días.</p>;
  }

  const opciones: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => tituloDiaVentas(ventas, items[0]?.dataIndex ?? -1),
          label: (item) => formatearCentavos(item.parsed.y),
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, autoSkipPadding: 8 } },
      y: { beginAtZero: true, ticks: { callback: (valor) => formatearEjeImporte(valor) } },
    },
  };

  return (
    <div className="relative h-64 w-full min-w-0">
      <Bar
        data={datosVentasDiarias(ventas)}
        options={opciones}
        role="img"
        aria-label={`Ventas diarias de los últimos ${ventas.length} días`}
      />
    </div>
  );
}
