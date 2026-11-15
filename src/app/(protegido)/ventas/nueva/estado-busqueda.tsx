/**
 * Mensaje de los estados de una búsqueda que no muestran resultados:
 * inicial, cargando, sin resultados y error (con reintento).
 */
import { LoaderCircleIcon, RefreshCwIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EstadoBusqueda } from "@/lib/borrador-venta";

type Props<T> = {
  estado: EstadoBusqueda<T>;
  inicial: string;
  vacio: string;
  onReintentar: () => void;
};

export function MensajeBusqueda<T>({ estado, inicial, vacio, onReintentar }: Props<T>) {
  switch (estado.tipo) {
    case "inicial":
      return <p className="text-xs text-muted-foreground">{inicial}</p>;
    case "cargando":
      return (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
          Buscando…
        </p>
      );
    case "vacio":
      return (
        <p role="status" className="flex items-center gap-1.5 text-xs text-foreground">
          <SearchXIcon aria-hidden className="size-3.5 text-muted-foreground" />
          {vacio}
        </p>
      );
    case "error":
      return (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <TriangleAlertIcon aria-hidden className="size-3.5" />
          <span>No fue posible realizar la búsqueda: {estado.mensaje}</span>
          <Button type="button" variant="outline" size="xs" onClick={onReintentar}>
            <RefreshCwIcon aria-hidden />
            Reintentar
          </Button>
        </div>
      );
    case "resultados":
      return null;
  }
}
