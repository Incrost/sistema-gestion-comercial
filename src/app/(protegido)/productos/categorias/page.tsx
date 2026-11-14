/**
 * Categorías (`/productos/categorias`) — RF-P7.
 *
 * Ambos roles pueden consultarlas (solo las activas); el administrador ve
 * también las inactivas y puede crear, renombrar, desactivar y reactivar.
 * El permiso lo decide siempre el servicio: la API responde 403 al vendedor.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo.
 */
import Link from "next/link";
import { Suspense } from "react";

import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarCategorias } from "@/servicios/categorias";
import { tieneRol } from "@/servicios/permisos";

import { GestionCategorias } from "./gestion-categorias";

export default function PaginaCategorias() {
  return (
    <Suspense fallback={<p className="text-sm">Cargando categorías…</p>}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const categorias = await listarCategorias(usuario, esAdmin ? { incluirInactivas: "true" } : {});

  return (
    <section className="flex flex-col gap-6">
      <Link href="/productos" className="text-sm underline">
        ← Volver al catálogo
      </Link>
      <h1 className="text-2xl font-semibold">Categorías</h1>
      {esAdmin ? (
        <GestionCategorias categorias={categorias} />
      ) : categorias.length === 0 ? (
        <p className="text-sm">No hay categorías cargadas.</p>
      ) : (
        <ul className="list-disc pl-6 text-sm">
          {categorias.map((c) => (
            <li key={c.id}>{c.nombre}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
