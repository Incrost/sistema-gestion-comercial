/**
 * Barra de filtros de los listados: un formulario GET (next/form) que escribe
 * los filtros en la URL (sección 10.6), así el listado se puede recargar y
 * compartir. Los campos se acomodan en grilla y pasan a una columna en móvil.
 */
import { FilterXIcon, SearchIcon } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  /** Ruta del listado (destino del formulario GET). */
  action: string;
  children: ReactNode;
  /** Muestra «Limpiar» cuando hay algún filtro aplicado. */
  hayFiltros?: boolean;
  textoEnviar?: string;
  etiqueta?: string;
  className?: string;
};

export function FilterBar({ action, children, hayFiltros = false, textoEnviar = "Filtrar", etiqueta = "Filtros", className }: Props) {
  return (
    <Form
      action={action}
      aria-label={etiqueta}
      className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-suave print:hidden", className)}
    >
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">
          <SearchIcon aria-hidden />
          {textoEnviar}
        </Button>
        {hayFiltros && (
          <Button asChild variant="ghost" size="sm">
            <Link href={action}>
              <FilterXIcon aria-hidden />
              Limpiar filtros
            </Link>
          </Button>
        )}
      </div>
    </Form>
  );
}
