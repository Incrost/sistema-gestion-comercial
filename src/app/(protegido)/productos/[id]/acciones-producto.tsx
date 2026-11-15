"use client";

/**
 * Acciones del administrador en la ficha del producto:
 * - ingreso y egreso manual de stock (RF-P4, RF-P5); el egreso se confirma
 *   antes de enviarse porque descuenta existencias;
 * - baja y reactivación lógica (RF-P3); la baja se confirma.
 *
 * Valida con los mismos esquemas que el servidor y consume la API REST. Los
 * motivos salen de la lista centralizada src/config/motivos-stock.ts.
 */
import { ArchiveRestoreIcon, ArchiveXIcon, ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField, propsCampo } from "@/components/formularios/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MOTIVOS_POR_TIPO, type TipoMovimientoManual } from "@/config/motivos-stock";
import { useEnvio } from "@/hooks/usar-envio";
import { ErrorDeApi, erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { avisos } from "@/lib/avisos";
import { cn } from "@/lib/utils";
import { esquemaMovimientoManual } from "@/lib/validacion-productos";
import type { ProductoPublico } from "@/servicios/productos";
import type { MovimientoPublico } from "@/servicios/stock";

const TIPOS: { valor: TipoMovimientoManual; texto: string; icono: typeof ArrowDownToLineIcon }[] = [
  { valor: "ingreso", texto: "Ingreso", icono: ArrowDownToLineIcon },
  { valor: "egreso", texto: "Egreso", icono: ArrowUpFromLineIcon },
];

export function FormularioMovimiento({ producto }: { producto: Pick<ProductoPublico, "id" | "codigo" | "existencia"> }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoMovimientoManual>("ingreso");
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState<string>(MOTIVOS_POR_TIPO.ingreso[0]);
  const [observacion, setObservacion] = useState("");
  const [confirmandoEgreso, setConfirmandoEgreso] = useState(false);
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  function cambiarTipo(nuevo: TipoMovimientoManual) {
    setTipo(nuevo);
    setMotivo(MOTIVOS_POR_TIPO[nuevo][0]);
    setErrores({});
  }

  function validar() {
    const validacion = esquemaMovimientoManual.safeParse({ tipo, cantidad: Number(cantidad), motivo, observacion });
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return null;
    }
    return validacion.data;
  }

  async function registrar(): Promise<boolean> {
    const datos = validar();
    if (!datos) return false;
    const mov = await ejecutar(
      () => llamarApi<MovimientoPublico>(`/api/productos/${producto.id}/movimientos`, { method: "POST", body: JSON.stringify(datos) }),
      {
        exito: (m) => `${m.tipo === "ingreso" ? "Ingreso" : "Egreso"} registrado. Existencia resultante: ${m.existenciaResultante}.`,
        idError: "movimiento-error",
      },
    );
    if (!mov) return true; // el error se informó; el diálogo de confirmación se cierra
    setCantidad("1");
    setObservacion("");
    router.refresh();
    return true;
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!validar()) return;
    // El egreso descuenta existencias: se confirma antes de enviarlo.
    if (tipo === "egreso") setConfirmandoEgreso(true);
    else void registrar();
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Tipo de movimiento</legend>
        <div className="grid grid-cols-2 gap-2">
          {TIPOS.map(({ valor, texto, icono: Icono }) => (
            <label
              key={valor}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm transition-colors hover:bg-muted",
                "has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:font-medium has-[:checked]:text-accent-foreground",
                "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              )}
            >
              <input type="radio" name="tipo-movimiento" value={valor} checked={tipo === valor} onChange={() => cambiarTipo(valor)} className="size-4 accent-primary" />
              <Icono aria-hidden className="size-4" />
              {texto}
            </label>
          ))}
        </div>
        {errores.tipo && <p className="text-xs text-destructive">{errores.tipo}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="mov-cantidad" etiqueta="Cantidad" error={errores.cantidad}>
          <Input
            {...propsCampo("mov-cantidad", errores.cantidad)}
            type="number"
            min={1}
            step={1}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="tabular-nums"
          />
        </FormField>
        <FormField id="mov-motivo" etiqueta="Motivo" error={errores.motivo}>
          <NativeSelect {...propsCampo("mov-motivo", errores.motivo)} value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-full">
            {MOTIVOS_POR_TIPO[tipo].map((m) => (
              <NativeSelectOption key={m} value={m}>
                {m}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="mov-observacion" etiqueta="Observación (opcional)" error={errores.observacion} className="sm:col-span-2">
          <Input {...propsCampo("mov-observacion", errores.observacion)} value={observacion} onChange={(e) => setObservacion(e.target.value)} />
        </FormField>
      </div>
      <Button type="submit" disabled={enviando} variant={tipo === "egreso" ? "destructive-soft" : "default"} className="w-full sm:w-fit">
        {enviando ? "Registrando…" : tipo === "ingreso" ? "Registrar ingreso" : "Registrar egreso"}
      </Button>

      <ConfirmDialog
        abierto={confirmandoEgreso}
        onAbiertoCambia={setConfirmandoEgreso}
        titulo={`¿Registrar el egreso de ${cantidad} ${Number(cantidad) === 1 ? "unidad" : "unidades"}?`}
        descripcion={
          <>
            Se descontarán de la existencia de <strong>{producto.codigo}</strong> (actual: {producto.existencia}) con el motivo «{motivo}». El
            movimiento queda registrado y no se puede eliminar.
          </>
        }
        textoConfirmar="Registrar egreso"
        textoEnviando="Registrando…"
        alConfirmar={registrar}
      />
    </form>
  );
}

export function BotonEstadoProducto({ producto }: { producto: ProductoPublico }) {
  const router = useRouter();

  async function cambiar(): Promise<boolean> {
    try {
      await llamarApi(`/api/productos/${producto.id}`, { method: "PATCH", body: JSON.stringify({ activo: !producto.activo }) });
    } catch (e) {
      const campos = e instanceof ErrorDeApi ? Object.values(e.campos) : [];
      avisos.error([(e as Error).message, ...campos].join(" "), { id: `producto-estado-${producto.id}` });
      return true;
    }
    avisos.exito(producto.activo ? `Producto ${producto.codigo} dado de baja.` : `Producto ${producto.codigo} reactivado.`, {
      id: `producto-estado-${producto.id}`,
    });
    router.refresh();
    return true;
  }

  if (!producto.activo) {
    return (
      <ConfirmDialog
        destructivo={false}
        titulo={`¿Reactivar ${producto.codigo}?`}
        descripcion="El producto volverá a ofrecerse en las ventas."
        textoConfirmar="Reactivar"
        alConfirmar={cambiar}
        disparador={
          <Button variant="outline">
            <ArchiveRestoreIcon aria-hidden />
            Reactivar
          </Button>
        }
      />
    );
  }
  return (
    <ConfirmDialog
      titulo={`¿Dar de baja ${producto.codigo}?`}
      descripcion="Dejará de ofrecerse en las ventas, pero conservará su historial de movimientos y facturas. Podrá reactivarse más adelante."
      textoConfirmar="Dar de baja"
      textoEnviando="Dando de baja…"
      alConfirmar={cambiar}
      disparador={
        <Button variant="destructive-soft">
          <ArchiveXIcon aria-hidden />
          Dar de baja
        </Button>
      }
    />
  );
}
