/**
 * Layout de todas las páginas protegidas (todo salvo /login): estructura
 * general del sistema (sección 4) con panel lateral fijo en escritorio, menú
 * lateral en móvil y barra superior con el usuario conectado.
 *
 * Segunda barrera de la sección 10.5: aunque el proxy ya comprobó la firma de
 * la cookie, aquí se vuelve a leer al usuario de la base. Si fue desactivado,
 * se redirige a /login. Cada página llama además a exigirUsuarioDePagina(),
 * porque al navegar entre páginas el layout no siempre se vuelve a ejecutar.
 */
import { Suspense, type ReactNode } from "react";

import { LoadingState } from "@/components/estados/loading-state";
import { AppSidebar } from "@/components/navegacion/app-sidebar";
import { Topbar } from "@/components/navegacion/topbar";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";

export default function LayoutProtegido({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<EstructuraCargando />}>
      <ConSesion>{children}</ConSesion>
    </Suspense>
  );
}

/** Estructura general: el contenido aprovecha todo el ancho que deja el panel. */
function Estructura({ panel, barra, children }: { panel: ReactNode; barra: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-1">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      {panel}
      <div className="flex min-w-0 flex-1 flex-col">
        {barra}
        <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function EstructuraCargando() {
  return (
    <Estructura
      panel={<div aria-hidden className="hidden w-64 shrink-0 bg-sidebar lg:block print:hidden" />}
      barra={<div aria-hidden className="h-14 border-b bg-card print:hidden" />}
    >
      <LoadingState texto="Verificando la sesión…" variante="tarjetas" />
    </Estructura>
  );
}

async function ConSesion({ children }: { children: ReactNode }) {
  const usuario = await exigirUsuarioDePagina();
  return (
    <Estructura
      panel={<AppSidebar rol={usuario.rol} />}
      barra={<Topbar usuario={{ nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }} />}
    >
      {children}
    </Estructura>
  );
}
