/**
 * Saldos (`/clientes/saldos`) — RF-C6. Ambos roles.
 *
 * Clientes con deuda (saldo > 0), de mayor a menor, con el total adeudado.
 * Usa la misma consulta que GET /api/clientes?conDeuda=true&orden=saldo.
 * Hasta que existan ventas a cuenta corriente y pagos, la lista está vacía.
 *
 * PROVISORIO: interfaz mínima para verificar el módulo.
 */
import Link from "next/link";
import { Suspense } from "react";

import { normalizarError } from "@/lib/api-error";
import { formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarClientes } from "@/servicios/clientes";

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 20;

export default function PaginaSaldos({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando saldos…</p>}>
      <Saldos searchParams={searchParams} />
    </Suspense>
  );
}

async function Saldos({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const pagina = (await searchParams).page;

  let lista;
  try {
    lista = await listarClientes(usuario, {
      conDeuda: "true",
      orden: "saldo",
      page: Array.isArray(pagina) ? pagina[0] : pagina,
      pageSize: String(TAMANIO_PAGINA),
    });
  } catch (error) {
    return (
      <p role="alert" className="text-red-700">
        {normalizarError(error).message}
      </p>
    );
  }
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  const enlace = (page: number) => (page > 1 ? `/clientes/saldos?page=${page}` : "/clientes/saldos");

  return (
    <section className="flex flex-col gap-6">
      <Link href="/clientes" className="text-sm underline">
        ← Volver al listado
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Saldos de cuenta corriente</h1>
        <p className="text-sm">
          Total adeudado: <strong>{formatearMoneda(lista.totalAdeudado ?? 0)}</strong> · {lista.total} cliente(s) con deuda
        </p>
      </div>

      {lista.data.length === 0 ? (
        <p className="text-sm">No hay clientes con deuda.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3">Cliente</th>
              <th className="py-2 pr-3">Documento</th>
              <th className="py-2 pr-3 text-right">Saldo</th>
              <th className="py-2 pr-3 text-right">Límite</th>
              <th className="py-2 pr-3 text-right">Disponible</th>
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
                <td className="py-2 pr-3 text-right">{formatearMoneda(c.saldo)}</td>
                <td className="py-2 pr-3 text-right">{c.limiteCredito === null ? "Sin límite" : formatearMoneda(c.limiteCredito)}</td>
                <td className="py-2 pr-3 text-right">{c.disponible === null ? "—" : formatearMoneda(c.disponible)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav className="flex items-center gap-3 text-sm" aria-label="Paginación">
        {lista.page > 1 ? <Link href={enlace(lista.page - 1)} className="underline">Anterior</Link> : <span className="opacity-50">Anterior</span>}
        <span>
          Página {lista.page} de {totalPaginas}
        </span>
        {lista.page < totalPaginas ? <Link href={enlace(lista.page + 1)} className="underline">Siguiente</Link> : <span className="opacity-50">Siguiente</span>}
      </nav>
    </section>
  );
}
