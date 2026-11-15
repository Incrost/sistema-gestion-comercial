"use client";

/**
 * Hook común de los formularios (sección 10.6): estado de envío, errores por
 * campo y aviso del resultado.
 *
 * - Los errores de validación (Zod en el cliente o `details` de la API) se
 *   guardan por campo para mostrarlos JUNTO al input correspondiente.
 * - El mensaje general de un error de la API se informa con un aviso de error.
 * - Si la operación sale bien y se indica `exito`, se informa con un aviso de éxito.
 *
 * No decide nada del negocio: solo presenta lo que responde el servidor.
 */
import { useState } from "react";

import { avisos, type OpcionesAviso } from "@/lib/avisos";
import { ErrorDeApi, type ErroresCampo } from "@/lib/cliente-api";

type OpcionesEnvio<T> = {
  /** Texto del aviso de éxito (o null para no avisar). */
  exito?: (resultado: T) => string | null;
  opcionesExito?: (resultado: T) => OpcionesAviso;
  /** Identificador del aviso de error, para no repetirlo si se reintenta. */
  idError?: string;
};

export function useEnvio() {
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<ErroresCampo>({});

  /** Ejecuta la operación; devuelve el resultado, o undefined si falló. */
  async function ejecutar<T>(operacion: () => Promise<T>, opciones: OpcionesEnvio<T> = {}): Promise<T | undefined> {
    setEnviando(true);
    setErrores({});
    try {
      const resultado = await operacion();
      const texto = opciones.exito?.(resultado);
      if (texto) avisos.exito(texto, opciones.opcionesExito?.(resultado));
      return resultado;
    } catch (error) {
      if (error instanceof ErrorDeApi) setErrores(error.campos);
      avisos.error(error instanceof Error ? error.message : "Ocurrió un error inesperado.", { id: opciones.idError });
      return undefined;
    } finally {
      setEnviando(false);
    }
  }

  return { enviando, errores, setErrores, ejecutar };
}
