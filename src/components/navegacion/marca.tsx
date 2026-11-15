/** Nombre y logotipo del sistema (panel lateral, menú móvil y login). */
import { StoreIcon } from "lucide-react";
import Link from "next/link";

import { APLICACION } from "@/config/aplicacion";
import { cn } from "@/lib/utils";

export function Marca({ className, compacta = false, enlace = true }: { className?: string; compacta?: boolean; enlace?: boolean }) {
  const contenido = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <StoreIcon aria-hidden className="size-4" />
      </span>
      <span className={cn("text-sm font-semibold tracking-tight", compacta && "sr-only")}>{APLICACION.nombre}</span>
    </>
  );
  const clases = cn("flex items-center gap-2.5", className);
  return enlace ? (
    <Link href="/" className={clases} aria-label={compacta ? `${APLICACION.nombre}: ir al inicio` : undefined}>
      {contenido}
    </Link>
  ) : (
    <span className={clases}>{contenido}</span>
  );
}
