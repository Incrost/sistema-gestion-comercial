/**
 * Gestión de usuarios (`/usuarios`) — RF-U4 y RF-U5. Solo administrador.
 *
 * Segunda barrera (sección 10.5): la página vuelve a leer al usuario de la
 * base y, si no es administrador, no muestra el módulo ni carga datos. La
 * tercera barrera es el servicio: la API responde 403 aunque se la llame
 * directamente.
 */
import { ShieldOffIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/estados/empty-state";
import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { tieneRol } from "@/servicios/permisos";

import { GestionUsuarios } from "./gestion-usuarios";

export const metadata: Metadata = { title: "Usuarios" };

export default function PaginaUsuarios() {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState texto="Cargando…" />}>
        <Contenido />
      </Suspense>
    </PageContainer>
  );
}

async function Contenido() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2

  if (!tieneRol(usuario, "admin")) {
    return (
      <>
        <PageHeader titulo="Acceso denegado" />
        <EmptyState
          icono={ShieldOffIcon}
          titulo="No tiene permiso para acceder a la gestión de usuarios."
          accion={
            <Button asChild variant="outline">
              <Link href="/">Ir al inicio</Link>
            </Button>
          }
        />
      </>
    );
  }

  return <GestionUsuarios usuarioActualId={usuario.id} />;
}
