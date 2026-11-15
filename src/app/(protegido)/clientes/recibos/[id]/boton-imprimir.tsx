"use client";

/** Abre el diálogo de impresión del navegador para el recibo (RF-C5). */
export function BotonImprimir() {
  return (
    <button type="button" onClick={() => window.print()} className="w-fit rounded border px-3 py-1 print:hidden">
      Imprimir recibo
    </button>
  );
}
