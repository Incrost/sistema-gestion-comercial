/**
 * Catálogo de productos (`/productos`) — RF-P1. Ambos roles; el alta es solo
 * para el administrador (RF-P2).
 *
 * Server Component: llama directamente a los servicios (sección 10.6), que
 * validan los parámetros y verifican el rol. Búsqueda, filtros y página viven
 * en la URL, así el listado se puede recargar y compartir.
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
import { listarCategorias } from "@/servicios/categorias";
import { tieneRol } from "@/servicios/permisos";
import { listarProductos } from "@/servicios/productos";

import { FormularioProducto } from "./formulario-producto";

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 10;

export default function PaginaProductos({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando catálogo…</p>}>
      <Catalogo searchParams={searchParams} />
    </Suspense>
  );
}

/** Primer valor de un parámetro de la URL (`?q=a&q=b` → "a"). */
function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

async function Catalogo({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const parametros = await searchParams;

  const filtros = {
    q: primero(parametros.q) ?? "",
    categoriaId: primero(parametros.categoriaId) ?? "",
    bajoMinimo: primero(parametros.bajoMinimo) === "true" ? "true" : "",
    activo: esAdmin ? (primero(parametros.activo) ?? "true") : "true",
    page: primero(parametros.page) ?? "1",
  };

  const categorias = await listarCategorias(usuario);
  let lista;
  try {
    lista = await listarProductos(usuario, { ...filtros, pageSize: String(TAMANIO_PAGINA) });
  } catch (error) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <p role="alert" className="text-red-700">
          {normalizarError(error).message}
        </p>
        <Link href="/productos" className="underline">
          Volver al catálogo
        </Link>
      </section>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  const enlacePagina = (page: number) => {
    const p = new URLSearchParams();
    for (const [clave, valor] of Object.entries({ ...filtros, page: String(page) })) {
      if (valor && !(clave === "activo" && valor === "true") && !(clave === "page" && valor === "1")) {
        p.set(clave, valor);
      }
    }
    const texto = p.toString();
    return texto ? `/productos?${texto}` : "/productos";
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <Link href="/productos/categorias" className="text-sm underline">
          Categorías
        </Link>
      </div>

      {/* Filtros: un formulario GET que escribe los parámetros en la URL. */}
      <Form action="/productos" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Buscar por código o descripción
          <input name="q" defaultValue={filtros.q} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Categoría
          <select name="categoriaId" defaultValue={filtros.categoriaId} className="rounded border px-2 py-1">
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="bajoMinimo" value="true" defaultChecked={filtros.bajoMinimo === "true"} />
          Solo bajo el mínimo
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
          Filtrar
        </button>
        <Link href="/productos" className="underline">
          Limpiar
        </Link>
      </Form>

      {lista.data.length === 0 ? (
        <p className="text-sm">No hay productos que coincidan con la búsqueda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3">Código</th>
                <th className="py-2 pr-3">Descripción</th>
                <th className="py-2 pr-3">Categoría</th>
                <th className="py-2 pr-3 text-right">Precio</th>
                <th className="py-2 pr-3 text-right">Existencia</th>
                <th className="py-2 pr-3 text-right">Mínimo</th>
                <th className="py-2 pr-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lista.data.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2 pr-3 font-mono">
                    <Link href={`/productos/${p.id}`} className="underline">
                      {p.codigo}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{p.descripcion}</td>
                  <td className="py-2 pr-3">{p.categoria.nombre}</td>
                  <td className="py-2 pr-3 text-right">{formatearMoneda(p.precio)}</td>
                  <td className="py-2 pr-3 text-right">{p.existencia}</td>
                  <td className="py-2 pr-3 text-right">{p.stockMinimo}</td>
                  <td className="py-2 pr-3">
                    {p.bajoMinimo && (
                      <span className="mr-2 rounded bg-amber-200 px-2 py-0.5 text-amber-900">Bajo mínimo</span>
                    )}
                    {!p.activo && <span className="rounded bg-gray-200 px-2 py-0.5">Inactivo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex items-center gap-3 text-sm" aria-label="Paginación">
        {lista.page > 1 ? <Link href={enlacePagina(lista.page - 1)} className="underline">Anterior</Link> : <span className="opacity-50">Anterior</span>}
        <span>
          Página {lista.page} de {totalPaginas} · {lista.total} producto(s)
        </span>
        {lista.page < totalPaginas ? <Link href={enlacePagina(lista.page + 1)} className="underline">Siguiente</Link> : <span className="opacity-50">Siguiente</span>}
      </nav>

      {esAdmin && <FormularioProducto categorias={categorias} />}
    </section>
  );
}
