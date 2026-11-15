/**
 * Nueva venta (`/ventas/nueva`) — RF-V1 a RF-V6. Ambos roles.
 *
 * Server Component mínimo: verifica la sesión (RF-U2; un usuario desactivado
 * vuelve a /login) y consulta el próximo número SOLO como dato informativo
 * (regla 4: el número real se asigna al confirmar). Toda la interacción vive
 * en el componente cliente <NuevaVenta>, que consume la API REST.
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { consultarProximoNumero } from "@/servicios/facturas";

import { NuevaVenta } from "./nueva-venta";

export const metadata: Metadata = { title: "Nueva venta" };

export default function PaginaNuevaVenta() {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState variante="ficha" texto="Preparando la venta…" />}>
        <Contenido />
      </Suspense>
    </PageContainer>
  );
}

async function Contenido() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2: admin y vendedor
  let proximoNumero: string | null = null;
  try {
    proximoNumero = (await consultarProximoNumero(usuario)).numeroFormateado;
  } catch {
    // Es solo informativo: si falla, la venta se puede confirmar igual.
  }
  return <NuevaVenta proximoNumero={proximoNumero} />;
}
