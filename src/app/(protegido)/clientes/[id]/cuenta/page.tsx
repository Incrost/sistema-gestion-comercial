/**
 * Cuenta corriente del cliente (`/clientes/[id]/cuenta`) — RF-C4. Ambos roles.
 *
 * Movimientos en orden cronológico con saldo acumulado, saldo anterior y
 * saldo final. Filtros `desde` y `hasta` (días de Argentina) en la URL, con
 * la misma validación que GET /api/clientes/{id}/cuenta (el servicio).
 */
import { HistoryIcon, ScaleIcon, UndoIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MetricCard } from "@/components/datos/metric-card";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { FilterBar } from "@/components/formularios/filter-bar";
import { FormField } from "@/components/formularios/form-field";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Grilla } from "@/components/layout/primitivas";
import { Input } from "@/components/ui/input";
import { normalizarError } from "@/lib/api-error";
import { formatearMoneda } from "@/lib/formatos";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";
import { obtenerCuentaCorriente } from "@/servicios/cuenta-corriente";

import { TablaMovimientos } from "../tabla-movimientos";

export const metadata: Metadata = { title: "Cuenta corriente" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const primero = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor) ?? "";

export default function PaginaCuenta(props: Props) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState variante="ficha" texto="Cargando cuenta corriente…" />}>
        <Cuenta {...props} />
      </Suspense>
    </PageContainer>
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
    <>
      <PageHeader
        volver={{ href: `/clientes/${id}`, texto: "Volver a la ficha" }}
        titulo={`Cuenta corriente${cuenta ? ` de ${cuenta.cliente.nombre}` : ""}`}
        descripcion="Movimientos en orden cronológico con el saldo acumulado."
      />

      <FilterBar action={`/clientes/${id}/cuenta`} hayFiltros={Boolean(desde || hasta)} etiqueta="Filtro por fechas">
        <FormField id="filtro-desde" etiqueta="Desde">
          <Input id="filtro-desde" type="date" name="desde" defaultValue={desde} />
        </FormField>
        <FormField id="filtro-hasta" etiqueta="Hasta">
          <Input id="filtro-hasta" type="date" name="hasta" defaultValue={hasta} />
        </FormField>
      </FilterBar>

      {error !== null || !cuenta ? (
        <ErrorState titulo="No se pudo consultar la cuenta corriente" mensaje={error ?? "Intente nuevamente."} volver={{ href: `/clientes/${id}/cuenta`, texto: "Quitar filtros" }} />
      ) : (
        <>
          <Grilla columnas="2">
            <MetricCard titulo="Saldo anterior" valor={formatearMoneda(cuenta.saldoAnterior)} icono={UndoIcon}>
              Saldo al comenzar el período.
            </MetricCard>
            <MetricCard titulo="Saldo final del período" valor={formatearMoneda(cuenta.saldo)} icono={ScaleIcon} tono={cuenta.saldo > 0 ? "advertencia" : "exito"}>
              {cuenta.saldo > 0 ? "Deuda pendiente." : "Sin deuda pendiente."}
            </MetricCard>
          </Grilla>
          {cuenta.movimientos.length === 0 ? (
            <EmptyState icono={HistoryIcon} titulo="No hay movimientos en el período." descripcion="Pruebe con otro rango de fechas." />
          ) : (
            <TablaMovimientos movimientos={cuenta.movimientos} saldoAnterior={cuenta.saldoAnterior} />
          )}
        </>
      )}
    </>
  );
}
