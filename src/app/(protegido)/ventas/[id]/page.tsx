/**
 * Comprobante imprimible (`/ventas/[id]`) — RF-V7 (y RF-V9 si está anulada).
 * Ambos roles.
 *
 * Muestra los datos del comercio (src/config/comercio.ts), número, fecha y
 * hora de Argentina, estado, vendedor, comprador CONGELADO, renglones, total
 * y forma de pago. Los datos salen de obtenerFactura(), igual que
 * GET /api/facturas/{id}: nunca se leen el cliente ni el catálogo actuales.
 *
 * Cuenta corriente: solo se indica la forma de pago. El saldo de la venta no
 * se guarda en la factura y no se inventa (el saldo actual está en la ficha).
 *
 * Al imprimir se ocultan el panel lateral, la barra superior y los botones
 * (`print:hidden`); el comprobante se conserva completo y «ANULADA» sigue visible.
 */
import { BanIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataTable, type Columna } from "@/components/datos/data-table";
import { Dato, ListaDatos } from "@/components/datos/lista-datos";
import { StatusBadge } from "@/components/datos/status-badge";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { BotonImprimir } from "@/components/impresion/boton-imprimir";
import { PrintHeader } from "@/components/impresion/print-header";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Pila, Texto, Titulo } from "@/components/layout/primitivas";
import { Card, CardContent } from "@/components/ui/card";
import { normalizarError } from "@/lib/api-error";
import { formatearDocumento, formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { ETIQUETAS_FORMA_PAGO, ETIQUETAS_TIPO_TARJETA, NOMBRE_CONSUMIDOR_FINAL } from "@/lib/validacion-facturas";
import { obtenerFactura, type FacturaPublica } from "@/servicios/facturas";
import { tieneRol } from "@/servicios/permisos";

import { AccionAnular } from "../accion-anular";

export const metadata: Metadata = { title: "Comprobante" };

type Props = { params: Promise<{ id: string }> };

type Item = FacturaPublica["items"][number];

const COLUMNAS: Columna<Item>[] = [
  { id: "codigo", encabezado: "Código", celda: (i) => (
      <Texto as="span" tamanio="xs" className="font-mono">
        {i.codigo}
      </Texto>
    ) },
  { id: "descripcion", encabezado: "Descripción", className: "whitespace-normal min-w-40", celda: (i) => i.descripcion },
  { id: "cantidad", encabezado: "Cantidad", alinear: "derecha", celda: (i) => i.cantidad },
  { id: "precio", encabezado: "Precio unitario", alinear: "derecha", celda: (i) => formatearMoneda(i.precioUnitario) },
  { id: "subtotal", encabezado: "Subtotal", alinear: "derecha", celda: (i) => formatearMoneda(i.subtotal) },
];

export default function PaginaComprobante(props: Props) {
  return (
    <PageContainer ancho="documento">
      <Suspense fallback={<LoadingState variante="ficha" texto="Cargando comprobante…" />}>
        <Comprobante {...props} />
      </Suspense>
    </PageContainer>
  );
}

async function Comprobante({ params }: Props) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const { id } = await params;

  let factura: FacturaPublica;
  try {
    factura = await obtenerFactura(usuario, { id });
  } catch (error) {
    const apiError = normalizarError(error);
    if (apiError.code === "NO_ENCONTRADO" || apiError.code === "VALIDACION") notFound();
    return <ErrorState titulo="No se pudo cargar el comprobante" mensaje={apiError.message} volver={{ href: "/ventas", texto: "Volver al listado" }} />;
  }

  const anulada = factura.estado === "anulada";

  return (
    <>
      <PageHeader
        className="print:hidden"
        volver={{ href: "/ventas", texto: "Volver al listado de facturas" }}
        titulo={`Factura ${factura.numeroFormateado}`}
        insignias={<StatusBadge estado={factura.estado} />}
        acciones={
          <>
            <BotonImprimir texto="Imprimir comprobante" />
            {tieneRol(usuario, "admin") && !anulada && <AccionAnular facturaId={factura.id} numeroFormateado={factura.numeroFormateado} />}
          </>
        }
      />

      <Card className="relative shadow-suave print:ring-0">
        <CardContent className="flex flex-col gap-6 sm:px-8 sm:py-4 print:px-0">
          {anulada && (
            <div
              role="note"
              className="flex items-center justify-center gap-2 rounded-md border-2 border-destructive py-2 text-2xl font-bold tracking-[0.3em] text-destructive print:border-black print:text-black"
            >
              <BanIcon aria-hidden className="size-6" />
              ANULADA
            </div>
          )}

          <PrintHeader tipo="Factura" numero={factura.numeroFormateado}>
            <Texto>Fecha y hora: {formatearFechaHora(factura.fecha)}</Texto>
            <Texto>Vendedor: {factura.vendedor.nombre}</Texto>
            <Texto tamanio="xs" tono="suave" className="italic">
              Comprobante interno, sin validez fiscal.
            </Texto>
          </PrintHeader>

          <Pila gap="xs">
            <Titulo nivel={3}>Comprador</Titulo>
            {factura.cliente === null ? (
              <Texto>{NOMBRE_CONSUMIDOR_FINAL}</Texto>
            ) : (
              <>
                <Texto peso="medio">{factura.cliente.nombre}</Texto>
                {factura.cliente.tipoDoc && factura.cliente.nroDoc && (
                  <Texto tono="suave">
                    {factura.cliente.tipoDoc} {formatearDocumento(factura.cliente.tipoDoc, factura.cliente.nroDoc)}
                  </Texto>
                )}
                {factura.cliente.domicilio && <Texto tono="suave">{factura.cliente.domicilio}</Texto>}
              </>
            )}
          </Pila>

          <DataTable
            etiqueta="Detalle de la factura"
            columnas={COLUMNAS}
            filas={factura.items}
            clave={(i) => i.productoId}
            movil="desplazamiento"
            anchoMinimo="min-w-[34rem]"
            pie={{ etiqueta: "Total", valor: formatearMoneda(factura.total) }}
          />

          <ListaDatos className="rounded-lg bg-muted/50 p-4 print:bg-transparent print:p-0">
            <Dato etiqueta="Forma de pago">{ETIQUETAS_FORMA_PAGO[factura.pago.forma]}</Dato>
            {factura.pago.forma === "contado" && (
              <>
                <Dato etiqueta="Monto recibido">{formatearMoneda(factura.pago.montoRecibido)}</Dato>
                <Dato etiqueta="Vuelto">{formatearMoneda(factura.pago.vuelto)}</Dato>
              </>
            )}
            {factura.pago.forma === "tarjeta" && (
              <Dato etiqueta="Tarjeta">
                {ETIQUETAS_TIPO_TARJETA[factura.pago.tarjeta.tipo]} · {factura.pago.tarjeta.marca} · terminada en {factura.pago.tarjeta.ultimos4}
              </Dato>
            )}
            {factura.pago.forma === "cuenta_corriente" && <Dato etiqueta="Detalle">Cargada a la cuenta corriente del cliente.</Dato>}
          </ListaDatos>

          {factura.anulacion && (
            <ListaDatos className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 print:border-black print:bg-transparent">
              <Dato etiqueta="Anulada el">{formatearFechaHora(factura.anulacion.fecha)}</Dato>
              <Dato etiqueta="Anulada por">{factura.anulacion.usuario.nombre}</Dato>
              <Dato etiqueta="Motivo" ancho>
                {factura.anulacion.motivo}
              </Dato>
            </ListaDatos>
          )}
        </CardContent>
      </Card>
    </>
  );
}
