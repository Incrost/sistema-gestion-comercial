"use client";

/**
 * Error recuperable de un bloque del tablero: muestra el mensaje y permite
 * reintentar, volviendo a pedir los datos al servidor (router.refresh()).
 */
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function EstadoError({ titulo, mensaje }: { titulo: string; mensaje: string }) {
  const router = useRouter();
  const [reintentando, iniciar] = useTransition();
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-300 p-4 text-sm">
      <p className="font-semibold text-red-700 dark:text-red-400">{titulo}</p>
      <p>{mensaje}</p>
      <button
        type="button"
        onClick={() => iniciar(() => router.refresh())}
        disabled={reintentando}
        className="rounded border px-3 py-1 disabled:opacity-50"
      >
        {reintentando ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}
