/**
 * Tarjeta de indicador: título, valor destacado y detalle. El tono (con su
 * ícono) señala si el dato requiere atención, sin depender solo del color.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONOS = {
  normal: "bg-accent text-accent-foreground",
  exito: "bg-success-soft text-success-strong",
  advertencia: "bg-warning-soft text-warning-strong",
  destructivo: "bg-destructive/10 text-destructive",
};

type Props = {
  titulo: string;
  valor: string;
  icono?: LucideIcon;
  tono?: keyof typeof TONOS;
  children?: ReactNode;
  className?: string;
};

export function MetricCard({ titulo, valor, icono: Icono, tono = "normal", children, className }: Props) {
  return (
    <Card className={cn("min-w-0 gap-2 px-4 shadow-suave", className)}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{titulo}</h2>
        {Icono && (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", TONOS[tono])}>
            <Icono aria-hidden className="size-4" />
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums break-words">{valor}</p>
      {children && <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">{children}</div>}
    </Card>
  );
}
