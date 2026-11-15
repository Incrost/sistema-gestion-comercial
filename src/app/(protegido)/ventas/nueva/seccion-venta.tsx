/**
 * Tarjeta de cada una de las tres secciones de Nueva venta (comprador, ítems
 * y forma de pago), con su número, título y atajo de teclado.
 */
import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  numero: number;
  titulo: string;
  atajo?: string;
  children: ReactNode;
  className?: string;
};

export function SeccionVenta({ id, numero, titulo, atajo, children, className }: Props) {
  return (
    <Card role="region" aria-labelledby={id} className={cn("min-w-0 shadow-suave", className)}>
      <CardHeader className="border-b">
        <CardTitle>
          <h2 id={id} className="flex items-center gap-2">
            <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {numero}
            </span>
            <span className="sr-only">{numero}. </span>
            {titulo}
          </h2>
        </CardTitle>
        {atajo && (
          <CardAction>
            <Kbd aria-label={`Atajo ${atajo}`}>{atajo}</Kbd>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
