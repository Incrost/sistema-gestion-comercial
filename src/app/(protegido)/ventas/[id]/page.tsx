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
 * Al imprimir se ocultan la navegación y los botones (`print:hidden`); el
 * comprobante se conserva completo.
 *
 * PROVISORIO: diseño mínimo; los datos del comercio son de ejemplo.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { COMERCIO, COMERCIO_CON_DATOS_PROVISORIOS } from "@/config/comercio";
import { normalizarError } from "@/lib/api-error";
import { formatearDocumento, formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import {
  ETIQUETAS_ESTADO_FACTURA,
  ETIQUETAS_FORMA_PAGO,
  ETIQUETAS_TIPO_TARJETA,
  NOMBRE_CONSUMIDOR_FINAL,
} from "@/lib/validacion-facturas";
import { obtenerFactura, type FacturaPublica } from "@/servicios/facturas";
import { tieneRol } from "@/servicios/permisos";

import { AccionAnular } from "../accion-anular";
import { BotonImprimir } from "./boton-imprimir";

type Props = { params: Promise<{ id: string }> };

export default function PaginaComprobante(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando comprobante…</p>}>
      <Comprobante {...props} />
    </Suspense>
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
    return (
      <p role="alert" className="text-red-700">
        {apiError.message}
      </p>
    );
  }

  const anulada = factura.estado === "anulada";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-4 print:hidden">
        <Link href="/ventas" className="text-sm underline">
          ← Volver al listado de facturas
        </Link>
      </div>

      <article className="relative flex max-w-3xl flex-col gap-4 rounded border p-6">
        {anulada && (
          <p className="w-fit rounded border-2 border-red-700 px-3 py-1 text-2xl font-bold tracking-widest text-red-700">
            ANULADA
          </p>
        )}

        <header className="flex flex-wrap justify-between gap-4 border-b pb-3">
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold">{COMERCIO.nombreComercial}</p>
            <p className="text-sm">{COMERCIO.razonSocial}</p>
            <p className="text-sm">CUIT {formatearDocumento("CUIT", COMERCIO.cuit)}</p>
            <p className="text-sm">{COMERCIO.domicilio}</p>
            {COMERCIO_CON_DATOS_PROVISORIOS && <p className="text-xs italic">Datos del comercio provisorios.</p>}
          </div>
          <div className="flex flex-col gap-1 text-sm sm:text-right">
            <h1 className="text-xl font-semibold">Factura {factura.numeroFormateado}</h1>
            <p>Fecha y hora: {formatearFechaHora(factura.fecha)}</p>
            <p>Estado: {ETIQUETAS_ESTADO_FACTURA[factura.estado]}</p>
            <p>Vendedor: {factura.vendedor.nombre}</p>
            <p className="text-xs italic">Comprobante interno, sin validez fiscal.</p>
          </div>
        </header>

        <div className="flex flex-col gap-1 text-sm">
          <h2 className="font-semibold">Comprador</h2>
          {factura.cliente === null ? (
            <p>{NOMBRE_CONSUMIDOR_FINAL}</p>
          ) : (
            <>
              <p>{factura.cliente.nombre}</p>
              {factura.cliente.tipoDoc && factura.cliente.nroDoc && (
                <p>
                  {factura.cliente.tipoDoc} {formatearDocumento(factura.cliente.tipoDoc, factura.cliente.nroDoc)}
                </p>
              )}
              {factura.cliente.domicilio && <p>{factura.cliente.domicilio}</p>}
            </>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3">Código</th>
                <th className="py-2 pr-3">Descripción</th>
                <th className="py-2 pr-3 text-right">Cantidad</th>
                <th className="py-2 pr-3 text-right">Precio unitario</th>
                <th className="py-2 pr-3 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {factura.items.map((item) => (
                <tr key={item.productoId} className="border-b">
                  <td className="py-2 pr-3 font-mono">{item.codigo}</td>
                  <td className="py-2 pr-3">{item.descripcion}</td>
                  <td className="py-2 pr-3 text-right">{item.cantidad}</td>
                  <td className="py-2 pr-3 text-right">{formatearMoneda(item.precioUnitario)}</td>
                  <td className="py-2 pr-3 text-right">{formatearMoneda(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="py-2 pr-3 text-right font-semibold">
                  Total
                </td>
                <td className="py-2 pr-3 text-right text-base font-semibold">{formatearMoneda(factura.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="font-medium">Forma de pago</dt>
          <dd>{ETIQUETAS_FORMA_PAGO[factura.pago.forma]}</dd>
          {factura.pago.forma === "contado" && (
            <>
              <dt className="font-medium">Monto recibido</dt>
              <dd>{formatearMoneda(factura.pago.montoRecibido)}</dd>
              <dt className="font-medium">Vuelto</dt>
              <dd>{formatearMoneda(factura.pago.vuelto)}</dd>
            </>
          )}
          {factura.pago.forma === "tarjeta" && (
            <>
              <dt className="font-medium">Tarjeta</dt>
              <dd>
                {ETIQUETAS_TIPO_TARJETA[factura.pago.tarjeta.tipo]} · {factura.pago.tarjeta.marca} · terminada en{" "}
                {factura.pago.tarjeta.ultimos4}
              </dd>
            </>
          )}
          {factura.pago.forma === "cuenta_corriente" && (
            <>
              <dt className="font-medium">Detalle</dt>
              <dd>Cargada a la cuenta corriente del cliente.</dd>
            </>
          )}
        </dl>

        {factura.anulacion && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-red-700 p-3 text-sm">
            <dt className="font-medium">Anulada el</dt>
            <dd>{formatearFechaHora(factura.anulacion.fecha)}</dd>
            <dt className="font-medium">Anulada por</dt>
            <dd>{factura.anulacion.usuario.nombre}</dd>
            <dt className="font-medium">Motivo</dt>
            <dd>{factura.anulacion.motivo}</dd>
          </dl>
        )}
      </article>

      <div className="flex flex-wrap items-start gap-3 print:hidden">
        <BotonImprimir />
        {tieneRol(usuario, "admin") && !anulada && (
          <AccionAnular facturaId={factura.id} numeroFormateado={factura.numeroFormateado} />
        )}
      </div>
    </section>
  );
}
