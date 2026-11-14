/**
 * Forma común de los listados paginados (sección 11.1):
 *
 *   { "data": [], "page": 1, "pageSize": 20, "total": 137 }
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import type { Paginacion } from "./validacion";

/** Respuesta de un listado paginado. `total` cuenta todas las filas que cumplen el filtro. */
export type ListaPaginada<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

/** Cantidad de filas a saltear para llegar a la página pedida. */
export function desplazamiento({ page, pageSize }: Paginacion): number {
  return (page - 1) * pageSize;
}
