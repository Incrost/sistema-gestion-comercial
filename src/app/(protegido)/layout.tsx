/**
 * Layout de todas las páginas protegidas (todo salvo /login).
 *
 * Segunda barrera de la sección 10.5: aunque el proxy ya comprobó la firma de
 * la cookie, aquí se vuelve a leer al usuario de la base. Si fue desactivado,
 * se redirige a /login. Cada página llama además a exigirUsuarioDePagina(),
 * porque al navegar entre páginas el layout no siempre se vuelve a ejecutar.
 *
 * PROVISORIO: barra mínima para probar el flujo. El panel lateral y la barra
 * definitivos (sección 4) se construyen en una etapa posterior.
 */
import { Suspense, type ReactNode } from "react";

import { BotonCerrarSesion } from "@/components/auth/boton-cerrar-sesion";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";

export default function LayoutProtegido({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Verificando la sesión…</p>}>
      <ConSesion>{children}</ConSesion>
    </Suspense>
  );
}

async function ConSesion({ children }: { children: ReactNode }) {
  const usuario = await exigirUsuarioDePagina();
  return (
    <>
      <header className="flex items-center justify-end gap-4 border-b px-6 py-3 text-sm">
        <span>
          {usuario.nombre} ({usuario.rol === "admin" ? "Administrador" : "Vendedor"})
        </span>
        <BotonCerrarSesion />
      </header>
      <main className="flex-1 p-6">{children}</main>
    </>
  );
}
