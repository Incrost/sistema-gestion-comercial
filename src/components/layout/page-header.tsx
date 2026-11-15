/**
 * Encabezado común de página: enlace de regreso opcional, título (h1),
 * descripción breve, insignias de estado y acciones principales. En pantallas
 * chicas las acciones pasan debajo del título y ocupan el ancho disponible.
 */
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  titulo: ReactNode;
  descripcion?: ReactNode;
  /** Botones o enlaces de la página (se ocultan al imprimir). */
  acciones?: ReactNode;
  insignias?: ReactNode;
  volver?: { href: string; texto: string };
  className?: string;
};

export function PageHeader({ titulo, descripcion, acciones, insignias, volver, className }: Props) {
  return (
    <header className={cn("flex min-w-0 flex-col gap-3", className)}>
      {volver && (
        <Link
          href={volver.href}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          {volver.texto}
        </Link>
      )}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words sm:text-2xl">{titulo}</h1>
            {insignias}
          </div>
          {descripcion && <div className="text-sm text-muted-foreground">{descripcion}</div>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2 print:hidden">{acciones}</div>}
      </div>
    </header>
  );
}
