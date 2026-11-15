"use client";

/**
 * Búsqueda de productos de Nueva venta (RF-V3, RF-V4).
 *
 * Busca productos ACTIVOS por código o descripción con GET /api/productos.
 * Se opera con el teclado: escribir, recorrer con las flechas, indicar la
 * cantidad y agregar con Enter. Quien decide si se puede agregar es
 * agregarProducto() (src/lib/borrador-venta.ts), que se recibe por `onAgregar`.
 *
 * Avisos: si no se puede agregar, el motivo queda JUNTO a la búsqueda (es un
 * error del dato ingresado). Si se agrega, se emite un aviso temporal con un
 * id fijo (AVISO_AGREGADO): cada producto nuevo reemplaza al aviso anterior y
 * la pantalla lo descarta al quitar un ítem o descartar la venta.
 */
import { PlusIcon } from "lucide-react";
import { useState, type KeyboardEvent, type Ref } from "react";

import { ErrorCampo } from "@/components/formularios/form-field";
import { SearchInput } from "@/components/formularios/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { avisos } from "@/lib/avisos";
import {
  cantidadMaxima,
  moverIndice,
  productosVendibles,
  urlBusquedaProductos,
  type ProductoVenta,
} from "@/lib/borrador-venta";
import { formatearMoneda } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import type { ProductoPublico } from "@/servicios/productos";

import { MensajeBusqueda } from "./estado-busqueda";
import { useBusqueda } from "./usar-busqueda";

/** Grupo de los avisos de la venta en curso (se limpian al descartarla o emitirla). */
export const GRUPO_AVISOS_VENTA = "venta";
/** Id del aviso «Se agregó…»: nunca hay dos a la vez. */
export const AVISO_AGREGADO = "venta-producto-agregado";

type Props = {
  /** Devuelve null si se agregó, o el mensaje de por qué no. */
  onAgregar: (producto: ProductoVenta, cantidad: string) => string | null;
  busquedaRef: Ref<HTMLInputElement>;
};

export function BuscadorProductos({ onAgregar, busquedaRef }: Props) {
  const [texto, setTexto] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [seleccion, setSeleccion] = useState({ texto: "", indice: 0 });
  const [error, setError] = useState<string | null>(null);
  const { estado, reintentar } = useBusqueda<ProductoPublico, ProductoVenta>(texto, urlBusquedaProductos, productosVendibles);
  const resultados = estado.tipo === "resultados" ? estado.datos : [];
  const indice = seleccion.texto === texto ? Math.min(seleccion.indice, Math.max(0, resultados.length - 1)) : 0;
  const seleccionado = resultados[indice];

  function agregar(producto: ProductoVenta | undefined) {
    if (!producto) {
      setError("Busque y seleccione un producto para agregar.");
      return;
    }
    const motivo = onAgregar(producto, cantidad);
    if (motivo) {
      setError(`${producto.codigo}: ${motivo}`);
      return;
    }
    setError(null);
    avisos.exito(`Se agregó ${cantidad.trim()} × ${producto.descripcion}.`, { id: AVISO_AGREGADO, grupo: GRUPO_AVISOS_VENTA });
    setTexto("");
    setCantidad("1");
  }

  function teclaEnBusqueda(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSeleccion({ texto, indice: moverIndice(indice, e.key === "ArrowDown" ? 1 : -1, resultados.length) });
    } else if (e.key === "Enter") {
      e.preventDefault();
      agregar(seleccionado);
    } else if (e.key === "Escape" && texto !== "") {
      e.preventDefault();
      setTexto("");
    }
  }

  function teclaEnCantidad(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      agregar(seleccionado);
    }
  }

  return (
    // @container: la fila se acomoda al ancho de la columna (a 1024 px es angosta), no al de la ventana.
    <div className="@container flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-2 @sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @sm:col-span-1">
          <Label htmlFor="busqueda-producto" className="leading-snug">
            Buscar producto por código o descripción <kbd className="text-xs font-normal text-muted-foreground">(F2)</kbd>
          </Label>
          <SearchInput
            id="busqueda-producto"
            ref={busquedaRef}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setError(null);
            }}
            onKeyDown={teclaEnBusqueda}
            role="combobox"
            aria-expanded={resultados.length > 0}
            aria-controls="resultados-producto"
            aria-activedescendant={seleccionado ? `producto-${seleccionado.id}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "error-busqueda-producto" : undefined}
            aria-keyshortcuts="F2"
            placeholder="Ej.: HE-001 o martillo"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cantidad-producto">Cantidad</Label>
          <Input
            id="cantidad-producto"
            type="number"
            min={1}
            step={1}
            max={seleccionado ? cantidadMaxima(seleccionado) : undefined}
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={teclaEnCantidad}
            className="tabular-nums"
          />
        </div>
        <Button type="button" variant="secondary" onClick={() => agregar(seleccionado)}>
          <PlusIcon aria-hidden />
          Agregar
        </Button>
      </div>

      {error && <ErrorCampo id="error-busqueda-producto">{error}</ErrorCampo>}

      <MensajeBusqueda
        estado={estado}
        inicial="Escriba para buscar. Flechas para recorrer los resultados y Enter para agregar."
        vacio="No se encontraron productos activos con ese código o descripción."
        onReintentar={reintentar}
      />

      {resultados.length > 0 && (
        <ul id="resultados-producto" role="listbox" aria-label="Productos encontrados" className="max-h-64 overflow-y-auto rounded-lg border bg-card shadow-suave">
          {resultados.map((p, i) => (
            <li
              key={p.id}
              id={`producto-${p.id}`}
              role="option"
              aria-selected={i === indice}
              aria-disabled={p.existencia <= 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSeleccion({ texto, indice: i });
                agregar(p);
              }}
              className={cn(
                "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted sm:grid-cols-[6.5rem_minmax(0,1fr)_auto_auto]",
                i === indice && "bg-accent text-accent-foreground hover:bg-accent",
                p.existencia <= 0 && "text-muted-foreground",
              )}
            >
              <span className="font-mono text-xs leading-5">{p.codigo}</span>
              <span className="min-w-0 break-words">{p.descripcion}</span>
              <span className="col-start-2 tabular-nums sm:col-start-auto sm:text-right">{formatearMoneda(p.precio)}</span>
              <span className="col-start-2 text-xs leading-5 sm:col-start-auto sm:text-right">
                {p.existencia <= 0 ? "Sin existencia" : `Existencia: ${p.existencia}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
