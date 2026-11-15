/**
 * Tabla de movimientos de cuenta corriente (RF-C4): fecha, descripción,
 * débito, crédito y saldo acumulado en cada renglón. La usan la ficha del
 * cliente y la página de cuenta corriente con filtros.
 *
 * Solo muestra: los saldos llegan calculados por el servicio
 * (src/servicios/cuenta-corriente.ts) y los formatos salen de src/lib/formatos.ts.
 */
import Link from "next/link";

import { DataTable, type Columna } from "@/components/datos/data-table";
import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import type { MovimientoCuentaPublico } from "@/servicios/cuenta-corriente";

type Fila = MovimientoCuentaPublico & { clave: string; anterior?: boolean };

const COLUMNAS: Columna<Fila>[] = [
  { id: "fecha", encabezado: "Fecha y hora", principal: true, celda: (m) => (m.anterior ? "—" : formatearFechaHora(m.fecha)) },
  {
    id: "descripcion",
    encabezado: "Descripción",
    className: "whitespace-normal min-w-44",
    celda: (m) =>
      m.anterior ? (
        <span className="italic">Saldo anterior</span>
      ) : m.pagoId !== null ? (
        <Link href={`/clientes/recibos/${m.pagoId}`} className="font-medium text-primary hover:underline">
          {m.descripcion}
        </Link>
      ) : (
        m.descripcion
      ),
  },
  { id: "debito", encabezado: "Débito", alinear: "derecha", celda: (m) => (m.tipo === "debito" && !m.anterior ? formatearMoneda(m.importe) : "") },
  {
    id: "credito",
    encabezado: "Crédito",
    alinear: "derecha",
    celda: (m) => (m.tipo === "credito" && !m.anterior ? <span className="text-success-strong">{formatearMoneda(m.importe)}</span> : ""),
  },
  { id: "saldo", encabezado: "Saldo", alinear: "derecha", celda: (m) => <span className="font-medium">{formatearMoneda(m.saldo)}</span> },
];

export function TablaMovimientos({ movimientos, saldoAnterior }: { movimientos: MovimientoCuentaPublico[]; saldoAnterior?: number }) {
  const filas: Fila[] = movimientos.map((m, i) => ({ ...m, clave: `${m.fecha}-${m.facturaId ?? ""}-${m.pagoId ?? ""}-${i}` }));
  if (saldoAnterior !== undefined) {
    filas.unshift({
      clave: "saldo-anterior",
      anterior: true,
      fecha: "",
      descripcion: "Saldo anterior",
      tipo: "debito",
      importe: 0,
      saldo: saldoAnterior,
      facturaId: null,
      pagoId: null,
    } as Fila);
  }
  return <DataTable etiqueta="Movimientos de cuenta corriente" columnas={COLUMNAS} filas={filas} clave={(m) => m.clave} />;
}
