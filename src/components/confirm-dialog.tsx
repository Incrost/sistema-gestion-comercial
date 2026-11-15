"use client";

/**
 * Confirmación de acciones irreversibles (sección 8): anular, desactivar,
 * descartar, egresar stock. Usa AlertDialog de shadcn/ui: atrapa el foco, se
 * cierra con Escape o «Cancelar» y explica qué va a ocurrir.
 *
 * `alConfirmar` puede ser asíncrona: mientras se ejecuta, los botones quedan
 * deshabilitados. Si devuelve `false` (p. ej. un error de validación que se
 * muestra dentro del diálogo), el diálogo queda abierto.
 *
 * Puede usarse con un disparador propio (`disparador`) o controlado desde
 * afuera (`abierto` + `onAbiertoCambia`).
 */
import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  titulo: string;
  descripcion: ReactNode;
  textoConfirmar: string;
  textoEnviando?: string;
  textoCancelar?: string;
  /** Acción destructiva (botón rojo) o neutra. */
  destructivo?: boolean;
  alConfirmar: () => Promise<boolean | void> | boolean | void;
  disparador?: ReactNode;
  abierto?: boolean;
  onAbiertoCambia?: (abierto: boolean) => void;
  /** Contenido extra (p. ej. el campo «motivo»). */
  children?: ReactNode;
  /** Dónde poner el foco al cerrar (por defecto, vuelve al disparador). */
  onFocoAlCerrar?: () => void;
};

export function ConfirmDialog({
  titulo,
  descripcion,
  textoConfirmar,
  textoEnviando = "Procesando…",
  textoCancelar = "Cancelar",
  destructivo = true,
  alConfirmar,
  disparador,
  abierto,
  onAbiertoCambia,
  children,
  onFocoAlCerrar,
}: Props) {
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const estaAbierto = abierto ?? abiertoInterno;

  function cambiar(valor: boolean) {
    if (enviando) return;
    setAbiertoInterno(valor);
    onAbiertoCambia?.(valor);
  }

  async function confirmar() {
    setEnviando(true);
    try {
      const resultado = await alConfirmar();
      if (resultado !== false) {
        setAbiertoInterno(false);
        onAbiertoCambia?.(false);
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AlertDialog open={estaAbierto} onOpenChange={cambiar}>
      {disparador && <AlertDialogTrigger asChild>{disparador}</AlertDialogTrigger>}
      <AlertDialogContent
        className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (onFocoAlCerrar) {
            e.preventDefault();
            onFocoAlCerrar();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-left">{descripcion}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={enviando}>{textoCancelar}</AlertDialogCancel>
          <Button type="button" variant={destructivo ? "destructive" : "default"} disabled={enviando} onClick={() => void confirmar()}>
            {enviando ? textoEnviando : textoConfirmar}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
