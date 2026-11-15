/**
 * RF-T1 — Tarjetas de indicadores del tablero. Componente de presentación:
 * recibe los datos ya calculados (centavos) y solo los formatea.
 */
import { CalendarDaysIcon, PackageXIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/datos/metric-card";
import { Grilla } from "@/components/layout/primitivas";
import { formatearMoneda } from "@/lib/formatos";
import type { Tablero } from "@/servicios/tablero";

type Props = Pick<Tablero, "hoy" | "mes" | "cuentasCorrientes" | "bajoMinimo">;

const plural = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

const ENLACE = "font-medium text-primary underline-offset-4 hover:underline";

export function Indicadores({ hoy, mes, cuentasCorrientes, bajoMinimo }: Props) {
  return (
    <Grilla columnas="4">
      <MetricCard titulo="Ventas de hoy" valor={formatearMoneda(hoy.importe)} icono={ReceiptTextIcon}>
        <p>{hoy.cantidad === 0 ? "Sin ventas registradas hoy" : plural(hoy.cantidad, "factura emitida", "facturas emitidas")}</p>
      </MetricCard>
      <MetricCard titulo="Ventas del mes" valor={formatearMoneda(mes.importe)} icono={CalendarDaysIcon}>
        <p>{mes.cantidad === 0 ? "Sin ventas en el mes" : plural(mes.cantidad, "factura emitida", "facturas emitidas")}</p>
        <p>Ticket promedio: {formatearMoneda(mes.ticketPromedio)}</p>
      </MetricCard>
      <MetricCard
        titulo="Total adeudado en cuentas corrientes"
        valor={formatearMoneda(cuentasCorrientes.totalAdeudado)}
        icono={WalletIcon}
        tono={cuentasCorrientes.clientesConSaldo > 0 ? "advertencia" : "exito"}
      >
        <Link href="/clientes/saldos" className={ENLACE}>
          {cuentasCorrientes.clientesConSaldo === 0
            ? "Ningún cliente con saldo"
            : plural(cuentasCorrientes.clientesConSaldo, "cliente con saldo", "clientes con saldo")}
        </Link>
      </MetricCard>
      <MetricCard
        titulo="Productos bajo el mínimo"
        valor={String(bajoMinimo.cantidad)}
        icono={PackageXIcon}
        tono={bajoMinimo.cantidad > 0 ? "advertencia" : "exito"}
      >
        <Link href="/productos?bajoMinimo=true" className={ENLACE}>
          {bajoMinimo.cantidad === 0 ? "Existencias al día" : "Ver productos para reponer"}
        </Link>
      </MetricCard>
    </Grilla>
  );
}
