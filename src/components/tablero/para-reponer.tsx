/**
 * Bloque «Para reponer» del tablero: productos activos bajo el mínimo.
 * Los datos vienen de listarProductos() con el filtro `bajoMinimo` (la regla
 * existencia < stockMinimo vive solo en src/servicios/productos.ts).
 */
import { PackageCheckIcon } from "lucide-react";
import Link from "next/link";

import { ResponsiveTable } from "@/components/datos/responsive-table";
import { EmptyState } from "@/components/estados/empty-state";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProductoPublico } from "@/servicios/productos";

export function ParaReponer({ productos, total }: { productos: ProductoPublico[]; total: number }) {
  if (productos.length === 0) {
    return <EmptyState compacto icono={PackageCheckIcon} titulo="No hay productos activos bajo el stock mínimo." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <ResponsiveTable etiqueta="Productos para reponer" className="shadow-none">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="hidden sm:table-cell">Código</TableHead>
            <TableHead scope="col">Descripción</TableHead>
            <TableHead scope="col" className="text-right">
              <abbr title="Existencia" className="no-underline sm:hidden">Exist.</abbr>
              <span className="hidden sm:inline">Existencia</span>
            </TableHead>
            <TableHead scope="col" className="text-right">
              <abbr title="Mínimo" className="no-underline sm:hidden">Mín.</abbr>
              <span className="hidden sm:inline">Mínimo</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {productos.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="hidden font-mono text-xs sm:table-cell">{p.codigo}</TableCell>
              <TableCell className="whitespace-normal">
                <Link href={`/productos/${p.id}`} className="font-medium hover:text-primary hover:underline">
                  {p.descripcion}
                </Link>
                <span className="block font-mono text-xs text-muted-foreground sm:hidden">{p.codigo}</span>
              </TableCell>
              <TableCell className="text-right font-semibold text-warning-strong tabular-nums">
                <span>{p.existencia}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.stockMinimo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ResponsiveTable>
      {total > productos.length && (
        <Button asChild variant="link" className="h-auto w-fit p-0">
          <Link href="/productos?bajoMinimo=true">Ver los {total} productos bajo el mínimo</Link>
        </Button>
      )}
    </div>
  );
}
