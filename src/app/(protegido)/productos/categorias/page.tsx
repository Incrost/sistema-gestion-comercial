/**
 * Categorías (`/productos/categorias`) — RF-P7.
 *
 * Ambos roles pueden consultarlas (solo las activas); el administrador ve
 * también las inactivas y puede crear, renombrar, desactivar y reactivar.
 * El permiso lo decide siempre el servicio: la API responde 403 al vendedor.
 */
import { TagsIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { DataTable } from "@/components/datos/data-table";
import { StatusBadge } from "@/components/datos/status-badge";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { normalizarError } from "@/lib/api-error";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarCategorias } from "@/servicios/categorias";
import { tieneRol } from "@/servicios/permisos";

import { GestionCategorias } from "./gestion-categorias";

export const metadata: Metadata = { title: "Categorías" };

export default function PaginaCategorias() {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState texto="Cargando categorías…" />}>
        <Contenido />
      </Suspense>
    </PageContainer>
  );
}

async function Contenido() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const encabezado = (
    <PageHeader
      volver={{ href: "/productos", texto: "Volver al catálogo" }}
      titulo="Categorías"
      descripcion={esAdmin ? "Alta, cambio de nombre y estado de las categorías del catálogo." : "Categorías activas del catálogo."}
    />
  );

  let categorias;
  try {
    categorias = await listarCategorias(usuario, esAdmin ? { incluirInactivas: "true" } : {});
  } catch (error) {
    return (
      <>
        {encabezado}
        <ErrorState titulo="No se pudieron cargar las categorías" mensaje={normalizarError(error).message} />
      </>
    );
  }

  return (
    <>
      {encabezado}
      {esAdmin ? (
        <GestionCategorias categorias={categorias} />
      ) : (
        <DataTable
          etiqueta="Categorías"
          columnas={[
            { id: "nombre", encabezado: "Nombre", principal: true, celda: (c) => c.nombre },
            { id: "estado", encabezado: "Estado", celda: () => <StatusBadge estado="activa" /> },
          ]}
          filas={categorias}
          clave={(c) => c.id}
          vacio={<EmptyState icono={TagsIcon} titulo="No hay categorías cargadas." />}
        />
      )}
    </>
  );
}
