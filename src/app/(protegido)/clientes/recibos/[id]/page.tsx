/**
 * Recibo imprimible (`/clientes/recibos/[id]`) — RF-C5, decisiones C6 y C7.
 * Ambos roles.
 *
 * Muestra los datos del comercio (src/config/comercio.ts), el número de
 * recibo, fecha y hora, cliente, importe, medio, observación, usuario y el
 * saldo resultante HISTÓRICO guardado al registrar el pago (no el actual).
 * Los datos salen de obtenerPago(), igual que GET /api/pagos/{id}.
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
import { ETIQUETAS_MEDIO_PAGO } from "@/lib/validacion-pagos";
import { obtenerPago } from "@/servicios/pagos";

import { BotonImprimir } from "./boton-imprimir";

type Props = { params: Promise<{ id: string }> };

export default function PaginaRecibo(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando recibo…</p>}>
      <Recibo {...props} />
    </Suspense>
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
    return (
      <p role="alert" className="text-red-700">
        {apiError.message}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-4 print:hidden">
        <Link href={`/clientes/${pago.cliente.id}`} className="text-sm underline">
          ← Volver a la ficha del cliente
        </Link>
      </div>

      <article className="flex max-w-xl flex-col gap-4 rounded border p-6">
        <header className="flex flex-col gap-1 border-b pb-3">
          <p className="text-lg font-semibold">{COMERCIO.nombreComercial}</p>
          <p className="text-sm">{COMERCIO.razonSocial}</p>
          <p className="text-sm">CUIT {formatearDocumento("CUIT", COMERCIO.cuit)}</p>
          <p className="text-sm">{COMERCIO.domicilio}</p>
          {COMERCIO_CON_DATOS_PROVISORIOS && <p className="text-xs italic">Datos del comercio provisorios.</p>}
        </header>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Recibo {pago.numeroRecibo}</h1>
          <p className="text-sm">Fecha y hora: {formatearFechaHora(pago.fecha)}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="font-medium">Cliente</dt>
          <dd>{pago.cliente.nombre}</dd>
          <dt className="font-medium">Importe</dt>
          <dd className="font-semibold">{formatearMoneda(pago.importe)}</dd>
          <dt className="font-medium">Medio de pago</dt>
          <dd>{ETIQUETAS_MEDIO_PAGO[pago.medio]}</dd>
          <dt className="font-medium">Observación</dt>
          <dd>{pago.observacion ?? "—"}</dd>
          <dt className="font-medium">Atendió</dt>
          <dd>{pago.usuario.nombre}</dd>
          <dt className="font-medium">Saldo después del pago</dt>
          <dd>{formatearMoneda(pago.saldoCliente)}</dd>
        </dl>
      </article>

      <BotonImprimir />
    </section>
  );
}
