/**
 * Tabla de movimientos de cuenta corriente (RF-C4): fecha, descripción,
 * débito, crédito y saldo acumulado en cada renglón. La usan la ficha del
 * cliente y la página de cuenta corriente con filtros.
 *
 * Solo muestra: los saldos llegan calculados por el servicio
 * (src/servicios/cuenta-corriente.ts) y los formatos salen de src/lib/formatos.ts.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo.
 */
import Link from "next/link";

import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import type { MovimientoCuentaPublico } from "@/servicios/cuenta-corriente";

export function TablaMovimientos({
  movimientos,
  saldoAnterior,
}: {
  movimientos: MovimientoCuentaPublico[];
  saldoAnterior?: number;
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b">
          <th className="py-2 pr-3">Fecha y hora</th>
          <th className="py-2 pr-3">Descripción</th>
          <th className="py-2 pr-3 text-right">Débito</th>
          <th className="py-2 pr-3 text-right">Crédito</th>
          <th className="py-2 pr-3 text-right">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {saldoAnterior !== undefined && (
          <tr className="border-b italic">
            <td className="py-2 pr-3" colSpan={4}>
              Saldo anterior
            </td>
            <td className="py-2 pr-3 text-right">{formatearMoneda(saldoAnterior)}</td>
          </tr>
        )}
        {movimientos.map((m, i) => (
          <tr key={`${m.fecha}-${m.facturaId ?? ""}-${m.pagoId ?? ""}-${i}`} className="border-b">
            <td className="py-2 pr-3">{formatearFechaHora(m.fecha)}</td>
            <td className="py-2 pr-3">
              {m.pagoId !== null ? (
                <Link href={`/clientes/recibos/${m.pagoId}`} className="underline">
                  {m.descripcion}
                </Link>
              ) : (
                m.descripcion
              )}
            </td>
            <td className="py-2 pr-3 text-right">{m.tipo === "debito" ? formatearMoneda(m.importe) : ""}</td>
            <td className="py-2 pr-3 text-right">{m.tipo === "credito" ? formatearMoneda(m.importe) : ""}</td>
            <td className="py-2 pr-3 text-right">{formatearMoneda(m.saldo)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
