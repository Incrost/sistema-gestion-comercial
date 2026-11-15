/**
 * Saldos (`/clientes/saldos`) — RF-C6. Ambos roles.
 *
 * Clientes con deuda (saldo > 0), de mayor a menor, con el total adeudado.
 * Usa la misma consulta que GET /api/clientes?conDeuda=true&orden=saldo.
 * El saldo sale de movimientos_cuenta (regla 7): refleja los débitos y los
 * pagos registrados.
 */
import { CircleCheckBigIcon, UsersIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataTable, type Columna } from "@/components/datos/data-table";
import { MetricCard } from "@/components/datos/metric-card";
import { Pagination } from "@/components/datos/pagination";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Grilla, Texto } from "@/components/layout/primitivas";
import { normalizarError } from "@/lib/api-error";
import { formatearDocumento, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarClientes, type ClientePublico } from "@/servicios/clientes";

export const metadata: Metadata = { title: "Saldos" };

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 20;

const COLUMNAS: Columna<ClientePublico>[] = [
  {
    id: "cliente",
    encabezado: "Cliente",
    principal: true,
    className: "whitespace-normal min-w-44",
    celda: (c) => (
      <Link href={`/clientes/${c.id}`} className="font-medium text-primary hover:underline">
        {c.nombre}
      </Link>
    ),
  },
  { id: "documento", encabezado: "Documento", celda: (c) => `${c.tipoDoc} ${formatearDocumento(c.tipoDoc, c.nroDoc)}` },
  { id: "saldo", encabezado: "Saldo", alinear: "derecha", celda: (c) => (
      <Texto as="span" numerico tono="advertencia" peso="fuerte">
        {formatearMoneda(c.saldo)}
      </Texto>
    ) },
  { id: "limite", encabezado: "Límite", alinear: "derecha", celda: (c) => (c.limiteCredito === null ? "Sin límite" : formatearMoneda(c.limiteCredito)) },
  { id: "disponible", encabezado: "Disponible", alinear: "derecha", celda: (c) => (c.disponible === null ? "—" : formatearMoneda(c.disponible)) },
];

export default function PaginaSaldos({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState texto="Cargando saldos…" />}>
        <Saldos searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Saldos({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const pagina = (await searchParams).page;
  const encabezado = (
    <PageHeader
      volver={{ href: "/clientes", texto: "Volver al listado" }}
      titulo="Saldos de cuenta corriente"
      descripcion="Clientes con deuda, de mayor a menor saldo."
    />
  );

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
      <>
        {encabezado}
        <ErrorState titulo="No se pudieron cargar los saldos" mensaje={normalizarError(error).message} />
      </>
    );
  }
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  const enlace = (page: number) => (page > 1 ? `/clientes/saldos?page=${page}` : "/clientes/saldos");
  const totalAdeudado = lista.totalAdeudado ?? 0;

  return (
    <>
      {encabezado}
      <Grilla columnas="2">
        <MetricCard titulo="Total adeudado" valor={formatearMoneda(totalAdeudado)} icono={WalletIcon} tono={totalAdeudado > 0 ? "advertencia" : "exito"} />
        <MetricCard titulo="Clientes con deuda" valor={String(lista.total)} icono={UsersIcon} />
      </Grilla>

      <DataTable
        etiqueta="Saldos de clientes"
        columnas={COLUMNAS}
        filas={lista.data}
        clave={(c) => c.id}
        vacio={<EmptyState icono={CircleCheckBigIcon} titulo="No hay clientes con deuda." descripcion="Todas las cuentas corrientes están al día." />}
      />

      <Pagination pagina={lista.page} totalPaginas={totalPaginas} total={lista.total} unidad={["cliente con deuda", "clientes con deuda"]} enlace={enlace} />
    </>
  );
}
