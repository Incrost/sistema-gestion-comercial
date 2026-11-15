/**
 * Listado de facturas (`/ventas`) — RF-V8 (y RF-V9 para el administrador).
 * Ambos roles.
 *
 * Server Component: llama directamente al servicio (sección 10.6), que valida
 * los parámetros y verifica el rol. Búsqueda, filtros y página viven en la
 * URL, así el listado se puede recargar y compartir. Muestra `totalEmitido`
 * (suma de las emitidas del filtro). El botón «Anular» solo aparece para el
 * administrador y con la factura emitida.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo. El diseño definitivo
 * (panel lateral, shadcn/ui) llega en una etapa posterior.
 */
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

import { normalizarError } from "@/lib/api-error";
import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import {
  ESTADOS_FACTURA,
  ETIQUETAS_ESTADO_FACTURA,
  ETIQUETAS_FORMA_PAGO,
  FORMAS_PAGO,
  NOMBRE_CONSUMIDOR_FINAL,
} from "@/lib/validacion-facturas";
import { listarFacturas, opcionesFiltroFacturas } from "@/servicios/facturas";
import { tieneRol } from "@/servicios/permisos";

import { AccionAnular } from "./accion-anular";

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 20;

/** Filtros que se conservan en la URL (mismos nombres que GET /api/facturas). */
const FILTROS = ["q", "desde", "hasta", "clienteId", "vendedorId", "forma", "estado"] as const;

export default function PaginaVentas({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando facturas…</p>}>
      <Listado searchParams={searchParams} />
    </Suspense>
  );
}

/** Primer valor de un parámetro de la URL (`?q=a&q=b` → "a"). */
function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

async function Listado({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const parametros = await searchParams;

  const filtros = Object.fromEntries(FILTROS.map((f) => [f, primero(parametros[f])])) as Record<
    (typeof FILTROS)[number],
    string
  >;
  const page = primero(parametros.page) || "1";

  let lista;
  let opciones;
  try {
    [lista, opciones] = await Promise.all([
      listarFacturas(usuario, { ...filtros, page, pageSize: String(TAMANIO_PAGINA) }),
      opcionesFiltroFacturas(usuario),
    ]);
  } catch (error) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Facturas</h1>
        <p role="alert" className="text-red-700">
          {normalizarError(error).message}
        </p>
        <Link href="/ventas" className="underline">
          Volver al listado
        </Link>
      </section>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  const enlacePagina = (numero: number) => {
    const p = new URLSearchParams();
    for (const f of FILTROS) if (filtros[f]) p.set(f, filtros[f]);
    if (numero > 1) p.set("page", String(numero));
    const texto = p.toString();
    return texto ? `/ventas?${texto}` : "/ventas";
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Facturas</h1>
        <Link href="/ventas/nueva" className="rounded border px-3 py-1 text-sm">
          Nueva venta
        </Link>
      </div>

      <Form action="/ventas" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Número o comprador
          <input name="q" defaultValue={filtros.q} placeholder="0001-00000001 o nombre" className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Desde
          <input type="date" name="desde" defaultValue={filtros.desde} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Hasta
          <input type="date" name="hasta" defaultValue={filtros.hasta} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Cliente
          <select name="clienteId" defaultValue={filtros.clienteId} className="rounded border px-2 py-1">
            <option value="">Todos</option>
            {opciones.clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Vendedor
          <select name="vendedorId" defaultValue={filtros.vendedorId} className="rounded border px-2 py-1">
            <option value="">Todos</option>
            {opciones.vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Forma de pago
          <select name="forma" defaultValue={filtros.forma} className="rounded border px-2 py-1">
            <option value="">Todas</option>
            {FORMAS_PAGO.map((f) => (
              <option key={f} value={f}>
                {ETIQUETAS_FORMA_PAGO[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Estado
          <select name="estado" defaultValue={filtros.estado} className="rounded border px-2 py-1">
            <option value="">Todos</option>
            {ESTADOS_FACTURA.map((e) => (
              <option key={e} value={e}>
                {ETIQUETAS_ESTADO_FACTURA[e]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded border px-3 py-1">
          Filtrar
        </button>
        <Link href="/ventas" className="underline">
          Limpiar
        </Link>
      </Form>

      <p className="text-sm">
        Total emitido (sin anuladas) según el filtro: <strong>{formatearMoneda(lista.totalEmitido)}</strong>
      </p>

      {lista.data.length === 0 ? (
        <p className="text-sm">No hay facturas que coincidan con la búsqueda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3">Número</th>
                <th className="py-2 pr-3">Fecha y hora</th>
                <th className="py-2 pr-3">Comprador</th>
                <th className="py-2 pr-3">Vendedor</th>
                <th className="py-2 pr-3">Forma de pago</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3">Estado</th>
                {esAdmin && <th className="py-2 pr-3">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {lista.data.map((f) => (
                <tr key={f.id} className="border-b align-top">
                  <td className="py-2 pr-3 font-mono">
                    <Link href={`/ventas/${f.id}`} className="underline">
                      {f.numeroFormateado}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{formatearFechaHora(f.fecha)}</td>
                  <td className="py-2 pr-3">{f.cliente?.nombre ?? NOMBRE_CONSUMIDOR_FINAL}</td>
                  <td className="py-2 pr-3">{f.vendedor.nombre}</td>
                  <td className="py-2 pr-3">{ETIQUETAS_FORMA_PAGO[f.formaPago]}</td>
                  <td className={`py-2 pr-3 text-right ${f.estado === "anulada" ? "line-through" : ""}`}>
                    {formatearMoneda(f.total)}
                  </td>
                  <td className="py-2 pr-3">
                    {f.estado === "anulada" ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">Anulada</span>
                    ) : (
                      ETIQUETAS_ESTADO_FACTURA[f.estado]
                    )}
                  </td>
                  {esAdmin && (
                    <td className="py-2 pr-3">
                      {f.estado === "emitida" && <AccionAnular facturaId={f.id} numeroFormateado={f.numeroFormateado} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex items-center gap-3 text-sm" aria-label="Paginación">
        {lista.page > 1 ? <Link href={enlacePagina(lista.page - 1)} className="underline">Anterior</Link> : <span className="opacity-50">Anterior</span>}
        <span>
          Página {lista.page} de {totalPaginas} · {lista.total} factura(s)
        </span>
        {lista.page < totalPaginas ? <Link href={enlacePagina(lista.page + 1)} className="underline">Siguiente</Link> : <span className="opacity-50">Siguiente</span>}
      </nav>
    </section>
  );
}
