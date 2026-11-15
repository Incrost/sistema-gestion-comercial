/**
 * RF-T3 — Los 5 productos más vendidos del mes (por unidades).
 * Código y descripción son los congelados en la factura (regla 3).
 */
import Link from "next/link";

import { formatearMoneda } from "@/lib/formatos";
import type { ProductoMasVendido } from "@/servicios/tablero";

export function MasVendidos({ productos }: { productos: ProductoMasVendido[] }) {
  if (productos.length === 0) {
    return <p className="text-sm opacity-70">Todavía no se vendieron productos este mes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-300 dark:border-neutral-700">
            <th scope="col" className="py-2 pr-2">#</th>
            <th scope="col" className="hidden py-2 pr-2 sm:table-cell">Código</th>
            <th scope="col" className="py-2 pr-2">Descripción</th>
            <th scope="col" className="py-2 pr-2 text-right"><abbr title="Unidades" className="no-underline sm:hidden">Unid.</abbr><span className="hidden sm:inline">Unidades</span></th>
            <th scope="col" className="py-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p, i) => (
            <tr key={p.productoId} className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-2 tabular-nums">{i + 1}</td>
              <td className="hidden py-2 pr-2 font-mono whitespace-nowrap sm:table-cell">{p.codigo}</td>
              <td className="py-2 pr-2">
                <Link href={`/productos/${p.productoId}`} className="underline">
                  {p.descripcion}
                </Link>
                <span className="block font-mono text-xs opacity-70 sm:hidden">{p.codigo}</span>
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{p.unidades}</td>
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{formatearMoneda(p.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
