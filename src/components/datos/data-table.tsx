/**
 * Tabla de datos común, adaptable:
 * - desde 768 px, una tabla con encabezados (ResponsiveTable);
 * - en pantallas chicas, cada fila se transforma en una tarjeta con los datos
 *   esenciales y sus acciones, sin desplazamiento horizontal.
 * Con `movil="desplazamiento"` se conserva la tabla y se desplaza dentro de
 * su marco (útil para tablas cortas o comprobantes).
 *
 * Se usa desde Server Components o Client Components; las columnas son
 * funciones que solo presentan datos ya calculados.
 */
import type { ReactNode } from "react";

import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ResponsiveTable } from "./responsive-table";

export type Columna<T> = {
  id: string;
  encabezado: ReactNode;
  celda: (fila: T) => ReactNode;
  alinear?: "izquierda" | "derecha";
  /** Columna que encabeza la tarjeta en móvil (normalmente el nombre o número). */
  principal?: boolean;
  /** No se muestra en la tarjeta móvil (dato secundario). */
  ocultarEnMovil?: boolean;
  /** Clases extra de la celda (p. ej. permitir varias líneas). */
  className?: string;
};

type Props<T> = {
  etiqueta: string;
  columnas: readonly Columna<T>[];
  filas: readonly T[];
  clave: (fila: T) => string | number;
  /** Se muestra en lugar de la tabla cuando no hay filas. */
  vacio?: ReactNode;
  acciones?: (fila: T) => ReactNode;
  /** Fila de totales al pie (desde 768 px) y bloque de totales en móvil. */
  pie?: { etiqueta: ReactNode; valor: ReactNode };
  movil?: "tarjetas" | "desplazamiento";
  /** Resalta la fila (p. ej. una factura anulada). */
  claseFila?: (fila: T) => string | undefined;
  anchoMinimo?: string;
};

const ALINEACION = { izquierda: "text-left", derecha: "text-right" };

export function DataTable<T>({
  etiqueta,
  columnas,
  filas,
  clave,
  vacio,
  acciones,
  pie,
  movil = "tarjetas",
  claseFila,
  anchoMinimo,
}: Props<T>) {
  if (filas.length === 0 && vacio) return <>{vacio}</>;

  const tabla = (
    <ResponsiveTable etiqueta={etiqueta} anchoMinimo={anchoMinimo}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columnas.map((c) => (
            <TableHead key={c.id} scope="col" className={ALINEACION[c.alinear ?? "izquierda"]}>
              {c.encabezado}
            </TableHead>
          ))}
          {acciones && (
            <TableHead scope="col" className="text-right">
              <span className="sr-only">Acciones</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((fila) => (
          <TableRow key={clave(fila)} className={claseFila?.(fila)}>
            {columnas.map((c) => (
              <TableCell key={c.id} className={cn(ALINEACION[c.alinear ?? "izquierda"], c.alinear === "derecha" && "tabular-nums", c.className)}>
                {c.celda(fila)}
              </TableCell>
            ))}
            {acciones && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1 print:hidden">{acciones(fila)}</div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
      {pie && (
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columnas.length - 1} className="text-right font-semibold">
              {pie.etiqueta}
            </TableCell>
            <TableCell className="text-right text-base font-semibold tabular-nums">{pie.valor}</TableCell>
            {acciones && <TableCell />}
          </TableRow>
        </TableFooter>
      )}
    </ResponsiveTable>
  );

  if (movil === "desplazamiento") return tabla;

  const principales = columnas.filter((c) => c.principal);
  const resto = columnas.filter((c) => !c.principal && !c.ocultarEnMovil);

  return (
    <>
      <div className="hidden md:block print:block">{tabla}</div>
      <ul aria-label={etiqueta} className="flex flex-col gap-3 md:hidden print:hidden">
        {filas.map((fila) => (
          <li key={clave(fila)} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 shadow-suave", claseFila?.(fila))}>
            {principales.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1 text-sm font-medium break-words">
                {principales.map((c) => (
                  <div key={c.id}>{c.celda(fila)}</div>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              {resto.map((c) => (
                <div key={c.id} className="contents">
                  <dt className="text-muted-foreground">{c.encabezado}</dt>
                  <dd className="min-w-0 text-right break-words tabular-nums">{c.celda(fila)}</dd>
                </div>
              ))}
            </dl>
            {acciones && <div className="flex flex-wrap justify-end gap-2 border-t pt-3">{acciones(fila)}</div>}
          </li>
        ))}
        {pie && (
          <li className="flex items-center justify-between gap-3 rounded-lg border bg-muted/60 p-4 text-sm font-semibold">
            <span>{pie.etiqueta}</span>
            <span className="tabular-nums">{pie.valor}</span>
          </li>
        )}
      </ul>
    </>
  );
}
