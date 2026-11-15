/**
 * Inicio (`/`) — tablero con indicadores y gráficos (RF-T1, RF-T2, RF-T3).
 * Ambos roles.
 *
 * Server Component: lee los datos con los MISMOS servicios que usa
 * GET /api/tablero (obtenerTablero) y GET /api/productos?bajoMinimo=true
 * (listarProductos). Cada bloque tiene su Suspense (estado de carga) y su
 * estado de error recuperable, así un fallo en uno no oculta el otro.
 *
 * PROVISORIO en lo visual: el diseño definitivo llega con el rediseño general.
 */
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { CargandoBloque, CargandoTablero } from "@/components/tablero/cargando";
import { EstadoError } from "@/components/tablero/estado-error";
import { GraficoFormasPago } from "@/components/tablero/grafico-formas-pago";
import { GraficoVentasDiarias } from "@/components/tablero/grafico-ventas-diarias";
import { Indicadores } from "@/components/tablero/indicadores";
import { MasVendidos } from "@/components/tablero/mas-vendidos";
import { ParaReponer } from "@/components/tablero/para-reponer";
import { formatearDia, formatearMesAnio } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { listarProductos } from "@/servicios/productos";
import { obtenerTablero, type Tablero } from "@/servicios/tablero";

/** Cantidad de productos que se muestran en «Para reponer». */
const PRODUCTOS_PARA_REPONER = 8;

const ENLACES = [
  { href: "/ventas/nueva", texto: "Nueva venta" },
  { href: "/ventas", texto: "Ver facturas" },
  { href: "/productos?bajoMinimo=true", texto: "Ver productos bajo mínimo" },
  { href: "/clientes/saldos", texto: "Ver saldos de clientes" },
];

export default function PaginaInicio() {
  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6">
      <Suspense fallback={<CargandoTablero />}>
        <ContenidoTablero />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Seccion titulo="Para reponer" className="lg:col-span-2">
          <Suspense fallback={<CargandoBloque texto="Cargando productos para reponer…" />}>
            <BloqueParaReponer />
          </Suspense>
        </Seccion>
        <Seccion titulo="Accesos rápidos">
          <ul className="flex flex-col gap-2 text-sm">
            {ENLACES.map((e) => (
              <li key={e.href}>
                <Link href={e.href} className="underline">
                  {e.texto}
                </Link>
              </li>
            ))}
          </ul>
        </Seccion>
      </div>
    </div>
  );
}

function Seccion({ titulo, className = "", children }: { titulo: string; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700 ${className}`}>
      <h2 className="font-semibold">{titulo}</h2>
      {children}
    </section>
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
        <h1 className="text-2xl font-semibold">Inicio</h1>
        <EstadoError titulo="No se pudieron cargar los indicadores" mensaje="Ocurrió un error al consultar los datos del tablero. Intente nuevamente." />
      </>
    );
  }

  // El último día de la serie es hoy (en hora de Argentina, según el servidor).
  const hoy = tablero.ventasDiarias.at(-1)!.fecha;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Inicio</h1>
        <p className="text-sm opacity-80">
          Hoy, {formatearDia(hoy)} · Período del mes: {formatearMesAnio(hoy)}
        </p>
      </header>

      <Indicadores hoy={tablero.hoy} mes={tablero.mes} cuentasCorrientes={tablero.cuentasCorrientes} bajoMinimo={tablero.bajoMinimo} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Seccion titulo="Ventas diarias · últimos 30 días" className="lg:col-span-2">
          <GraficoVentasDiarias ventas={tablero.ventasDiarias} />
        </Seccion>
        <Seccion titulo={`Ventas por forma de pago · ${formatearMesAnio(hoy)}`}>
          <GraficoFormasPago formas={tablero.porFormaDePago} />
        </Seccion>
      </div>

      <Seccion titulo={`Productos más vendidos · ${formatearMesAnio(hoy)}`}>
        <MasVendidos productos={tablero.masVendidos} />
      </Seccion>
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
    return <EstadoError titulo="No se pudieron cargar los productos para reponer" mensaje="Intente nuevamente." />;
  }
  return <ParaReponer productos={lista.data} total={lista.total} />;
}
