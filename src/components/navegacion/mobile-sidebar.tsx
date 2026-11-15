"use client";

/**
 * Menú lateral móvil (debajo de 1024 px). Se abre con el botón de la barra
 * superior y se cierra al elegir una ruta, al pulsar Escape, al tocar fuera o
 * al agrandar la ventana (siguienteEstadoMenu, src/lib/navegacion.ts).
 * Sheet de shadcn/ui (Radix Dialog) atrapa el foco mientras está abierto y lo
 * devuelve al botón al cerrarse.
 */
import { MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Rol } from "@/db/schema";
import { siguienteEstadoMenu, type EventoMenu } from "@/lib/navegacion";

import { ListaNavegacion } from "./lista-navegacion";
import { Marca } from "./marca";

/** Ancho desde el que se muestra el panel lateral fijo (lg de Tailwind). */
const CONSULTA_ESCRITORIO = "(min-width: 1024px)";

export function MobileSidebar({ rol }: { rol: Rol }) {
  const [abierto, setAbierto] = useState(false);
  const despachar = (evento: EventoMenu) => setAbierto((actual) => siguienteEstadoMenu(actual, evento));

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_ESCRITORIO);
    const alCambiar = (e: MediaQueryListEvent) => {
      if (e.matches) setAbierto((actual) => siguienteEstadoMenu(actual, "pantalla-ancha"));
    };
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, []);

  return (
    <Sheet open={abierto} onOpenChange={(valor) => despachar(valor ? "abrir" : "cerrar")}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú de navegación">
          <MenuIcon aria-hidden className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        onEscapeKeyDown={() => despachar("escape")}
        onPointerDownOutside={() => despachar("fuera")}
        className="gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-72 data-[side=left]:max-w-[85vw] data-[side=left]:sm:max-w-72 [&>button]:text-sidebar-foreground [&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-foreground"
      >
        <SheetHeader className="h-14 justify-center border-b border-sidebar-border px-5 py-0">
          <SheetTitle className="text-sidebar-foreground">
            <Marca enlace={false} />
          </SheetTitle>
          <SheetDescription className="sr-only">Menú de navegación del sistema</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <ListaNavegacion rol={rol} onNavegar={() => despachar("navegar")} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
