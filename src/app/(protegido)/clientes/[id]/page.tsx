/**
 * Ficha del cliente (`/clientes/[id]`) — RF-C3 (datos, saldo actual,
 * límite, disponible y últimas facturas), RF-C2 (edición) y, para el
 * administrador, RF-C7 (baja y reactivación).
 *
 * Server Component: llama al servicio, que verifica el rol. Al vendedor un
 * cliente inactivo le responde «no encontrado».
 *
 * Cuenta corriente (RF-C4): pestaña con el saldo y los últimos movimientos
 * con saldo acumulado; el historial completo con filtros está en
 * /clientes/[id]/cuenta. Registro de pagos (RF-C5): el formulario aparece
 * solo si el cliente está activo, tiene cuenta corriente y debe dinero (el
 * servidor lo vuelve a verificar).
 */
import { CircleDollarSignIcon, CreditCardIcon, FileTextIcon, HistoryIcon, ScaleIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataTable, type Columna } from "@/components/datos/data-table";
import { Dato, ListaDatos } from "@/components/datos/lista-datos";
import { MetricCard } from "@/components/datos/metric-card";
import { StatusBadge } from "@/components/datos/status-badge";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Grilla, Pila, Texto, Titulo } from "@/components/layout/primitivas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { normalizarError } from "@/lib/api-error";
import { formatearDocumento, formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { ETIQUETAS_FORMA_PAGO } from "@/lib/validacion-facturas";
import { obtenerCliente, type FacturaResumen } from "@/servicios/clientes";
import { obtenerCuentaCorriente } from "@/servicios/cuenta-corriente";
import { tieneRol } from "@/servicios/permisos";

import { BotonEstadoCliente, DialogoCliente } from "../formulario-cliente";

import { FormularioPago } from "./formulario-pago";
import { TablaMovimientos } from "./tabla-movimientos";

export const metadata: Metadata = { title: "Ficha del cliente" };

type Props = { params: Promise<{ id: string }> };

/** Movimientos que muestra la ficha (los más recientes, con su saldo acumulado). */
const MOVIMIENTOS_EN_FICHA = 10;

const COLUMNAS_FACTURAS: Columna<FacturaResumen>[] = [
  {
    id: "numero",
    encabezado: "Número",
    principal: true,
    celda: (f) => (
      <Link href={`/ventas/${f.id}`} className="font-mono font-medium text-primary hover:underline">
        {f.numero}
      </Link>
    ),
  },
  { id: "fecha", encabezado: "Fecha y hora", celda: (f) => formatearFechaHora(f.fecha) },
  { id: "forma", encabezado: "Forma de pago", celda: (f) => ETIQUETAS_FORMA_PAGO[f.formaPago] },
  {
    id: "total",
    encabezado: "Total",
    alinear: "derecha",
    celda: (f) => (
      <Texto as="span" numerico className={f.estado === "anulada" ? "text-muted-foreground line-through" : undefined}>
        {formatearMoneda(f.total)}
      </Texto>
    ),
  },
  { id: "estado", encabezado: "Estado", celda: (f) => <StatusBadge estado={f.estado} /> },
];

export default function PaginaCliente(props: Props) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState variante="ficha" texto="Cargando cliente…" />}>
        <Ficha {...props} />
      </Suspense>
    </PageContainer>
  );
}

async function Ficha({ params }: Props) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const esAdmin = tieneRol(usuario, "admin");
  const { id } = await params;

  let ficha;
  try {
    ficha = await obtenerCliente(usuario, { id });
  } catch (error) {
    const apiError = normalizarError(error);
    if (apiError.code === "NO_ENCONTRADO") notFound();
    return <ErrorState titulo="No se pudo cargar el cliente" mensaje={apiError.message} volver={{ href: "/clientes", texto: "Volver al listado" }} />;
  }
  const { ultimasFacturas, ...cliente } = ficha;

  // RF-C4: la cuenta solo se consulta para clientes activos (el servicio lo exige).
  const cuenta = cliente.activo ? await obtenerCuentaCorriente(usuario, { id }, {}) : null;
  const recientes = cuenta ? cuenta.movimientos.slice(-MOVIMIENTOS_EN_FICHA) : [];
  const puedePagar = cliente.activo && cliente.cuentaCorriente && cliente.saldo > 0;

  return (
    <>
      <PageHeader
        volver={{ href: "/clientes", texto: "Volver al listado" }}
        titulo={cliente.nombre}
        descripcion={`${cliente.tipoDoc} ${formatearDocumento(cliente.tipoDoc, cliente.nroDoc)}`}
        insignias={
          <>
            <StatusBadge estado={cliente.activo ? "activo" : "inactivo"} />
            <StatusBadge estado={cliente.cuentaCorriente ? "cuenta-corriente" : "sin-cuenta"} />
          </>
        }
        acciones={
          <>
            {/* key: al cambiar los datos guardados, el formulario se reinicia con ellos. */}
            <DialogoCliente key={JSON.stringify(cliente)} cliente={cliente} />
            {esAdmin && <BotonEstadoCliente cliente={cliente} />}
          </>
        }
      />

      <Grilla columnas="3">
        <MetricCard
          titulo="Saldo actual (deuda)"
          valor={formatearMoneda(cliente.saldo)}
          icono={ScaleIcon}
          tono={cliente.saldo > 0 ? "advertencia" : "exito"}
        >
          {cliente.saldo > 0 ? "Tiene deuda pendiente." : "Sin deuda pendiente."}
        </MetricCard>
        <MetricCard titulo="Límite de crédito" valor={cliente.limiteCredito === null ? "Sin límite" : formatearMoneda(cliente.limiteCredito)} icono={CreditCardIcon} />
        <MetricCard titulo="Crédito disponible" valor={cliente.disponible === null ? "Sin límite" : formatearMoneda(cliente.disponible)} icono={CircleDollarSignIcon} />
      </Grilla>

      <Tabs defaultValue="resumen" className="gap-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="resumen">
            <FileTextIcon aria-hidden />
            Datos y facturas
          </TabsTrigger>
          <TabsTrigger value="cuenta">
            <WalletIcon aria-hidden />
            Cuenta corriente
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="flex flex-col gap-6">
          <Card className="shadow-suave">
            <CardHeader>
              <CardTitle>
                <Titulo nivel={2}>Datos del cliente</Titulo>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ListaDatos columnas="3">
                <Dato etiqueta="Documento">
                  {cliente.tipoDoc} {formatearDocumento(cliente.tipoDoc, cliente.nroDoc)}
                </Dato>
                <Dato etiqueta="Domicilio">{cliente.domicilio ?? "—"}</Dato>
                <Dato etiqueta="Teléfono">{cliente.telefono ?? "—"}</Dato>
                <Dato etiqueta="Email">{cliente.email ?? "—"}</Dato>
                <Dato etiqueta="Cuenta corriente">{cliente.cuentaCorriente ? "Habilitada" : "No habilitada"}</Dato>
              </ListaDatos>
            </CardContent>
          </Card>

          <Pila gap="sm">
            <Titulo nivel={2}>Últimas facturas</Titulo>
            <DataTable
              etiqueta="Últimas facturas"
              columnas={COLUMNAS_FACTURAS}
              filas={ultimasFacturas}
              clave={(f) => f.id}
              vacio={<EmptyState compacto icono={FileTextIcon} titulo="El cliente todavía no tiene facturas." />}
            />
          </Pila>
        </TabsContent>

        <TabsContent value="cuenta">
          <Grilla columnas="principal" className="items-start">
            <Pila gap="sm" className="lg:col-span-2">
              <Pila gap="xs">
                <Titulo nivel={2}>Movimientos recientes</Titulo>
                {cuenta && (
                  <Texto tono="suave">
                    Saldo actual:{" "}
                    <Texto as="span" peso="fuerte" numerico>
                      {formatearMoneda(cuenta.saldo)}
                    </Texto>
                    {cuenta.movimientos.length > recientes.length &&
                      ` · se muestran los últimos ${recientes.length} de ${cuenta.movimientos.length} movimientos`}
                  </Texto>
                )}
              </Pila>
              {cuenta === null ? (
                <EmptyState compacto titulo="El cliente está dado de baja: su cuenta corriente no se consulta." />
              ) : recientes.length === 0 ? (
                <EmptyState compacto icono={HistoryIcon} titulo="La cuenta corriente no tiene movimientos." />
              ) : (
                <TablaMovimientos movimientos={recientes} />
              )}
              {cuenta && (
                <Button asChild variant="outline" className="w-fit">
                  <Link href={`/clientes/${cliente.id}/cuenta`}>
                    <HistoryIcon aria-hidden />
                    Ver cuenta completa y filtrar por fechas
                  </Link>
                </Button>
              )}
            </Pila>

            <Card className="shadow-suave">
              <CardHeader className="border-b">
                <CardTitle>
                  <Titulo nivel={2}>Registrar pago</Titulo>
                </CardTitle>
                <CardDescription>Genera un recibo numerado e imprimible.</CardDescription>
              </CardHeader>
              <CardContent>
                {puedePagar ? (
                  <FormularioPago clienteId={cliente.id} saldo={cliente.saldo} />
                ) : (
                  <Texto tono="suave">
                    {!cliente.activo
                      ? "El cliente está dado de baja."
                      : cliente.cuentaCorriente
                        ? "Sin deuda pendiente: no hay pagos para registrar."
                        : "El cliente no tiene la cuenta corriente habilitada."}
                  </Texto>
                )}
              </CardContent>
            </Card>
          </Grilla>
        </TabsContent>
      </Tabs>
    </>
  );
}
