/**
 * RF-T3 — Los 5 productos más vendidos del mes (por unidades).
 * Código y descripción son los congelados en la factura (regla 3).
 * En pantallas chicas el código pasa debajo de la descripción.
 */
import { TrophyIcon } from "lucide-react";
import Link from "next/link";

import { ResponsiveTable } from "@/components/datos/responsive-table";
import { EmptyState } from "@/components/estados/empty-state";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatearMoneda } from "@/lib/formatos";
import type { ProductoMasVendido } from "@/servicios/tablero";

export function MasVendidos({ productos }: { productos: ProductoMasVendido[] }) {
  if (productos.length === 0) {
    return <EmptyState compacto icono={TrophyIcon} titulo="Todavía no se vendieron productos este mes." />;
  }
  return (
    <ResponsiveTable etiqueta="Productos más vendidos del mes" className="shadow-none">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col" className="w-10">#</TableHead>
          <TableHead scope="col" className="hidden sm:table-cell">Código</TableHead>
          <TableHead scope="col">Descripción</TableHead>
          <TableHead scope="col" className="text-right">
            <abbr title="Unidades" className="no-underline sm:hidden">Unid.</abbr>
            <span className="hidden sm:inline">Unidades</span>
          </TableHead>
          <TableHead scope="col" className="text-right">Importe</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {productos.map((p, i) => (
          <TableRow key={p.productoId}>
            <TableCell className="font-semibold text-muted-foreground tabular-nums">{i + 1}</TableCell>
            <TableCell className="hidden font-mono text-xs sm:table-cell">{p.codigo}</TableCell>
            <TableCell className="whitespace-normal">
              <Link href={`/productos/${p.productoId}`} className="font-medium hover:text-primary hover:underline">
                {p.descripcion}
              </Link>
              <span className="block font-mono text-xs text-muted-foreground sm:hidden">{p.codigo}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{p.unidades}</TableCell>
            <TableCell className="text-right tabular-nums">{formatearMoneda(p.importe)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </ResponsiveTable>
  );
}
