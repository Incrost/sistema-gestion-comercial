/**
 * Inicio (`/`). PROVISORIO: el tablero (RF-T1 a RF-T3) se implementa más adelante.
 */
import { Suspense } from "react";

import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";

export default function PaginaInicio() {
  return (
    <Suspense fallback={<p className="text-sm">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Inicio</h1>
      <p>Sesión iniciada correctamente como {usuario.email}.</p>
    </section>
  );
}
