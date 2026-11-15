/**
 * Recibo imprimible (`/clientes/recibos/[id]`) — RF-C5, decisiones C6 y C7.
 * Ambos roles.
 *
 * Muestra los datos del comercio (src/config/comercio.ts), el número de
 * recibo, fecha y hora, cliente, importe, medio, observación, usuario y el
 * saldo resultante HISTÓRICO guardado al registrar el pago (no el actual).
 * Los datos salen de obtenerPago(), igual que GET /api/pagos/{id}.
 * Al imprimir se ocultan la navegación y los botones.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Dato, ListaDatos } from "@/components/datos/lista-datos";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { BotonImprimir } from "@/components/impresion/boton-imprimir";
import { PrintHeader } from "@/components/impresion/print-header";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Fila, Texto } from "@/components/layout/primitivas";
import { Card, CardContent } from "@/components/ui/card";
import { normalizarError } from "@/lib/api-error";
import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { ETIQUETAS_MEDIO_PAGO } from "@/lib/validacion-pagos";
import { obtenerPago } from "@/servicios/pagos";

export const metadata: Metadata = { title: "Recibo" };

type Props = { params: Promise<{ id: string }> };

export default function PaginaRecibo(props: Props) {
  return (
    <PageContainer ancho="documento">
      <Suspense fallback={<LoadingState variante="ficha" texto="Cargando recibo…" />}>
        <Recibo {...props} />
      </Suspense>
    </PageContainer>
  );
}

async function Recibo({ params }: Props) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const { id } = await params;

  let pago;
  try {
    pago = await obtenerPago(usuario, { id });
  } catch (error) {
    const apiError = normalizarError(error);
    if (apiError.code === "NO_ENCONTRADO" || apiError.code === "VALIDACION") notFound();
    return <ErrorState titulo="No se pudo cargar el recibo" mensaje={apiError.message} volver={{ href: "/clientes", texto: "Volver a clientes" }} />;
  }

  return (
    <>
      <PageHeader
        className="print:hidden"
        volver={{ href: `/clientes/${pago.cliente.id}`, texto: "Volver a la ficha del cliente" }}
        titulo={`Recibo ${pago.numeroRecibo}`}
        acciones={<BotonImprimir texto="Imprimir recibo" />}
      />

      <Card className="shadow-suave print:ring-0">
        <CardContent className="flex flex-col gap-6 sm:px-8 sm:py-4 print:px-0">
          <PrintHeader tipo="Recibo" numero={pago.numeroRecibo}>
            <Texto>Fecha y hora: {formatearFechaHora(pago.fecha)}</Texto>
          </PrintHeader>

          <Fila justificar="between" alinear="baseline" gap="xs" className="rounded-lg bg-success-soft p-4 text-success-strong print:bg-transparent print:p-0 print:text-black">
            <Texto as="span" className="text-current">Recibimos de {pago.cliente.nombre} la suma de</Texto>
            <Texto as="span" peso="fuerte" numerico className="text-2xl text-current">
              {formatearMoneda(pago.importe)}
            </Texto>
          </Fila>

          <ListaDatos>
            <Dato etiqueta="Cliente">{pago.cliente.nombre}</Dato>
            <Dato etiqueta="Medio de pago">{ETIQUETAS_MEDIO_PAGO[pago.medio]}</Dato>
            <Dato etiqueta="Observación">{pago.observacion ?? "—"}</Dato>
            <Dato etiqueta="Atendió">{pago.usuario.nombre}</Dato>
            <Dato etiqueta="Saldo después del pago">
              <Texto as="span" peso="fuerte" numerico>
                {formatearMoneda(pago.saldoCliente)}
              </Texto>
            </Dato>
          </ListaDatos>
        </CardContent>
      </Card>
    </>
  );
}
