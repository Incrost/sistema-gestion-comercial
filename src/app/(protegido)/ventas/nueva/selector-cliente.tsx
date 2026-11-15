"use client";

/**
 * Sección «1. Comprador» de Nueva venta (RF-V2).
 *
 * Por defecto, Consumidor final (no pide datos). Busca clientes ACTIVOS por
 * nombre o documento con GET /api/clientes, permite seleccionarlos con el
 * mouse o con el teclado (flechas y Enter) y quitarlos sin perder los ítems.
 * El alta rápida se abre en una ventana modal (alta-rapida-cliente.tsx).
 */
import { UserPlusIcon, UserRoundIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent, type Ref } from "react";

import { ErrorCampo } from "@/components/formularios/form-field";
import { SearchInput } from "@/components/formularios/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  clientesSeleccionables,
  moverIndice,
  urlBusquedaClientes,
  type ClienteVenta,
} from "@/lib/borrador-venta";
import { formatearDocumento, formatearMoneda } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { NOMBRE_CONSUMIDOR_FINAL } from "@/lib/validacion-facturas";
import type { ClientePublico } from "@/servicios/clientes";

import { MensajeBusqueda } from "./estado-busqueda";
import { SeccionVenta } from "./seccion-venta";
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
    <SeccionVenta id="titulo-comprador" numero={1} titulo="Comprador" atajo="F4">
      {cliente === null ? (
        <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
          <UserRoundIcon aria-hidden className="size-5 text-muted-foreground" />
          <p className="text-sm">
            <strong className="font-semibold">{NOMBRE_CONSUMIDOR_FINAL}</strong>{" "}
            <span className="text-muted-foreground">(no requiere datos)</span>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-accent/60 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-base font-semibold break-words">{cliente.nombre}</p>
            {cliente.cuentaCorriente && <Badge variant="outline">Cta. cte.</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Documento</dt>
            <dd className="text-right tabular-nums">
              {cliente.tipoDoc} {formatearDocumento(cliente.tipoDoc, cliente.nroDoc)}
            </dd>
            <dt className="text-muted-foreground">Saldo</dt>
            <dd className="text-right tabular-nums">{formatearMoneda(cliente.saldo)}</dd>
            <dt className="text-muted-foreground">Cuenta corriente</dt>
            <dd className="text-right">{cliente.cuentaCorriente ? "Habilitada" : "No habilitada"}</dd>
            {cliente.cuentaCorriente && (
              <>
                <dt className="text-muted-foreground">Límite</dt>
                <dd className="text-right tabular-nums">{cliente.limiteCredito === null ? "Sin límite" : formatearMoneda(cliente.limiteCredito)}</dd>
                <dt className="text-muted-foreground">Crédito disponible</dt>
                <dd className="text-right tabular-nums">{cliente.disponible === null ? "Sin límite" : formatearMoneda(cliente.disponible)}</dd>
              </>
            )}
          </dl>
          <Button type="button" variant="outline" size="sm" onClick={onQuitar} className="w-fit">
            <XIcon aria-hidden />
            Quitar cliente (volver a consumidor final)
          </Button>
        </div>
      )}
      {error && <ErrorCampo>{error}</ErrorCampo>}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="busqueda-cliente" className="leading-snug">
          {cliente === null ? "Buscar cliente" : "Cambiar cliente"} por nombre o documento <kbd className="text-xs font-normal text-muted-foreground">(F4)</kbd>
        </Label>
        <SearchInput
          id="busqueda-cliente"
          ref={busquedaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={teclaEnBusqueda}
          role="combobox"
          aria-expanded={resultados.length > 0}
          aria-controls="resultados-cliente"
          aria-activedescendant={resultados[indice] ? `cliente-${resultados[indice].id}` : undefined}
          aria-keyshortcuts="F4"
          placeholder="Ej.: López o 28456123"
        />
        <MensajeBusqueda
          estado={estado}
          inicial="Escriba para buscar entre los clientes activos."
          vacio="No se encontraron clientes activos con ese nombre o documento."
          onReintentar={reintentar}
        />
        {resultados.length > 0 && (
          <ul id="resultados-cliente" role="listbox" aria-label="Clientes encontrados" className="max-h-60 overflow-y-auto rounded-lg border bg-card shadow-suave">
            {resultados.map((c, i) => (
              <li
                key={c.id}
                id={`cliente-${c.id}`}
                role="option"
                aria-selected={i === indice}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c)}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted",
                  i === indice && "bg-accent text-accent-foreground hover:bg-accent",
                )}
              >
                <span className="font-medium">{c.nombre}</span>
                <span className="text-xs text-muted-foreground">
                  {c.tipoDoc} {formatearDocumento(c.tipoDoc, c.nroDoc)} · Saldo {formatearMoneda(c.saldo)}
                  {c.cuentaCorriente ? " · Cta. cte." : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={onAltaRapida} className="w-fit">
        <UserPlusIcon aria-hidden />
        Alta rápida de cliente
      </Button>
    </SeccionVenta>
  );
}
