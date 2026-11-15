"use client";

/**
 * Búsqueda en vivo contra la API REST (sección 10.6: «la búsqueda en vivo y
 * la confirmación de la venta consumen la API REST»).
 *
 * Espera una pausa breve al escribir, cancela el pedido anterior si llega
 * otro y expone los estados visuales: inicial, cargando, vacío, error y
 * resultados. El estado «inicial» y «cargando» se DERIVAN del texto, así no
 * se actualiza el estado de forma sincrónica dentro del efecto.
 */
import { useEffect, useState } from "react";

import { estadoDeResultados, type EstadoBusqueda } from "@/lib/borrador-venta";
import { llamarApi } from "@/lib/cliente-api";
import type { ListaPaginada } from "@/lib/paginacion";

const ESPERA_MS = 250;

type Respuesta<T> = { url: string; estado: EstadoBusqueda<T> };

export function useBusqueda<C, T>(
  texto: string,
  construirUrl: (texto: string) => string | null,
  transformar: (datos: C[]) => T[],
): { estado: EstadoBusqueda<T>; reintentar: () => void } {
  const url = construirUrl(texto);
  const [intento, setIntento] = useState(0);
  const [respuesta, setRespuesta] = useState<Respuesta<T> | null>(null);
  const clave = url === null ? null : `${url}#${intento}`;

  useEffect(() => {
    if (url === null || clave === null) return;
    const control = new AbortController();
    const temporizador = setTimeout(async () => {
      try {
        const lista = await llamarApi<ListaPaginada<C>>(url, { signal: control.signal });
        if (!control.signal.aborted) setRespuesta({ url: clave, estado: estadoDeResultados(transformar(lista.data)) });
      } catch (error) {
        if (!control.signal.aborted) {
          setRespuesta({ url: clave, estado: { tipo: "error", mensaje: (error as Error).message } });
        }
      }
    }, ESPERA_MS);
    return () => {
      clearTimeout(temporizador);
      control.abort();
    };
    // `transformar` es una función pura de módulo: no cambia entre renderizados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  let estado: EstadoBusqueda<T>;
  if (clave === null) estado = { tipo: "inicial" };
  else if (respuesta?.url !== clave) estado = { tipo: "cargando" };
  else estado = respuesta.estado;

  return { estado, reintentar: () => setIntento((n) => n + 1) };
}
