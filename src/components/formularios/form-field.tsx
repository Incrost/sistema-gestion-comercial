/**
 * Campo de formulario común (sección 10.6): etiqueta vinculada al control,
 * ayuda opcional y el error JUNTO al campo (nunca en una notificación).
 *
 * El control se pasa como hijo; `propsCampo()` le agrega el id, aria-invalid
 * y aria-describedby para que los lectores de pantalla lean ayuda y error.
 */
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  etiqueta: ReactNode;
  error?: string;
  ayuda?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function idError(id: string) {
  return `${id}-error`;
}

export function idAyuda(id: string) {
  return `${id}-ayuda`;
}

/** Atributos de accesibilidad del control de un FormField. */
export function propsCampo(id: string, error?: string, conAyuda = false) {
  const describe = [error ? idError(id) : null, conAyuda ? idAyuda(id) : null].filter(Boolean).join(" ");
  return { id, "aria-invalid": error ? true : undefined, "aria-describedby": describe || undefined };
}

export function FormField({ id, etiqueta, error, ayuda, children, className }: Props) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="leading-snug">
        {etiqueta}
      </Label>
      {children}
      {ayuda && (
        <p id={idAyuda(id)} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      )}
      {error && <ErrorCampo id={idError(id)}>{error}</ErrorCampo>}
    </div>
  );
}

/** Mensaje de error junto a un campo (también se usa en controles sin FormField). */
export function ErrorCampo({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={cn("flex items-start gap-1 text-xs font-medium text-destructive", className)}>
      <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
