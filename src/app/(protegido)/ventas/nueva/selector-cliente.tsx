"use client";

/**
 * Sección «1. Comprador» de Nueva venta (RF-V2).
 *
 * Por defecto, Consumidor final (no pide datos). Busca clientes ACTIVOS por
 * nombre o documento con GET /api/clientes, permite seleccionarlos con el
 * mouse o con el teclado (flechas y Enter) y quitarlos sin perder los ítems.
 * El alta rápida se abre en una ventana modal (alta-rapida-cliente.tsx).
 */
import { useState, type KeyboardEvent, type Ref } from "react";

import {
  clientesSeleccionables,
  moverIndice,
  urlBusquedaClientes,
  type ClienteVenta,
} from "@/lib/borrador-venta";
import { formatearDocumento, formatearMoneda } from "@/lib/formatos";
import { NOMBRE_CONSUMIDOR_FINAL } from "@/lib/validacion-facturas";
import type { ClientePublico } from "@/servicios/clientes";

import { MensajeBusqueda } from "./estado-busqueda";
import { useBusqueda } from "./usar-busqueda";

type Props = {
  cliente: ClienteVenta | null;
  onSeleccionar: (cliente: ClienteVenta) => void;
  onQuitar: () => void;
  onAltaRapida: () => void;
  busquedaRef: Ref<HTMLInputElement>;
  error?: string;
};

export function SelectorCliente({ cliente, onSeleccionar, onQuitar, onAltaRapida, busquedaRef, error }: Props) {
  const [texto, setTexto] = useState("");
  const [seleccion, setSeleccion] = useState({ texto: "", indice: 0 });
  const { estado, reintentar } = useBusqueda<ClientePublico, ClienteVenta>(texto, urlBusquedaClientes, clientesSeleccionables);
  const resultados = estado.tipo === "resultados" ? estado.datos : [];
  const indice = seleccion.texto === texto ? Math.min(seleccion.indice, Math.max(0, resultados.length - 1)) : 0;

  function elegir(c: ClienteVenta) {
    onSeleccionar(c);
    setTexto("");
  }

  function teclaEnBusqueda(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSeleccion({ texto, indice: moverIndice(indice, e.key === "ArrowDown" ? 1 : -1, resultados.length) });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (resultados[indice]) elegir(resultados[indice]);
    } else if (e.key === "Escape" && texto !== "") {
      e.preventDefault();
      setTexto("");
    }
  }

  return (
    <section aria-labelledby="titulo-comprador" className="flex flex-col gap-3 rounded border p-4">
      <h2 id="titulo-comprador" className="text-lg font-semibold">
        1. Comprador
      </h2>

      {cliente === null ? (
        <p>
          <strong>{NOMBRE_CONSUMIDOR_FINAL}</strong> <span className="text-sm text-gray-600">(no requiere datos)</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded bg-gray-50 p-3 text-sm">
          <p className="text-base font-semibold">{cliente.nombre}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Documento</dt>
            <dd>
              {cliente.tipoDoc} {formatearDocumento(cliente.tipoDoc, cliente.nroDoc)}
            </dd>
            <dt>Saldo</dt>
            <dd>{formatearMoneda(cliente.saldo)}</dd>
            <dt>Cuenta corriente</dt>
            <dd>{cliente.cuentaCorriente ? "Habilitada" : "No habilitada"}</dd>
            {cliente.cuentaCorriente && (
              <>
                <dt>Límite</dt>
                <dd>{cliente.limiteCredito === null ? "Sin límite" : formatearMoneda(cliente.limiteCredito)}</dd>
                <dt>Crédito disponible</dt>
                <dd>{cliente.disponible === null ? "Sin límite" : formatearMoneda(cliente.disponible)}</dd>
              </>
            )}
          </dl>
          <button type="button" onClick={onQuitar} className="w-fit rounded border bg-white px-3 py-1">
            Quitar cliente (volver a consumidor final)
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="busqueda-cliente">
          {cliente === null ? "Buscar cliente" : "Cambiar cliente"} por nombre o documento <kbd className="text-xs">(F4)</kbd>
        </label>
        <input
          id="busqueda-cliente"
          ref={busquedaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={teclaEnBusqueda}
          autoComplete="off"
          role="combobox"
          aria-expanded={resultados.length > 0}
          aria-controls="resultados-cliente"
          aria-activedescendant={resultados[indice] ? `cliente-${resultados[indice].id}` : undefined}
          placeholder="Ej.: López o 28456123"
          className="rounded border px-2 py-1"
        />
        <MensajeBusqueda
          estado={estado}
          inicial="Escriba para buscar entre los clientes activos."
          vacio="No se encontraron clientes activos con ese nombre o documento."
          onReintentar={reintentar}
        />
        {resultados.length > 0 && (
          <ul id="resultados-cliente" role="listbox" aria-label="Clientes encontrados" className="max-h-60 overflow-y-auto rounded border">
            {resultados.map((c, i) => (
              <li
                key={c.id}
                id={`cliente-${c.id}`}
                role="option"
                aria-selected={i === indice}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c)}
                className={`flex cursor-pointer flex-wrap justify-between gap-2 border-b px-2 py-1 last:border-b-0 ${
                  i === indice ? "bg-blue-100" : ""
                }`}
              >
                <span>{c.nombre}</span>
                <span className="text-gray-600">
                  {c.tipoDoc} {formatearDocumento(c.tipoDoc, c.nroDoc)} · Saldo {formatearMoneda(c.saldo)}
                  {c.cuentaCorriente ? " · Cta. cte." : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" onClick={onAltaRapida} className="w-fit rounded border px-3 py-1 text-sm">
        Alta rápida de cliente
      </button>
    </section>
  );
}
