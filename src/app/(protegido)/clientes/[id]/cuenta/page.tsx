/**
 * Cuenta corriente del cliente (`/clientes/[id]/cuenta`) — RF-C4. Ambos roles.
 *
 * Movimientos en orden cronológico con saldo acumulado, saldo anterior y
 * saldo final. Filtros `desde` y `hasta` (días de Argentina) en la URL, con
 * la misma validación que GET /api/clientes/{id}/cuenta (el servicio).
 *
 * PROVISORIO: interfaz mínima para verificar el módulo.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { normalizarError } from "@/lib/api-error";
import { formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { obtenerCuentaCorriente } from "@/servicios/cuenta-corriente";

import { TablaMovimientos } from "../tabla-movimientos";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const primero = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor) ?? "";

export default function PaginaCuenta(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm">Cargando cuenta corriente…</p>}>
      <Cuenta {...props} />
    </Suspense>
  );
}

async function Cuenta({ params, searchParams }: Props) {
  const usuario = await exigirUsuarioDePagina(); // RF-U2
  const { id } = await params;
  const filtros = await searchParams;
  const desde = primero(filtros.desde);
  const hasta = primero(filtros.hasta);

  let cuenta;
  let error: string | null = null;
  try {
    cuenta = await obtenerCuentaCorriente(usuario, { id }, { desde, hasta });
  } catch (e) {
    const apiError = normalizarError(e);
    if (apiError.code === "NO_ENCONTRADO") notFound();
    const detalles = Array.isArray(apiError.details) ? (apiError.details as { campo: string; mensaje: string }[]) : [];
    error = detalles.length > 0 ? detalles.map((d) => `${d.campo}: ${d.mensaje}`).join(" · ") : apiError.message;
  }

  return (
    <section className="flex flex-col gap-6">
      <Link href={`/clientes/${id}`} className="text-sm underline">
        ← Volver a la ficha
      </Link>
      <h1 className="text-2xl font-semibold">Cuenta corriente{cuenta ? ` de ${cuenta.cliente.nombre}` : ""}</h1>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Desde
          <input type="date" name="desde" defaultValue={desde} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Hasta
          <input type="date" name="hasta" defaultValue={hasta} className="rounded border px-2 py-1" />
        </label>
        <button type="submit" className="rounded border px-3 py-1">
          Filtrar
        </button>
        <Link href={`/clientes/${id}/cuenta`} className="underline">
          Quitar filtros
        </Link>
      </form>

      {error !== null || !cuenta ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : (
        <>
          <p className="text-sm">
            Saldo anterior: <strong>{formatearMoneda(cuenta.saldoAnterior)}</strong> · Saldo final del período:{" "}
            <strong>{formatearMoneda(cuenta.saldo)}</strong>
          </p>
          {cuenta.movimientos.length === 0 ? (
            <p className="text-sm">No hay movimientos en el período.</p>
          ) : (
            <TablaMovimientos movimientos={cuenta.movimientos} saldoAnterior={cuenta.saldoAnterior} />
          )}
        </>
      )}
    </section>
  );
}
