/**
 * Marco común de las tablas: borde, fondo y desplazamiento horizontal
 * CONTENIDO dentro de la tabla (la página nunca se desborda). La tabla de
 * shadcn/ui ya trae su contenedor con `overflow-x-auto`.
 */
import type { ReactNode } from "react";

import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  /** Nombre accesible de la tabla (se lee como título). */
  etiqueta: string;
  className?: string;
  /** Ancho mínimo de la tabla: debajo de él, se desplaza dentro del marco. */
  anchoMinimo?: string;
};

export function ResponsiveTable({ children, etiqueta, className, anchoMinimo }: Props) {
  return (
    <div className={cn("w-full min-w-0 overflow-hidden rounded-lg border bg-card shadow-suave print:shadow-none", className)}>
      <Table aria-label={etiqueta} className={cn("[&_td]:px-3 [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:text-xs [&_th]:text-muted-foreground [&_th]:uppercase [&_th]:tracking-wide", anchoMinimo)}>
        {children}
      </Table>
    </div>
  );
}
