/**
 * Paginador común de los listados: «Anterior», «Página X de Y · N elementos»
 * y «Siguiente». Funciona con enlaces (página en la URL, Server Components)
 * o con una función (listados que se cargan en el cliente).
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

type Props = {
  pagina: number;
  totalPaginas: number;
  total: number;
  /** Nombre de los elementos: ["factura", "facturas"]. */
  unidad: readonly [string, string];
  enlace?: (pagina: number) => string;
  onCambiar?: (pagina: number) => void;
  deshabilitado?: boolean;
  etiqueta?: string;
  textoAnterior?: string;
  textoSiguiente?: string;
};

export function Pagination({
  pagina,
  totalPaginas,
  total,
  unidad,
  enlace,
  onCambiar,
  deshabilitado = false,
  etiqueta = "Paginación",
  textoAnterior = "Anterior",
  textoSiguiente = "Siguiente",
}: Props) {
  const resumen = `${total} ${total === 1 ? unidad[0] : unidad[1]}`;
  const comun = { totalPaginas, deshabilitado, enlace, onCambiar };

  return (
    <nav aria-label={etiqueta} className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Página {pagina} de {totalPaginas} · {resumen}
      </p>
      {totalPaginas > 1 && (
        <div className="flex gap-2">
          <BotonPagina {...comun} destino={pagina - 1} texto={textoAnterior} />
          <BotonPagina {...comun} destino={pagina + 1} texto={textoSiguiente} siguiente />
        </div>
      )}
    </nav>
  );
}

type PropsBoton = Pick<Props, "totalPaginas" | "deshabilitado" | "enlace" | "onCambiar"> & {
  destino: number;
  texto: string;
  siguiente?: boolean;
};

function BotonPagina({ destino, texto, siguiente, totalPaginas, deshabilitado, enlace, onCambiar }: PropsBoton) {
  const habilitado = !deshabilitado && destino >= 1 && destino <= totalPaginas;
  const contenido = (
    <>
      {!siguiente && <ChevronLeftIcon aria-hidden />}
      <span>{texto}</span>
      {siguiente && <ChevronRightIcon aria-hidden />}
    </>
  );
  if (habilitado && enlace) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={enlace(destino)}>{contenido}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant="outline" size="sm" disabled={!habilitado} onClick={habilitado ? () => onCambiar?.(destino) : undefined}>
      {contenido}
    </Button>
  );
}
