/**
 * Mi perfil (`/perfil`) — RF-U5. Accesible para administrador y vendedor.
 *
 * Muestra los datos del usuario conectado (leídos de la base en este pedido)
 * y el formulario para cambiar la propia contraseña. Los datos generales
 * (nombre, email, rol y estado) solo los modifica un administrador desde
 * /usuarios.
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";

import { ContenidoPerfil } from "./contenido-perfil";

export const metadata: Metadata = { title: "Mi perfil" };

export default function PaginaPerfil() {
  return (
    <PageContainer ancho="documento">
      <Suspense fallback={<LoadingState texto="Cargando…" variante="tarjetas" />}>
        <ContenidoPerfil />
      </Suspense>
    </PageContainer>
  );
}
