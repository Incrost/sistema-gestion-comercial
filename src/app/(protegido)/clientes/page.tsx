/**
 * Listado de clientes (`/clientes`) — RF-C1 y alta (RF-C2). Ambos roles.
 *
 * Server Component: llama directamente al servicio (sección 10.6), que valida
 * los parámetros y verifica el rol. Búsqueda, estado y página viven en la
 * URL. El filtro de estado (activos, inactivos, todos) es solo para el
 * administrador; el vendedor ve únicamente clientes activos.
 */
import { UsersIcon, WalletIcon } from "lucide-react";
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
import { Texto } from "@/components/layout/primitivas";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { normalizarError } from "@/lib/api-error";
import { formatearDocumento, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarClientes, type ClientePublico } from "@/servicios/clientes";
import { tieneRol } from "@/servicios/permisos";

import { DialogoCliente } from "./formulario-cliente";

export const metadata: Metadata = { title: "Clientes" };

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 10;

export default function PaginaClientes({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState texto="Cargando clientes…" />}>
        <Listado searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/** Primer valor de un parámetro de la URL (`?q=a&q=b` → "a"). */
function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const COLUMNAS: Columna<ClientePublico>[] = [
  {
    id: "nombre",
    encabezado: "Nombre",
    principal: true,
    className: "whitespace-normal min-w-44",
    celda: (c) => (
      <Link href={`/clientes/${c.id}`} className="font-medium text-primary hover:underline">
        {c.nombre}
      </Link>
    ),
  },
  { id: "documento", encabezado: "Documento", celda: (c) => `${c.tipoDoc} ${formatearDocumento(c.tipoDoc, c.nroDoc)}` },
  { id: "telefono", encabezado: "Teléfono", ocultarEnMovil: true, celda: (c) => c.telefono ?? "—" },
  {
    id: "cuenta",
    encabezado: "Cuenta corriente",
    celda: (c) => <StatusBadge estado={c.cuentaCorriente ? "cuenta-corriente" : "sin-cuenta"} texto={c.cuentaCorriente ? "Habilitada" : "No"} />,
  },
  {
    id: "saldo",
    encabezado: "Saldo",
    alinear: "derecha",
    celda: (c) => (
      <Texto as="span" numerico tono={c.saldo > 0 ? "advertencia" : "normal"} peso={c.saldo > 0 ? "fuerte" : "normal"}>
        {formatearMoneda(c.saldo)}
      </Texto>
    ),
  },
  { id: "disponible", encabezado: "Disponible", alinear: "derecha", celda: (c) => (c.disponible === null ? "Sin límite" : formatearMoneda(c.disponible)) },
  { id: "estado", encabezado: "Estado", celda: (c) => <StatusBadge estado={c.activo ? "activo" : "inactivo"} /> },
];

async function Listado({ searchParams }: { searchParams: ParametrosBusqueda }) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const parametros = await searchParams;

  const filtros = {
    q: primero(parametros.q) ?? "",
    activo: esAdmin ? (primero(parametros.activo) ?? "true") : "true",
    page: primero(parametros.page) ?? "1",
  };
  const hayFiltros = Boolean(filtros.q || filtros.activo !== "true");

  const acciones = (
    <>
      <Button asChild variant="outline">
        <Link href="/clientes/saldos">
          <WalletIcon aria-hidden />
          Saldos
        </Link>
      </Button>
      <DialogoCliente />
    </>
  );

  let lista;
  try {
    lista = await listarClientes(usuario, { ...filtros, pageSize: String(TAMANIO_PAGINA) });
  } catch (error) {
    return (
      <>
        <PageHeader titulo="Clientes" acciones={acciones} />
        <ErrorState titulo="No se pudieron cargar los clientes" mensaje={normalizarError(error).message} volver={{ href: "/clientes", texto: "Volver al listado" }} />
      </>
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
    <>
      <PageHeader titulo="Clientes" descripcion="Datos de contacto, cuenta corriente y crédito disponible." acciones={acciones} />

      <FilterBar action="/clientes" hayFiltros={hayFiltros} textoEnviar="Buscar" etiqueta="Búsqueda de clientes">
        <FormField id="filtro-q" etiqueta="Buscar por nombre o documento" className="sm:col-span-2">
          <SearchInput id="filtro-q" name="q" defaultValue={filtros.q} placeholder="Ej.: López o 28456123" />
        </FormField>
        {esAdmin && (
          <FormField id="filtro-activo" etiqueta="Estado">
            <NativeSelect id="filtro-activo" name="activo" defaultValue={filtros.activo} className="w-full">
              <NativeSelectOption value="true">Activos</NativeSelectOption>
              <NativeSelectOption value="false">Inactivos</NativeSelectOption>
              <NativeSelectOption value="todos">Todos</NativeSelectOption>
            </NativeSelect>
          </FormField>
        )}
      </FilterBar>

      <DataTable
        etiqueta="Clientes"
        columnas={COLUMNAS}
        filas={lista.data}
        clave={(c) => c.id}
        claseFila={(c) => (!c.activo ? "text-muted-foreground" : undefined)}
        vacio={
          <EmptyState
            icono={UsersIcon}
            titulo="No hay clientes que coincidan con la búsqueda."
            descripcion={hayFiltros ? "Pruebe con otro nombre o documento." : "Use «Nuevo cliente» para cargar el primero."}
          />
        }
      />

      <Pagination pagina={lista.page} totalPaginas={totalPaginas} total={lista.total} unidad={["cliente", "clientes"]} enlace={enlacePagina} />
    </>
  );
}
