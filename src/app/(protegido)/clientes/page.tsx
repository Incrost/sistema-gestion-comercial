/**
 * Listado de clientes (`/clientes`) — RF-C1 y alta (RF-C2). Ambos roles.
 *
 * Server Component: llama directamente al servicio (sección 10.6), que valida
 * los parámetros y verifica el rol. Búsqueda, estado y página viven en la
 * URL. El filtro de estado (activos, inactivos, todos) es solo para el
 * administrador; el vendedor ve únicamente clientes activos.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo. El diseño definitivo
 * (panel lateral, shadcn/ui) llega en una etapa posterior.
 */
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

import { normalizarError } from "@/lib/api-error";
import { formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarClientes } from "@/servicios/clientes";
import { tieneRol } from "@/servicios/permisos";

import { FormularioCliente } from "./formulario-cliente";

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 10;

export default function PaginaClientes({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando clientes…</p>}>
      <Listado searchParams={searchParams} />
    </Suspense>
  );
}

/** Primer valor de un parámetro de la URL (`?q=a&q=b` → "a"). */
function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

async function Listado({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const parametros = await searchParams;

  const filtros = {
    q: primero(parametros.q) ?? "",
    activo: esAdmin ? (primero(parametros.activo) ?? "true") : "true",
    page: primero(parametros.page) ?? "1",
  };

  let lista;
  try {
    lista = await listarClientes(usuario, { ...filtros, pageSize: String(TAMANIO_PAGINA) });
  } catch (error) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        <p role="alert" className="text-red-700">
          {normalizarError(error).message}
        </p>
        <Link href="/clientes" className="underline">
          Volver al listado
        </Link>
      </section>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  const enlacePagina = (page: number) => {
    const p = new URLSearchParams();
    if (filtros.q) p.set("q", filtros.q);
    if (filtros.activo !== "true") p.set("activo", filtros.activo);
    if (page > 1) p.set("page", String(page));
    const texto = p.toString();
    return texto ? `/clientes?${texto}` : "/clientes";
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        <Link href="/clientes/saldos" className="text-sm underline">
          Saldos
        </Link>
      </div>

      <Form action="/clientes" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Buscar por nombre o documento
          <input name="q" defaultValue={filtros.q} className="rounded border px-2 py-1" />
        </label>
        {esAdmin && (
          <label className="flex flex-col gap-1">
            Estado
            <select name="activo" defaultValue={filtros.activo} className="rounded border px-2 py-1">
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
          </label>
        )}
        <button type="submit" className="rounded border px-3 py-1">
          Buscar
        </button>
        <Link href="/clientes" className="underline">
          Limpiar
        </Link>
      </Form>

      {lista.data.length === 0 ? (
        <p className="text-sm">No hay clientes que coincidan con la búsqueda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">Documento</th>
                <th className="py-2 pr-3">Teléfono</th>
                <th className="py-2 pr-3">Cuenta corriente</th>
                <th className="py-2 pr-3 text-right">Saldo</th>
                <th className="py-2 pr-3 text-right">Disponible</th>
                <th className="py-2 pr-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.data.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="py-2 pr-3">
                    <Link href={`/clientes/${c.id}`} className="underline">
                      {c.nombre}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {c.tipoDoc} {c.nroDoc}
                  </td>
                  <td className="py-2 pr-3">{c.telefono ?? "—"}</td>
                  <td className="py-2 pr-3">{c.cuentaCorriente ? "Sí" : "No"}</td>
                  <td className="py-2 pr-3 text-right">{formatearMoneda(c.saldo)}</td>
                  <td className="py-2 pr-3 text-right">{c.disponible === null ? "Sin límite" : formatearMoneda(c.disponible)}</td>
                  <td className="py-2 pr-3">{!c.activo && <span className="rounded bg-gray-200 px-2 py-0.5">Inactivo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex items-center gap-3 text-sm" aria-label="Paginación">
        {lista.page > 1 ? <Link href={enlacePagina(lista.page - 1)} className="underline">Anterior</Link> : <span className="opacity-50">Anterior</span>}
        <span>
          Página {lista.page} de {totalPaginas} · {lista.total} cliente(s)
        </span>
        {lista.page < totalPaginas ? <Link href={enlacePagina(lista.page + 1)} className="underline">Siguiente</Link> : <span className="opacity-50">Siguiente</span>}
      </nav>

      <FormularioCliente />
    </section>
  );
}
