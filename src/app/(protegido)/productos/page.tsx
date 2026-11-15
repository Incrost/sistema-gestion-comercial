/**
 * Catálogo de productos (`/productos`) — RF-P1. Ambos roles; el alta es solo
 * para el administrador (RF-P2).
 *
 * Server Component: llama directamente a los servicios (sección 10.6), que
 * validan los parámetros y verifican el rol. Búsqueda, filtros y página viven
 * en la URL, así el listado se puede recargar y compartir.
 */
import { PackageSearchIcon, TagsIcon } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { normalizarError } from "@/lib/api-error";
import { formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarCategorias } from "@/servicios/categorias";
import { tieneRol } from "@/servicios/permisos";
import { listarProductos, type ProductoPublico } from "@/servicios/productos";

import { DialogoProducto } from "./formulario-producto";

export const metadata: Metadata = { title: "Productos" };

type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

const TAMANIO_PAGINA = 10;

export default function PaginaProductos({ searchParams }: { searchParams: ParametrosBusqueda }) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState texto="Cargando catálogo…" />}>
        <Catalogo searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/** Primer valor de un parámetro de la URL (`?q=a&q=b` → "a"). */
function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const COLUMNAS: Columna<ProductoPublico>[] = [
  {
    id: "codigo",
    encabezado: "Código",
    principal: true,
    celda: (p) => (
      <Link href={`/productos/${p.id}`} className="font-mono font-medium text-primary hover:underline">
        {p.codigo}
      </Link>
    ),
  },
  { id: "descripcion", encabezado: "Descripción", principal: true, className: "whitespace-normal min-w-48", celda: (p) => p.descripcion },
  { id: "categoria", encabezado: "Categoría", celda: (p) => p.categoria.nombre },
  { id: "precio", encabezado: "Precio", alinear: "derecha", celda: (p) => formatearMoneda(p.precio) },
  {
    id: "existencia",
    encabezado: "Existencia",
    alinear: "derecha",
    celda: (p) => (
      <Texto as="span" numerico tono={p.bajoMinimo ? "advertencia" : "normal"} peso={p.bajoMinimo ? "fuerte" : "normal"}>
        {p.existencia}
      </Texto>
    ),
  },
  { id: "minimo", encabezado: "Mínimo", alinear: "derecha", celda: (p) => p.stockMinimo },
  {
    id: "estado",
    encabezado: "Estado",
    celda: (p) =>
      p.bajoMinimo || !p.activo ? (
        <Fila gap="xs" className="justify-end md:justify-start">
          {p.bajoMinimo && <StatusBadge estado="bajo-minimo" />}
          {!p.activo && <StatusBadge estado="inactivo" />}
        </Fila>
      ) : (
        <StatusBadge estado="activo" />
      ),
  },
];

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
  const hayFiltros = Boolean(filtros.q || filtros.categoriaId || filtros.bajoMinimo || filtros.activo !== "true");

  let categorias;
  let lista;
  try {
    categorias = await listarCategorias(usuario);
    lista = await listarProductos(usuario, { ...filtros, pageSize: String(TAMANIO_PAGINA) });
  } catch (error) {
    return (
      <>
        <PageHeader titulo="Productos" />
        <ErrorState titulo="No se pudo cargar el catálogo" mensaje={normalizarError(error).message} volver={{ href: "/productos", texto: "Volver al catálogo" }} />
      </>
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
    <>
      <PageHeader
        titulo="Productos"
        descripcion="Catálogo con precios, existencias y stock mínimo."
        acciones={
          <>
            <Button asChild variant="outline">
              <Link href="/productos/categorias">
                <TagsIcon aria-hidden />
                Categorías
              </Link>
            </Button>
            {esAdmin && <DialogoProducto categorias={categorias} />}
          </>
        }
      />

      <FilterBar action="/productos" hayFiltros={hayFiltros} etiqueta="Filtros del catálogo">
        <FormField id="filtro-q" etiqueta="Buscar por código o descripción" className="sm:col-span-2">
          <SearchInput id="filtro-q" name="q" defaultValue={filtros.q} placeholder="Ej.: HE-001 o martillo" />
        </FormField>
        <FormField id="filtro-categoria" etiqueta="Categoría">
          <NativeSelect id="filtro-categoria" name="categoriaId" defaultValue={filtros.categoriaId} className="w-full">
            <NativeSelectOption value="">Todas</NativeSelectOption>
            {categorias.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.nombre}
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
        <Fila gap="sm" envolver={false} className="h-9">
          <Checkbox id="filtro-bajo-minimo" name="bajoMinimo" value="true" defaultChecked={filtros.bajoMinimo === "true"} />
          <Label htmlFor="filtro-bajo-minimo">Solo bajo el mínimo</Label>
        </Fila>
      </FilterBar>

      <DataTable
        etiqueta="Productos"
        columnas={COLUMNAS}
        filas={lista.data}
        clave={(p) => p.id}
        claseFila={(p) => (!p.activo ? "text-muted-foreground" : undefined)}
        vacio={
          <EmptyState
            icono={PackageSearchIcon}
            titulo="No hay productos que coincidan con la búsqueda."
            descripcion={hayFiltros ? "Pruebe con otros filtros o límpielos para ver todo el catálogo." : undefined}
          />
        }
      />

      <Pagination pagina={lista.page} totalPaginas={totalPaginas} total={lista.total} unidad={["producto", "productos"]} enlace={enlacePagina} />
    </>
  );
}
