/**
 * RF-T1 — Tarjetas de indicadores del tablero. Componente de presentación:
 * recibe los datos ya calculados (centavos) y solo los formatea.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { formatearMoneda } from "@/lib/formatos";
import type { Tablero } from "@/servicios/tablero";

type Props = Pick<Tablero, "hoy" | "mes" | "cuentasCorrientes" | "bajoMinimo">;

function Tarjeta({ titulo, valor, children }: { titulo: string; valor: string; children: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col gap-1 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="text-sm opacity-70">{titulo}</h2>
      <p className="text-2xl font-semibold tabular-nums break-words">{valor}</p>
      <div className="text-sm opacity-80">{children}</div>
    </article>
  );
}

const plural = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

export function Indicadores({ hoy, mes, cuentasCorrientes, bajoMinimo }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tarjeta titulo="Ventas de hoy" valor={formatearMoneda(hoy.importe)}>
        {hoy.cantidad === 0 ? "Sin ventas registradas hoy" : plural(hoy.cantidad, "factura emitida", "facturas emitidas")}
      </Tarjeta>
      <Tarjeta titulo="Ventas del mes" valor={formatearMoneda(mes.importe)}>
        <p>{mes.cantidad === 0 ? "Sin ventas en el mes" : plural(mes.cantidad, "factura emitida", "facturas emitidas")}</p>
        <p>Ticket promedio: {formatearMoneda(mes.ticketPromedio)}</p>
      </Tarjeta>
      <Tarjeta titulo="Total adeudado en cuentas corrientes" valor={formatearMoneda(cuentasCorrientes.totalAdeudado)}>
        <Link href="/clientes/saldos" className="underline">
          {cuentasCorrientes.clientesConSaldo === 0
            ? "Ningún cliente con saldo"
            : plural(cuentasCorrientes.clientesConSaldo, "cliente con saldo", "clientes con saldo")}
        </Link>
      </Tarjeta>
      <Tarjeta titulo="Productos bajo el mínimo" valor={String(bajoMinimo.cantidad)}>
        <Link href="/productos?bajoMinimo=true" className="underline">
          {bajoMinimo.cantidad === 0 ? "Existencias al día" : "Ver productos para reponer"}
        </Link>
      </Tarjeta>
    </div>
  );
}
