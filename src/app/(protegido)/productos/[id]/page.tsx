/**
 * Ficha del producto (`/productos/[id]`) — RF-P1, RF-P6 y, para el
 * administrador, RF-P2 a RF-P5 (edición, baja, ingresos y egresos).
 *
 * Server Component: llama a los servicios, que verifican el rol. Al vendedor
 * un producto inactivo le responde «no encontrado». El historial pagina con
 * `?page=` en la URL.
 */
import { BoxesIcon, DollarSignIcon, HistoryIcon, ShieldAlertIcon, TagIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataTable, type Columna } from "@/components/datos/data-table";
import { MetricCard } from "@/components/datos/metric-card";
import { Pagination } from "@/components/datos/pagination";
import { StatusBadge } from "@/components/datos/status-badge";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Grilla, Pila, Texto, Titulo } from "@/components/layout/primitivas";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizarError } from "@/lib/api-error";
import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarCategorias } from "@/servicios/categorias";
import { tieneRol } from "@/servicios/permisos";
import { obtenerProducto } from "@/servicios/productos";
import { listarMovimientosProducto, type MovimientoPublico } from "@/servicios/stock";

import { DialogoProducto } from "../formulario-producto";
import { BotonEstadoProducto, FormularioMovimiento } from "./acciones-producto";

export const metadata: Metadata = { title: "Ficha del producto" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TAMANIO_PAGINA = 10;

const NOMBRES_TIPO = { ingreso: "Ingreso", egreso: "Egreso", venta: "Venta", anulacion: "Anulación" };
const VARIANTE_TIPO = { ingreso: "success", egreso: "warning", venta: "secondary", anulacion: "outline" } as const;

const COLUMNAS: Columna<MovimientoPublico>[] = [
  { id: "fecha", encabezado: "Fecha y hora", principal: true, celda: (m) => formatearFechaHora(m.fecha) },
  { id: "tipo", encabezado: "Tipo", celda: (m) => <Badge variant={VARIANTE_TIPO[m.tipo]}>{NOMBRES_TIPO[m.tipo]}</Badge> },
  {
    id: "cantidad",
    encabezado: "Cantidad",
    alinear: "derecha",
    celda: (m) => (
      <Texto as="span" numerico tono={m.cantidad > 0 ? "exito" : "destructivo"}>
        {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
      </Texto>
    ),
  },
  { id: "resultante", encabezado: "Existencia resultante", alinear: "derecha", celda: (m) => m.existenciaResultante },
  {
    id: "motivo",
    encabezado: "Motivo",
    className: "whitespace-normal min-w-40",
    celda: (m) => (
      <>
        {m.motivo}
        {m.observacion && (
          <Texto tamanio="xs" tono="suave">
            {m.observacion}
          </Texto>
        )}
      </>
    ),
  },
  { id: "usuario", encabezado: "Usuario", celda: (m) => m.usuario.nombre },
  { id: "factura", encabezado: "Factura", celda: (m) => (
      <Texto as="span" tamanio="xs" className="font-mono">
        {m.referencia?.numero ?? "—"}
      </Texto>
    ) },
];

export default function PaginaProducto(props: Props) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState variante="ficha" texto="Cargando producto…" />}>
        <Ficha {...props} />
      </Suspense>
    </PageContainer>
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
    return <ErrorState titulo="No se pudo cargar el producto" mensaje={apiError.message} volver={{ href: "/productos", texto: "Volver al catálogo" }} />;
  }
  const categorias = esAdmin ? await listarCategorias(usuario) : [];
  const totalPaginas = Math.max(1, Math.ceil(movimientos.total / movimientos.pageSize));
  const enlace = (page: number) => `/productos/${producto.id}${page > 1 ? `?page=${page}` : ""}`;

  return (
    <>
      <PageHeader
        volver={{ href: "/productos", texto: "Volver al catálogo" }}
        titulo={producto.descripcion}
        descripcion={
          <Texto as="span" tono="suave" className="font-mono">
            {producto.codigo}
          </Texto>
        }
        insignias={
          <>
            {producto.bajoMinimo && <StatusBadge estado="bajo-minimo" />}
            <StatusBadge estado={producto.activo ? "activo" : "inactivo"} />
          </>
        }
        acciones={
          esAdmin && (
            <>
              {/* key: al cambiar los datos guardados, el formulario se reinicia con ellos. */}
              <DialogoProducto key={JSON.stringify(producto)} categorias={categorias} producto={producto} />
              <BotonEstadoProducto producto={producto} />
            </>
          )
        }
      />

      <Grilla columnas="4">
        <MetricCard titulo="Precio de venta" valor={formatearMoneda(producto.precio)} icono={DollarSignIcon} />
        <MetricCard
          titulo="Existencia"
          valor={String(producto.existencia)}
          icono={BoxesIcon}
          tono={producto.bajoMinimo ? "advertencia" : "exito"}
        >
          {producto.bajoMinimo ? "Por debajo del mínimo: conviene reponer." : "Existencia suficiente."}
        </MetricCard>
        <MetricCard titulo="Stock mínimo" valor={String(producto.stockMinimo)} icono={ShieldAlertIcon} />
        <MetricCard titulo="Categoría" valor={producto.categoria.nombre} icono={TagIcon} />
      </Grilla>

      <Grilla columnas="principal" className="items-start">
        <Pila gap="md" className="lg:col-span-2">
          <Pila gap="xs">
            <Titulo nivel={2} className="flex items-center gap-2">
              <HistoryIcon aria-hidden className="size-4 text-muted-foreground" />
              Movimientos de stock
            </Titulo>
            <Texto tono="suave">Del más reciente al más antiguo.</Texto>
          </Pila>
          <DataTable
            etiqueta="Movimientos de stock"
            columnas={COLUMNAS}
            filas={movimientos.data}
            clave={(m) => m.id}
            vacio={<EmptyState compacto icono={HistoryIcon} titulo="El producto todavía no tiene movimientos." />}
          />
          <Pagination
            etiqueta="Paginación de movimientos"
            pagina={movimientos.page}
            totalPaginas={totalPaginas}
            total={movimientos.total}
            unidad={["movimiento", "movimientos"]}
            enlace={enlace}
            textoAnterior="Más nuevos"
            textoSiguiente="Más viejos"
          />
        </Pila>

        {esAdmin ? (
          <Card className="shadow-suave lg:sticky lg:top-20">
            <CardHeader className="border-b">
              <CardTitle>
                <Titulo nivel={2}>Ingreso o egreso de stock</Titulo>
              </CardTitle>
              <CardDescription>La existencia solo cambia con movimientos registrados.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormularioMovimiento producto={producto} />
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-suave">
            <CardContent className="text-sm text-muted-foreground">
              Los ingresos, egresos y cambios de datos los registra un administrador.{" "}
              <Link href="/productos" className="font-medium text-primary hover:underline">
                Volver al catálogo
              </Link>
              .
            </CardContent>
          </Card>
        )}
      </Grilla>
    </>
  );
}
