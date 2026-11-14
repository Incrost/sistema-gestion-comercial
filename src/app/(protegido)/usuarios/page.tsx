/**
 * Gestión de usuarios (`/usuarios`) — RF-U4 y RF-U5. Solo administrador.
 *
 * Segunda barrera (sección 10.5): la página vuelve a leer al usuario de la
 * base y, si no es administrador, no muestra el módulo ni carga datos. La
 * tercera barrera es el servicio: la API responde 403 aunque se la llame
 * directamente.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo. El diseño definitivo
 * (panel lateral, shadcn/ui) llega en una etapa posterior.
 */
import { Suspense } from "react";

import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { tieneRol } from "@/servicios/permisos";

import { GestionUsuarios } from "./gestion-usuarios";

export default function PaginaUsuarios() {
  return (
    <Suspense fallback={<p className="text-sm">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2

  if (!tieneRol(usuario, "admin")) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Acceso denegado</h1>
        <p role="alert">No tiene permiso para acceder a la gestión de usuarios.</p>
      </section>
    );
  }

  return <GestionUsuarios usuarioActualId={usuario.id} />;
}
