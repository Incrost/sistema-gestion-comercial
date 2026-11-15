"use client";

/**
 * Estado de error común: explica qué falló y permite reintentar volviendo a
 * pedir los datos al servidor (router.refresh()) o ejecutando `onReintentar`.
 * Nunca muestra detalles internos: el mensaje llega ya normalizado.
 */
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  titulo: string;
  mensaje: string;
  onReintentar?: () => void;
  volver?: { href: string; texto: string };
  className?: string;
};

export function ErrorState({ titulo, mensaje, onReintentar, volver, className }: Props) {
  const router = useRouter();
  const [reintentando, iniciar] = useTransition();
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4", className)}>
      <div className="flex items-start gap-3">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-destructive">{titulo}</p>
          <p className="text-sm text-foreground">{mensaje}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-8">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reintentando}
          onClick={() => (onReintentar ? onReintentar() : iniciar(() => router.refresh()))}
        >
          <RefreshCwIcon aria-hidden className={cn(reintentando && "animate-spin")} />
          {reintentando ? "Reintentando…" : "Reintentar"}
        </Button>
        {volver && (
          <Button asChild variant="ghost" size="sm">
            <Link href={volver.href}>{volver.texto}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
