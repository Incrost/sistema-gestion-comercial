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
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { BotonCerrarSesion } from "@/components/auth/boton-cerrar-sesion";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { tieneRol } from "@/servicios/permisos";

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
      <header className="flex items-center justify-end gap-4 border-b px-6 py-3 text-sm print:hidden">
        {/* Navegación mínima provisoria (el panel lateral llega más adelante). */}
        <nav className="mr-auto flex gap-4">
          <Link href="/">Inicio</Link>
          <Link href="/ventas/nueva">Nueva venta</Link>
          <Link href="/ventas">Ventas</Link>
          <Link href="/productos">Productos</Link>
          <Link href="/productos/categorias">Categorías</Link>
          <Link href="/clientes">Clientes</Link>
          <Link href="/clientes/saldos">Saldos</Link>
          {tieneRol(usuario, "admin") && <Link href="/usuarios">Usuarios</Link>}
        </nav>
        <span>
          {usuario.nombre} ({usuario.rol === "admin" ? "Administrador" : "Vendedor"})
        </span>
        <BotonCerrarSesion />
      </header>
      <main className="flex-1 p-6">{children}</main>
    </>
  );
}
