/**
 * Nueva venta (`/ventas/nueva`) — RF-V1 a RF-V6. Ambos roles.
 *
 * Server Component mínimo: verifica la sesión (RF-U2; un usuario desactivado
 * vuelve a /login) y consulta el próximo número SOLO como dato informativo
 * (regla 4: el número real se asigna al confirmar). Toda la interacción vive
 * en el componente cliente <NuevaVenta>, que consume la API REST.
 *
 * PROVISORIO: interfaz funcional; el diseño definitivo llega más adelante.
 */
import { Suspense } from "react";

import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { consultarProximoNumero } from "@/servicios/facturas";

import { NuevaVenta } from "./nueva-venta";

export default function PaginaNuevaVenta() {
  return (
    <Suspense fallback={<p className="text-sm">Preparando la venta…</p>}>
      <Contenido />
    </Suspense>
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
