/**
 * Encabezado de los documentos imprimibles (factura y recibo): datos del
 * comercio a la izquierda (src/config/comercio.ts, decisión D5) y tipo,
 * número y fecha del comprobante a la derecha.
 */
import type { ReactNode } from "react";

import { COMERCIO, COMERCIO_CON_DATOS_PROVISORIOS } from "@/config/comercio";
import { formatearDocumento } from "@/lib/formatos";

type Props = {
  /** «Factura», «Recibo». */
  tipo: string;
  numero: string;
  /** Renglones de datos del comprobante (fecha, vendedor, estado…). */
  children?: ReactNode;
};

export function PrintHeader({ tipo, numero, children }: Props) {
  return (
    <header className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:justify-between print:flex-row print:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="text-lg font-semibold">{COMERCIO.nombreComercial}</p>
        <p className="text-sm text-muted-foreground print:text-black">{COMERCIO.razonSocial}</p>
        <p className="text-sm text-muted-foreground print:text-black">CUIT {formatearDocumento("CUIT", COMERCIO.cuit)}</p>
        <p className="text-sm text-muted-foreground print:text-black">{COMERCIO.domicilio}</p>
        {COMERCIO_CON_DATOS_PROVISORIOS && <p className="text-xs text-muted-foreground italic">Datos del comercio provisorios.</p>}
      </div>
      <div className="flex flex-col gap-0.5 text-sm sm:items-end sm:text-right print:items-end print:text-right">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase print:text-black">{tipo}</p>
        <p className="font-mono text-xl font-semibold tabular-nums">{numero}</p>
        {children}
      </div>
    </header>
  );
}
