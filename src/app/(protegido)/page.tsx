/**
 * Inicio (`/`) — tablero con indicadores y gráficos (RF-T1, RF-T2, RF-T3).
 * Ambos roles.
 *
 * Server Component: lee los datos con los MISMOS servicios que usa
 * GET /api/tablero (obtenerTablero) y GET /api/productos?bajoMinimo=true
 * (listarProductos). Cada bloque tiene su Suspense (estado de carga) y su
 * estado de error recuperable, así un fallo en uno no oculta el otro.
 */
import { ArrowRightIcon, ClipboardListIcon, PackageSearchIcon, ShoppingCartIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Grilla, Pila, Texto, Titulo } from "@/components/layout/primitivas";
import { GraficoFormasPago } from "@/components/tablero/grafico-formas-pago";
import { GraficoVentasDiarias } from "@/components/tablero/grafico-ventas-diarias";
import { Indicadores } from "@/components/tablero/indicadores";
import { MasVendidos } from "@/components/tablero/mas-vendidos";
import { ParaReponer } from "@/components/tablero/para-reponer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatearDia, formatearMesAnio } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { cn } from "@/lib/utils";
import { listarProductos } from "@/servicios/productos";
import { obtenerTablero, type Tablero } from "@/servicios/tablero";

/** Cantidad de productos que se muestran en «Para reponer». */
const PRODUCTOS_PARA_REPONER = 8;

const ACCESOS = [
  { href: "/ventas/nueva", texto: "Nueva venta", icono: ShoppingCartIcon },
  { href: "/ventas", texto: "Ver facturas", icono: ClipboardListIcon },
  { href: "/productos?bajoMinimo=true", texto: "Ver productos bajo mínimo", icono: PackageSearchIcon },
  { href: "/clientes/saldos", texto: "Ver saldos de clientes", icono: WalletIcon },
];

export default function PaginaInicio() {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState variante="ficha" texto="Cargando indicadores…" />}>
        <ContenidoTablero />
      </Suspense>

      <Grilla columnas="principal">
        <Bloque
          titulo="Para reponer"
          descripcion="Productos activos con existencia por debajo del mínimo"
          destacado
          className="lg:col-span-2"
        >
          <Suspense fallback={<LoadingState variante="bloque" texto="Cargando productos para reponer…" />}>
            <BloqueParaReponer />
          </Suspense>
        </Bloque>
        <Bloque titulo="Accesos rápidos">
          <Pila as="ul" gap="xs">
            {ACCESOS.map(({ href, texto, icono: Icono }) => (
              <Texto as="li" key={href}>
                <Button asChild variant="ghost" className="w-full justify-start">
                  <Link href={href}>
                    <Icono aria-hidden className="text-primary" />
                    <Texto as="span" className="flex-1 text-left">
                      {texto}
                    </Texto>
                    <ArrowRightIcon aria-hidden className="text-muted-foreground" />
                  </Link>
                </Button>
              </Texto>
            ))}
          </Pila>
        </Bloque>
      </Grilla>
    </PageContainer>
  );
}

/** Tarjeta de un bloque del tablero (gráfico, tabla o lista). */
function Bloque({
  titulo,
  descripcion,
  destacado = false,
  className,
  children,
}: {
  titulo: string;
  descripcion?: string;
  destacado?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("min-w-0 shadow-suave", destacado && "border-t-4 border-t-warning", className)}>
      <CardHeader>
        <CardTitle>
          <Titulo nivel={2}>{titulo}</Titulo>
        </CardTitle>
        {descripcion && <CardDescription>{descripcion}</CardDescription>}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

async function ContenidoTablero() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  let tablero: Tablero;
  try {
    tablero = await obtenerTablero(usuario);
  } catch (error) {
    console.error("Tablero: no se pudieron obtener los indicadores.", error);
    return (
      <>
        <PageHeader titulo="Inicio" />
        <ErrorState titulo="No se pudieron cargar los indicadores" mensaje="Ocurrió un error al consultar los datos del tablero. Intente nuevamente." />
      </>
    );
  }

  // El último día de la serie es hoy (en hora de Argentina, según el servidor).
  const hoy = tablero.ventasDiarias.at(-1)!.fecha;
  return (
    <>
      <PageHeader
        titulo="Inicio"
        descripcion={`Hoy, ${formatearDia(hoy)} · Período del mes: ${formatearMesAnio(hoy)}`}
        acciones={
          <Button asChild>
            <Link href="/ventas/nueva">
              <ShoppingCartIcon aria-hidden />
              Nueva venta
            </Link>
          </Button>
        }
      />

      <Indicadores hoy={tablero.hoy} mes={tablero.mes} cuentasCorrientes={tablero.cuentasCorrientes} bajoMinimo={tablero.bajoMinimo} />

      <Grilla columnas="principal">
        <Bloque titulo="Ventas diarias" descripcion="Últimos 30 días, solo facturas emitidas" className="lg:col-span-2">
          <GraficoVentasDiarias ventas={tablero.ventasDiarias} />
        </Bloque>
        <Bloque titulo="Ventas por forma de pago" descripcion={`Mes de ${formatearMesAnio(hoy)}`}>
          <GraficoFormasPago formas={tablero.porFormaDePago} />
        </Bloque>
      </Grilla>

      <Bloque titulo="Productos más vendidos" descripcion={`Top 5 por unidades · ${formatearMesAnio(hoy)}`}>
        <MasVendidos productos={tablero.masVendidos} />
      </Bloque>
    </>
  );
}

async function BloqueParaReponer() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  let lista: Awaited<ReturnType<typeof listarProductos>>;
  try {
    // Activos (por defecto) con existencia < stockMinimo, ordenados por código.
    lista = await listarProductos(usuario, { bajoMinimo: "true", pageSize: String(PRODUCTOS_PARA_REPONER) });
  } catch (error) {
    console.error("Tablero: no se pudieron obtener los productos para reponer.", error);
    return <ErrorState titulo="No se pudieron cargar los productos para reponer" mensaje="Intente nuevamente." />;
  }
  return <ParaReponer productos={lista.data} total={lista.total} />;
}
