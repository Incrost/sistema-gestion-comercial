/**
 * Ficha del producto (`/productos/[id]`) — RF-P1, RF-P6 y, para el
 * administrador, RF-P2 a RF-P5 (edición, baja, ingresos y egresos).
 *
 * Server Component: llama a los servicios, que verifican el rol. Al vendedor
 * un producto inactivo le responde «no encontrado». El historial pagina con
 * `?page=` en la URL.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { normalizarError } from "@/lib/api-error";
import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarCategorias } from "@/servicios/categorias";
import { tieneRol } from "@/servicios/permisos";
import { obtenerProducto } from "@/servicios/productos";
import { listarMovimientosProducto } from "@/servicios/stock";

import { FormularioProducto } from "../formulario-producto";
import { BotonEstadoProducto, FormularioMovimiento } from "./acciones-producto";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TAMANIO_PAGINA = 10;

const NOMBRES_TIPO = { ingreso: "Ingreso", egreso: "Egreso", venta: "Venta", anulacion: "Anulación" };

export default function PaginaProducto(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando producto…</p>}>
      <Ficha {...props} />
    </Suspense>
  );
}

async function Ficha({ params, searchParams }: Props) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const { id } = await params;
  const pagina = (await searchParams).page;

  let producto, movimientos;
  try {
    producto = await obtenerProducto(usuario, { id });
    movimientos = await listarMovimientosProducto(
      usuario,
      { id },
      { page: Array.isArray(pagina) ? pagina[0] : pagina, pageSize: String(TAMANIO_PAGINA) },
    );
  } catch (error) {
    const apiError = normalizarError(error);
    if (apiError.code === "NO_ENCONTRADO") notFound();
    return (
      <p role="alert" className="text-red-700">
        {apiError.message}
      </p>
    );
  }
  const categorias = esAdmin ? await listarCategorias(usuario) : [];
  const totalPaginas = Math.max(1, Math.ceil(movimientos.total / movimientos.pageSize));
  const enlace = (page: number) => `/productos/${producto.id}${page > 1 ? `?page=${page}` : ""}`;

  return (
    <section className="flex flex-col gap-6">
      <Link href="/productos" className="text-sm underline">
        ← Volver al catálogo
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          <span className="font-mono">{producto.codigo}</span> · {producto.descripcion}
        </h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {producto.bajoMinimo && <span className="rounded bg-amber-200 px-2 py-0.5 text-amber-900">Bajo mínimo</span>}
          {!producto.activo && <span className="rounded bg-gray-200 px-2 py-0.5">Inactivo</span>}
        </div>
        <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="font-medium">Categoría</dt>
          <dd>{producto.categoria.nombre}</dd>
          <dt className="font-medium">Precio</dt>
          <dd>{formatearMoneda(producto.precio)}</dd>
          <dt className="font-medium">Existencia</dt>
          <dd>{producto.existencia}</dd>
          <dt className="font-medium">Stock mínimo</dt>
          <dd>{producto.stockMinimo}</dd>
        </dl>
      </div>

      {esAdmin && (
        <div className="flex flex-col gap-4">
          <BotonEstadoProducto producto={producto} />
          <FormularioMovimiento productoId={producto.id} />
          {/* key: al cambiar los datos guardados, el formulario se reinicia con ellos. */}
          <FormularioProducto key={JSON.stringify(producto)} categorias={categorias} producto={producto} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Movimientos de stock</h2>
        {movimientos.data.length === 0 ? (
          <p className="text-sm">El producto todavía no tiene movimientos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-3">Fecha y hora</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3 text-right">Cantidad</th>
                  <th className="py-2 pr-3 text-right">Existencia resultante</th>
                  <th className="py-2 pr-3">Motivo</th>
                  <th className="py-2 pr-3">Usuario</th>
                  <th className="py-2 pr-3">Factura</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.data.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="py-2 pr-3">{formatearFechaHora(m.fecha)}</td>
                    <td className="py-2 pr-3">{NOMBRES_TIPO[m.tipo]}</td>
                    <td className="py-2 pr-3 text-right">{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                    <td className="py-2 pr-3 text-right">{m.existenciaResultante}</td>
                    <td className="py-2 pr-3">
                      {m.motivo}
                      {m.observacion && <span className="block text-xs opacity-70">{m.observacion}</span>}
                    </td>
                    <td className="py-2 pr-3">{m.usuario.nombre}</td>
                    <td className="py-2 pr-3">{m.referencia?.numero ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav className="flex items-center gap-3 text-sm" aria-label="Paginación de movimientos">
          {movimientos.page > 1 ? <Link href={enlace(movimientos.page - 1)} className="underline">Más nuevos</Link> : <span className="opacity-50">Más nuevos</span>}
          <span>
            Página {movimientos.page} de {totalPaginas} · {movimientos.total} movimiento(s)
          </span>
          {movimientos.page < totalPaginas ? <Link href={enlace(movimientos.page + 1)} className="underline">Más viejos</Link> : <span className="opacity-50">Más viejos</span>}
        </nav>
      </div>
    </section>
  );
}
