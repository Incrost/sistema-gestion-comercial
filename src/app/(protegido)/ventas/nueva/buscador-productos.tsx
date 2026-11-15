"use client";

/**
 * Búsqueda de productos de Nueva venta (RF-V3, RF-V4).
 *
 * Busca productos ACTIVOS por código o descripción con GET /api/productos.
 * Se opera con el teclado: escribir, recorrer con las flechas, indicar la
 * cantidad y agregar con Enter. Quien decide si se puede agregar es
 * agregarProducto() (src/lib/borrador-venta.ts), que se recibe por `onAgregar`.
 */
import { useState, type KeyboardEvent, type Ref } from "react";

import {
  cantidadMaxima,
  moverIndice,
  productosVendibles,
  urlBusquedaProductos,
  type ProductoVenta,
} from "@/lib/borrador-venta";
import { formatearMoneda } from "@/lib/formatos";
import type { ProductoPublico } from "@/servicios/productos";

import { MensajeBusqueda } from "./estado-busqueda";
import { useBusqueda } from "./usar-busqueda";

type Props = {
  /** Devuelve null si se agregó, o el mensaje de por qué no. */
  onAgregar: (producto: ProductoVenta, cantidad: string) => string | null;
  busquedaRef: Ref<HTMLInputElement>;
};

export function BuscadorProductos({ onAgregar, busquedaRef }: Props) {
  const [texto, setTexto] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [seleccion, setSeleccion] = useState({ texto: "", indice: 0 });
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const { estado, reintentar } = useBusqueda<ProductoPublico, ProductoVenta>(texto, urlBusquedaProductos, productosVendibles);
  const resultados = estado.tipo === "resultados" ? estado.datos : [];
  const indice = seleccion.texto === texto ? Math.min(seleccion.indice, Math.max(0, resultados.length - 1)) : 0;
  const seleccionado = resultados[indice];

  function agregar(producto: ProductoVenta | undefined) {
    if (!producto) {
      setAviso({ tipo: "error", texto: "Busque y seleccione un producto para agregar." });
      return;
    }
    const error = onAgregar(producto, cantidad);
    if (error) {
      setAviso({ tipo: "error", texto: `${producto.codigo}: ${error}` });
      return;
    }
    setAviso({ tipo: "ok", texto: `Se agregó ${cantidad.trim()} × ${producto.descripcion}.` });
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
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <span>
            Buscar producto por código o descripción <kbd className="text-xs">(F2)</kbd>
          </span>
          <input
            ref={busquedaRef}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAviso(null);
            }}
            onKeyDown={teclaEnBusqueda}
            autoComplete="off"
            role="combobox"
            aria-expanded={resultados.length > 0}
            aria-controls="resultados-producto"
            aria-activedescendant={seleccionado ? `producto-${seleccionado.id}` : undefined}
            placeholder="Ej.: HE-001 o martillo"
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex w-24 flex-col gap-1">
          Cantidad
          <input
            type="number"
            min={1}
            step={1}
            max={seleccionado ? cantidadMaxima(seleccionado) : undefined}
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={teclaEnCantidad}
            className="rounded border px-2 py-1"
          />
        </label>
        <button type="button" onClick={() => agregar(seleccionado)} className="rounded border px-3 py-1">
          Agregar
        </button>
      </div>

      <MensajeBusqueda
        estado={estado}
        inicial="Escriba para buscar. Flechas para recorrer los resultados y Enter para agregar."
        vacio="No se encontraron productos activos con ese código o descripción."
        onReintentar={reintentar}
      />

      {resultados.length > 0 && (
        <ul id="resultados-producto" role="listbox" aria-label="Productos encontrados" className="max-h-64 overflow-y-auto rounded border">
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
              className={`grid cursor-pointer grid-cols-[auto_1fr] gap-x-2 border-b px-2 py-1 last:border-b-0 sm:grid-cols-[7rem_1fr_auto_auto] ${
                i === indice ? "bg-blue-100" : ""
              } ${p.existencia <= 0 ? "text-gray-500" : ""}`}
            >
              <span className="font-mono">{p.codigo}</span>
              <span>{p.descripcion}</span>
              <span className="sm:text-right">{formatearMoneda(p.precio)}</span>
              <span className="sm:text-right">{p.existencia <= 0 ? "Sin existencia" : `Existencia: ${p.existencia}`}</span>
            </li>
          ))}
        </ul>
      )}

      {aviso && (
        <p role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
