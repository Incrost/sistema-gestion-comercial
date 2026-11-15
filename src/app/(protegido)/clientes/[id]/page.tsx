/**
 * Ficha del cliente (`/clientes/[id]`) — RF-C3 (datos, saldo actual,
 * límite, disponible y últimas facturas), RF-C2 (edición) y, para el
 * administrador, RF-C7 (baja y reactivación).
 *
 * Server Component: llama al servicio, que verifica el rol. Al vendedor un
 * cliente inactivo le responde «no encontrado».
 *
 * Cuenta corriente (RF-C4): saldo y últimos movimientos con saldo acumulado;
 * el historial completo con filtros está en /clientes/[id]/cuenta.
 * Registro de pagos (RF-C5): el formulario aparece solo si el cliente está
 * activo, tiene cuenta corriente y debe dinero (el servidor lo vuelve a verificar).
 *
 * PROVISORIO: interfaz mínima para verificar el módulo.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { normalizarError } from "@/lib/api-error";
import { formatearFechaHora, formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { obtenerCliente } from "@/servicios/clientes";
import { obtenerCuentaCorriente } from "@/servicios/cuenta-corriente";
import { tieneRol } from "@/servicios/permisos";

import { BotonEstadoCliente, FormularioCliente } from "../formulario-cliente";

import { FormularioPago } from "./formulario-pago";
import { TablaMovimientos } from "./tabla-movimientos";

type Props = { params: Promise<{ id: string }> };

/** Movimientos que muestra la ficha (los más recientes, con su saldo acumulado). */
const MOVIMIENTOS_EN_FICHA = 10;

const NOMBRES_FORMA = { contado: "Contado", tarjeta: "Tarjeta", cuenta_corriente: "Cuenta corriente" };

export default function PaginaCliente(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando cliente…</p>}>
      <Ficha {...props} />
    </Suspense>
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
    return (
      <p role="alert" className="text-red-700">
        {apiError.message}
      </p>
    );
  }
  const { ultimasFacturas, ...cliente } = ficha;

  // RF-C4: la cuenta solo se consulta para clientes activos (el servicio lo exige).
  const cuenta = cliente.activo ? await obtenerCuentaCorriente(usuario, { id }, {}) : null;
  const recientes = cuenta ? cuenta.movimientos.slice(-MOVIMIENTOS_EN_FICHA) : [];
  const puedePagar = cliente.activo && cliente.cuentaCorriente && cliente.saldo > 0;

  return (
    <section className="flex flex-col gap-6">
      <Link href="/clientes" className="text-sm underline">
        ← Volver al listado
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{cliente.nombre}</h1>
        {!cliente.activo && <span className="w-fit rounded bg-gray-200 px-2 py-0.5 text-sm">Inactivo</span>}
        <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="font-medium">Documento</dt>
          <dd className="font-mono">
            {cliente.tipoDoc} {cliente.nroDoc}
          </dd>
          <dt className="font-medium">Domicilio</dt>
          <dd>{cliente.domicilio ?? "—"}</dd>
          <dt className="font-medium">Teléfono</dt>
          <dd>{cliente.telefono ?? "—"}</dd>
          <dt className="font-medium">Email</dt>
          <dd>{cliente.email ?? "—"}</dd>
          <dt className="font-medium">Cuenta corriente</dt>
          <dd>{cliente.cuentaCorriente ? "Habilitada" : "No habilitada"}</dd>
          <dt className="font-medium">Saldo actual</dt>
          <dd>{formatearMoneda(cliente.saldo)}</dd>
          <dt className="font-medium">Límite de crédito</dt>
          <dd>{cliente.limiteCredito === null ? "Sin límite" : formatearMoneda(cliente.limiteCredito)}</dd>
          <dt className="font-medium">Crédito disponible</dt>
          <dd>{cliente.disponible === null ? "Sin límite" : formatearMoneda(cliente.disponible)}</dd>
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Últimas facturas</h2>
        {ultimasFacturas.length === 0 ? (
          <p className="text-sm">El cliente todavía no tiene facturas.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3">Número</th>
                <th className="py-2 pr-3">Fecha y hora</th>
                <th className="py-2 pr-3">Forma de pago</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {ultimasFacturas.map((f) => (
                <tr key={f.id} className="border-b">
                  <td className="py-2 pr-3 font-mono">{f.numero}</td>
                  <td className="py-2 pr-3">{formatearFechaHora(f.fecha)}</td>
                  <td className="py-2 pr-3">{NOMBRES_FORMA[f.formaPago]}</td>
                  <td className="py-2 pr-3 text-right">{formatearMoneda(f.total)}</td>
                  <td className="py-2 pr-3">{f.estado === "anulada" ? "Anulada" : "Emitida"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Cuenta corriente</h2>
        {cuenta === null ? (
          <p className="text-sm">El cliente está dado de baja: su cuenta corriente no se consulta.</p>
        ) : (
          <>
            <p className="text-sm">
              Saldo actual: <strong>{formatearMoneda(cuenta.saldo)}</strong>
              {cuenta.movimientos.length > recientes.length &&
                ` · se muestran los últimos ${recientes.length} de ${cuenta.movimientos.length} movimientos`}
              {" · "}
              <Link href={`/clientes/${cliente.id}/cuenta`} className="underline">
                Ver cuenta completa y filtrar por fechas
              </Link>
            </p>
            {recientes.length === 0 ? (
              <p className="text-sm">La cuenta corriente no tiene movimientos.</p>
            ) : (
              <TablaMovimientos movimientos={recientes} />
            )}
          </>
        )}
        {puedePagar ? (
          <FormularioPago clienteId={cliente.id} saldo={cliente.saldo} />
        ) : (
          cliente.activo && (
            <p className="text-sm opacity-75">
              {cliente.cuentaCorriente
                ? "Sin deuda pendiente: no hay pagos para registrar."
                : "El cliente no tiene la cuenta corriente habilitada."}
            </p>
          )
        )}
      </div>

      {esAdmin && <BotonEstadoCliente cliente={cliente} />}
      {/* key: al cambiar los datos guardados, el formulario se reinicia con ellos. */}
      <FormularioCliente key={JSON.stringify(cliente)} cliente={cliente} />
    </section>
  );
}
