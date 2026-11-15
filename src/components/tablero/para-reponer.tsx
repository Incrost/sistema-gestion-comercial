/**
 * Bloque «Para reponer» del tablero: productos activos bajo el mínimo.
 * Los datos vienen de listarProductos() con el filtro `bajoMinimo` (la regla
 * existencia < stockMinimo vive solo en src/servicios/productos.ts).
 */
import Link from "next/link";

import type { ProductoPublico } from "@/servicios/productos";

export function ParaReponer({ productos, total }: { productos: ProductoPublico[]; total: number }) {
  if (productos.length === 0) {
    return <p className="text-sm opacity-70">No hay productos activos bajo el stock mínimo.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              <th scope="col" className="hidden py-2 pr-2 sm:table-cell">Código</th>
              <th scope="col" className="py-2 pr-2">Descripción</th>
              <th scope="col" className="py-2 pr-2 text-right"><abbr title="Existencia" className="no-underline sm:hidden">Exist.</abbr><span className="hidden sm:inline">Existencia</span></th>
              <th scope="col" className="py-2 text-right"><abbr title="Mínimo" className="no-underline sm:hidden">Mín.</abbr><span className="hidden sm:inline">Mínimo</span></th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id} className="border-b border-neutral-200 dark:border-neutral-800">
                <td className="hidden py-2 pr-2 font-mono whitespace-nowrap sm:table-cell">{p.codigo}</td>
                <td className="py-2 pr-2">
                  <Link href={`/productos/${p.id}`} className="underline">
                    {p.descripcion}
                  </Link>
                  <span className="block font-mono text-xs opacity-70 sm:hidden">{p.codigo}</span>
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-red-700 dark:text-red-400">{p.existencia}</td>
                <td className="py-2 text-right tabular-nums">{p.stockMinimo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > productos.length && (
        <Link href="/productos?bajoMinimo=true" className="text-sm underline">
          Ver los {total} productos bajo el mínimo
        </Link>
      )}
    </div>
  );
}
