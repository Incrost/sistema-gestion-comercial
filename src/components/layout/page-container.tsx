/**
 * Contenedor común de todas las páginas protegidas: ancho máximo, separación
 * vertical entre bloques y `min-w-0` para que ningún contenido ancho (tablas,
 * gráficos) empuje la página y genere desplazamiento horizontal.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const ANCHO = {
  completo: "max-w-7xl",
  /** Documentos (comprobante, recibo) y formularios de una columna. */
  documento: "max-w-4xl",
};

export function PageContainer({ children, ancho = "completo", className }: { children: ReactNode; ancho?: keyof typeof ANCHO; className?: string }) {
  return <div className={cn("mx-auto flex w-full min-w-0 flex-col gap-6", ANCHO[ancho], className)}>{children}</div>;
}
