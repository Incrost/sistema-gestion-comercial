"use client";

/** Abre el diálogo de impresión del navegador (RF-V7, RF-C5). Se oculta al imprimir. */
import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BotonImprimir({ texto = "Imprimir" }: { texto?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      <PrinterIcon aria-hidden />
      {texto}
    </Button>
  );
}
