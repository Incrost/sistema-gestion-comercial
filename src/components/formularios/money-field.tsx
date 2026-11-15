/**
 * Campo de importe en pesos: el símbolo de la moneda queda fijo a la izquierda
 * y el teclado móvil es numérico con coma decimal. El texto se convierte a
 * centavos fuera de este componente, con pesosACentavos() (regla 10).
 */
import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { COMERCIO } from "@/config/comercio";
import { cn } from "@/lib/utils";

import { FormField, propsCampo } from "./form-field";

type Props = Omit<ComponentProps<"input">, "id" | "onChange" | "value"> & {
  id: string;
  etiqueta: ReactNode;
  valor: string;
  onCambiar: (valor: string) => void;
  error?: string;
  ayuda?: ReactNode;
  className?: string;
};

export function MoneyField({ id, etiqueta, valor, onCambiar, error, ayuda, className, ...props }: Props) {
  return (
    <FormField id={id} etiqueta={etiqueta} error={error} ayuda={ayuda} className={className}>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
          {COMERCIO.simboloMoneda}
        </span>
        <Input
          {...propsCampo(id, error, Boolean(ayuda))}
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          className={cn("pl-7 tabular-nums")}
          {...props}
        />
      </div>
    </FormField>
  );
}
