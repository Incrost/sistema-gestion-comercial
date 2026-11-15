/**
 * Lista de datos «etiqueta: valor» de fichas y comprobantes (cliente, factura,
 * recibo). Se adapta en una o dos columnas y conserva la semántica de <dl>.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const COLUMNAS = { "2": "grid-cols-1 sm:grid-cols-2 print:grid-cols-2", "3": "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" };

export function ListaDatos({ children, columnas = "2", className }: { children: ReactNode; columnas?: keyof typeof COLUMNAS; className?: string }) {
  return <dl className={cn("grid min-w-0 gap-4", COLUMNAS[columnas], className)}>{children}</dl>;
}

export function Dato({ etiqueta, children, ancho = false }: { etiqueta: string; children: ReactNode; ancho?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", ancho && "sm:col-span-full")}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase print:text-black">{etiqueta}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}
