/**
 * Listado de facturas (`/ventas`) — RF-V8 (y RF-V9 para el administrador).
 * Ambos roles.
 *
 * Server Component: llama directamente al servicio (sección 10.6), que valida
 * los parámetros y verifica el rol. Búsqueda, filtros y página viven en la
 * URL, así el listado se puede recargar y compartir. Muestra `totalEmitido`
 * (suma de las emitidas del filtro). El botón «Anular» solo aparece para el
 * administrador y con la factura emitida.
 */
import { FileSearchIcon, ShoppingCartIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataTable, type Columna } from "@/components/datos/data-table";
import { Pagination } from "@/components/datos/pagination";
import { StatusBadge } from "@/components/datos/status-badge";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { FilterBar } from "@/components/formularios/filter-bar";
import { FormField } from "@/components/formularios/form-field";
import { SearchInput } from "@/components/formularios/search-input";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Fila, Texto } from "@/components/layout/primitivas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { listarFacturas, opcionesFiltroFacturas, type FacturaResumenPublica } from "@/servicios/facturas";
import { tieneRol } from "@/servicios/permisos";

import { AccionAnular } from "./accion-anular";

export const metadata: Metadata = { title: "Facturas" };

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 20;

/** Filtros que se conservan en la URL (mismos nombres que GET /api/facturas). */
const FILTROS = ["q", "desde", "hasta", "clienteId", "vendedorId", "forma", "estado"] as const;

export default function PaginaVentas({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState texto="Cargando facturas…" />}>
        <Listado searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/** Primer valor de un parámetro de la URL (`?q=a&q=b` → "a"). */
function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? "";
}

const ACCION_NUEVA = (
  <Button asChild>
    <Link href="/ventas/nueva">
      <ShoppingCartIcon aria-hidden />
      Nueva venta
    </Link>
  </Button>
);

async function Listado({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const parametros = await searchParams;

  const filtros = Object.fromEntries(FILTROS.map((f) => [f, primero(parametros[f])])) as Record<
    (typeof FILTROS)[number],
    string
  >;
  const page = primero(parametros.page) || "1";
  const hayFiltros = FILTROS.some((f) => filtros[f] !== "");

  let lista;
  let opciones;
  try {
    [lista, opciones] = await Promise.all([
      listarFacturas(usuario, { ...filtros, page, pageSize: String(TAMANIO_PAGINA) }),
      opcionesFiltroFacturas(usuario),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader titulo="Facturas" acciones={ACCION_NUEVA} />
        <ErrorState titulo="No se pudieron cargar las facturas" mensaje={normalizarError(error).message} volver={{ href: "/ventas", texto: "Volver al listado" }} />
      </>
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

  const columnas: Columna<FacturaResumenPublica>[] = [
    {
      id: "numero",
      encabezado: "Número",
      principal: true,
      celda: (f) => (
        <Link href={`/ventas/${f.id}`} className="font-mono font-medium text-primary hover:underline">
          {f.numeroFormateado}
        </Link>
      ),
    },
    { id: "fecha", encabezado: "Fecha y hora", celda: (f) => formatearFechaHora(f.fecha) },
    { id: "comprador", encabezado: "Comprador", className: "max-w-56 truncate", celda: (f) => f.cliente?.nombre ?? NOMBRE_CONSUMIDOR_FINAL },
    { id: "vendedor", encabezado: "Vendedor", celda: (f) => f.vendedor.nombre },
    { id: "forma", encabezado: "Forma de pago", celda: (f) => ETIQUETAS_FORMA_PAGO[f.formaPago] },
    {
      id: "total",
      encabezado: "Total",
      alinear: "derecha",
      celda: (f) => (
        <Texto as="span" numerico peso={f.estado === "anulada" ? "normal" : "medio"} className={f.estado === "anulada" ? "text-muted-foreground line-through" : undefined}>
          {formatearMoneda(f.total)}
        </Texto>
      ),
    },
    { id: "estado", encabezado: "Estado", celda: (f) => <StatusBadge estado={f.estado} /> },
  ];

  return (
    <>
      <PageHeader titulo="Facturas" descripcion="Consulta de facturas emitidas y anuladas." acciones={ACCION_NUEVA} />

      <FilterBar action="/ventas" hayFiltros={hayFiltros} etiqueta="Filtros de facturas">
        <FormField id="filtro-q" etiqueta="Número o comprador" className="sm:col-span-2">
          <SearchInput id="filtro-q" name="q" defaultValue={filtros.q} placeholder="0001-00000001 o nombre" />
        </FormField>
        <FormField id="filtro-desde" etiqueta="Desde">
          <Input id="filtro-desde" type="date" name="desde" defaultValue={filtros.desde} />
        </FormField>
        <FormField id="filtro-hasta" etiqueta="Hasta">
          <Input id="filtro-hasta" type="date" name="hasta" defaultValue={filtros.hasta} />
        </FormField>
        <FormField id="filtro-cliente" etiqueta="Cliente">
          <NativeSelect id="filtro-cliente" name="clienteId" defaultValue={filtros.clienteId} className="w-full">
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {opciones.clientes.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.nombre}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="filtro-vendedor" etiqueta="Vendedor">
          <NativeSelect id="filtro-vendedor" name="vendedorId" defaultValue={filtros.vendedorId} className="w-full">
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {opciones.vendedores.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.nombre}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="filtro-forma" etiqueta="Forma de pago">
          <NativeSelect id="filtro-forma" name="forma" defaultValue={filtros.forma} className="w-full">
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {FORMAS_PAGO.map((f) => (
              <NativeSelectOption key={f} value={f}>
                {ETIQUETAS_FORMA_PAGO[f]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="filtro-estado" etiqueta="Estado">
          <NativeSelect id="filtro-estado" name="estado" defaultValue={filtros.estado} className="w-full">
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {ESTADOS_FACTURA.map((e) => (
              <NativeSelectOption key={e} value={e}>
                {ETIQUETAS_ESTADO_FACTURA[e]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      </FilterBar>

      <Card className="flex-row flex-wrap items-center justify-between gap-2 border-l-4 border-l-primary px-4 shadow-suave">
        <Texto tono="suave">Total emitido (sin anuladas) según el filtro</Texto>
        <Fila gap="sm" alinear="baseline">
          <Texto tamanio="lg" peso="fuerte" numerico className="text-2xl">
            {formatearMoneda(lista.totalEmitido)}
          </Texto>
          <Texto as="span" tono="suave" tamanio="xs">
            {lista.total} {lista.total === 1 ? "factura" : "facturas"}
          </Texto>
        </Fila>
      </Card>

      <DataTable
        etiqueta="Facturas"
        columnas={columnas}
        filas={lista.data}
        clave={(f) => f.id}
        claseFila={(f) => (f.estado === "anulada" ? "bg-destructive/[0.03]" : undefined)}
        acciones={
          esAdmin
            ? (f) => (f.estado === "emitida" ? <AccionAnular facturaId={f.id} numeroFormateado={f.numeroFormateado} compacto /> : null)
            : undefined
        }
        vacio={
          <EmptyState
            icono={FileSearchIcon}
            titulo="No hay facturas que coincidan con la búsqueda."
            descripcion={hayFiltros ? "Pruebe con otros filtros o límpielos para ver todas las facturas." : "Las ventas confirmadas aparecerán aquí."}
          />
        }
      />

      <Pagination pagina={lista.page} totalPaginas={totalPaginas} total={lista.total} unidad={["factura", "facturas"]} enlace={enlacePagina} />
    </>
  );
}
