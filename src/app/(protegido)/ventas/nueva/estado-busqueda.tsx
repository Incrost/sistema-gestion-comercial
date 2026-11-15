/**
 * Mensaje de los estados de una búsqueda que no muestran resultados:
 * inicial, cargando, sin resultados y error (con reintento).
 */
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
      return <p className="text-xs text-gray-600">{inicial}</p>;
    case "cargando":
      return (
        <p role="status" className="text-xs text-gray-600">
          Buscando…
        </p>
      );
    case "vacio":
      return (
        <p role="status" className="text-xs">
          {vacio}
        </p>
      );
    case "error":
      return (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-700">
          No fue posible realizar la búsqueda: {estado.mensaje}
          <button type="button" onClick={onReintentar} className="rounded border px-2 py-0.5">
            Reintentar
          </button>
        </p>
      );
    case "resultados":
      return null;
  }
}
