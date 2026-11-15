/**
 * Estados de carga del tablero (fallback de Suspense): esqueletos con la
 * misma grilla que el contenido, para que la página no «salte» al llegar.
 */
const bloque = "animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800";

export function CargandoTablero() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <p className="text-sm opacity-70">Cargando indicadores…</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${bloque} h-28`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${bloque} h-72 lg:col-span-2`} />
        <div className={`${bloque} h-72`} />
      </div>
    </div>
  );
}

export function CargandoBloque({ texto }: { texto: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <p className="text-sm opacity-70">{texto}</p>
      <div className={`${bloque} h-24`} />
    </div>
  );
}
