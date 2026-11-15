/**
 * Estados de carga comunes (fallback de Suspense): esqueletos con la misma
 * forma que el contenido, para que la página no «salte» al llegar los datos.
 * Anuncian la carga a los lectores de pantalla con role="status".
 */
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Variante = "tabla" | "tarjetas" | "ficha" | "bloque" | "formulario";

export function LoadingState({ texto = "Cargando…", variante = "tabla", filas = 5, className }: { texto?: string; variante?: Variante; filas?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("flex w-full min-w-0 flex-col gap-4", className)}>
      <span className="sr-only">{texto}</span>
      {(variante === "tabla" || variante === "ficha") && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      )}
      {(variante === "tarjetas" || variante === "ficha") && (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      {variante === "tabla" && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: filas }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {variante === "ficha" && <Skeleton className="h-64 w-full" />}
      {variante === "bloque" && <Skeleton className="h-24 w-full" />}
      {variante === "formulario" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
    </div>
  );
}
