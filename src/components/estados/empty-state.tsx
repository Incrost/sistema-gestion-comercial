/**
 * Estado vacío común de listados y bloques: ícono, título, explicación breve
 * y, si corresponde, una acción para salir del estado vacío.
 */
import { InboxIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  titulo: string;
  descripcion?: ReactNode;
  accion?: ReactNode;
  icono?: LucideIcon;
  /** Variante compacta para usar dentro de tarjetas. */
  compacto?: boolean;
  className?: string;
};

export function EmptyState({ titulo, descripcion, accion, icono: Icono = InboxIcon, compacto = false, className }: Props) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card text-center",
        compacto ? "px-4 py-6" : "px-6 py-12",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icono aria-hidden className="size-5" />
      </span>
      <p className="text-sm font-medium">{titulo}</p>
      {descripcion && <div className="max-w-md text-sm text-muted-foreground">{descripcion}</div>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}
