"use client";

/**
 * Forma de pago de Nueva venta (RF-V5). Exactamente una por factura:
 *
 * - Contado: monto recibido opcional (vacío = el total) y vuelto estimado.
 * - Tarjeta: débito o crédito, marca y últimos 4 dígitos. NUNCA se piden el
 *   número completo, el código de seguridad ni el vencimiento (regla 9).
 * - Cuenta corriente: solo con cliente registrado y habilitado; se advierte
 *   si el total estimado supera el crédito disponible.
 *
 * Las opciones son botones de radio nativos (F8 enfoca la elegida y las
 * flechas cambian de opción). Los cálculos salen de evaluarContado() y
 * evaluarCuentaCorriente() (src/lib/borrador-venta.ts). El servidor vuelve a
 * verificar todo.
 */
import { CreditCardIcon, BanknoteIcon, TriangleAlertIcon, WalletIcon } from "lucide-react";
import type { Ref } from "react";

import { ErrorCampo, FormField, propsCampo } from "@/components/formularios/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  evaluarContado,
  evaluarCuentaCorriente,
  type ClienteVenta,
  type PagoBorrador,
} from "@/lib/borrador-venta";
import type { ErroresCampo } from "@/lib/cliente-api";
import { formatearMoneda } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import {
  ETIQUETAS_FORMA_PAGO,
  ETIQUETAS_TIPO_TARJETA,
  FORMAS_PAGO,
  MARCA_TARJETA_MAXIMA,
  MARCAS_TARJETA_SUGERIDAS,
  TIPOS_TARJETA,
  type FormaPago,
  type TipoTarjeta,
} from "@/lib/validacion-facturas";

type Props = {
  pago: PagoBorrador;
  cliente: ClienteVenta | null;
  total: number;
  errores: ErroresCampo;
  onCambiarForma: (forma: FormaPago) => void;
  onActualizar: (campos: Partial<Omit<PagoBorrador, "forma">>) => void;
  /** Contenedor de las opciones: F8 enfoca la opción elegida. */
  opcionesRef?: Ref<HTMLFieldSetElement>;
};

const ICONOS: Record<FormaPago, typeof WalletIcon> = {
  contado: BanknoteIcon,
  tarjeta: CreditCardIcon,
  cuenta_corriente: WalletIcon,
};

export function FormaPago({ pago, cliente, total, errores, onCambiarForma, onActualizar, opcionesRef }: Props) {
  const cuenta = evaluarCuentaCorriente(cliente, total);
  const contado = evaluarContado(pago.montoRecibido, total);
  const errorMonto = errores["pago.montoRecibido"] ?? (contado.ok ? undefined : contado.mensaje);

  return (
    <div className="@container flex flex-col gap-4 text-sm">
      <fieldset ref={opcionesRef} className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Forma de pago <kbd className="text-xs font-normal text-muted-foreground">(F8)</kbd>
        </legend>
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
          {FORMAS_PAGO.map((forma) => {
            const deshabilitada = forma === "cuenta_corriente" && !cuenta.habilitada;
            const Icono = ICONOS[forma];
            return (
              <label
                key={forma}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-muted",
                  "has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:font-medium has-[:checked]:text-accent-foreground",
                  "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  deshabilitada && "cursor-not-allowed text-muted-foreground opacity-70 hover:bg-card",
                )}
              >
                <input
                  type="radio"
                  name="forma-pago"
                  value={forma}
                  checked={pago.forma === forma}
                  disabled={deshabilitada}
                  aria-describedby={deshabilitada ? "motivo-cuenta-corriente" : undefined}
                  onChange={() => onCambiarForma(forma)}
                  className="size-4 accent-primary outline-none"
                />
                <Icono aria-hidden className="size-4 shrink-0" />
                <span className="leading-tight">{ETIQUETAS_FORMA_PAGO[forma]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {!cuenta.habilitada && (
        <p id="motivo-cuenta-corriente" className="text-xs text-muted-foreground">
          Cuenta corriente no disponible: {cuenta.motivo}
        </p>
      )}
      {errores["pago.forma"] && <ErrorCampo>{errores["pago.forma"]}</ErrorCampo>}

      {pago.forma === "contado" && (
        <div className="flex flex-col gap-2">
          <FormField id="monto-recibido" etiqueta="Monto recibido en pesos (opcional; vacío = el total)" error={errorMonto}>
            <Input
              {...propsCampo("monto-recibido", errorMonto)}
              value={pago.montoRecibido}
              onChange={(e) => onActualizar({ montoRecibido: e.target.value })}
              inputMode="decimal"
              autoComplete="off"
              placeholder={total > 0 ? formatearMoneda(total) : "Ej.: 15000,50"}
              className="tabular-nums sm:max-w-56 lg:max-w-none"
            />
          </FormField>
          {contado.ok && (
            <p className="rounded-lg bg-success-soft px-3 py-2 text-success-strong">
              Vuelto estimado: <strong>{formatearMoneda(contado.vuelto)}</strong>
            </p>
          )}
        </div>
      )}

      {pago.forma === "tarjeta" && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 @lg:grid-cols-3">
            <FormField id="tarjeta-tipo" etiqueta="Tipo" error={errores["pago.tarjeta.tipo"]}>
              <NativeSelect
                {...propsCampo("tarjeta-tipo", errores["pago.tarjeta.tipo"])}
                value={pago.tarjetaTipo}
                onChange={(e) => onActualizar({ tarjetaTipo: e.target.value as TipoTarjeta | "" })}
                className="w-full"
              >
                <NativeSelectOption value="">Seleccione…</NativeSelectOption>
                {TIPOS_TARJETA.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {ETIQUETAS_TIPO_TARJETA[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="tarjeta-marca" etiqueta="Marca" error={errores["pago.tarjeta.marca"]}>
              <Input
                {...propsCampo("tarjeta-marca", errores["pago.tarjeta.marca"])}
                value={pago.tarjetaMarca}
                onChange={(e) => onActualizar({ tarjetaMarca: e.target.value })}
                list="marcas-tarjeta"
                maxLength={MARCA_TARJETA_MAXIMA}
                autoComplete="off"
              />
              <datalist id="marcas-tarjeta">
                {MARCAS_TARJETA_SUGERIDAS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </FormField>
            <FormField id="tarjeta-ultimos4" etiqueta="Últimos 4 dígitos" error={errores["pago.tarjeta.ultimos4"]}>
              <Input
                {...propsCampo("tarjeta-ultimos4", errores["pago.tarjeta.ultimos4"])}
                value={pago.tarjetaUltimos4}
                onChange={(e) => onActualizar({ tarjetaUltimos4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                autoComplete="off"
                className="tabular-nums"
              />
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">
            Solo se registran el tipo, la marca y los últimos 4 dígitos. Nunca se solicitan el número completo, el código de
            seguridad ni el vencimiento.
          </p>
        </div>
      )}

      {pago.forma === "cuenta_corriente" && cliente && (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3">
            <dt className="text-muted-foreground">Saldo actual</dt>
            <dd className="text-right tabular-nums">{formatearMoneda(cliente.saldo)}</dd>
            <dt className="text-muted-foreground">Límite</dt>
            <dd className="text-right tabular-nums">{cliente.limiteCredito === null ? "Sin límite" : formatearMoneda(cliente.limiteCredito)}</dd>
            <dt className="text-muted-foreground">Crédito disponible</dt>
            <dd className="text-right font-medium tabular-nums">{cliente.disponible === null ? "Sin límite" : formatearMoneda(cliente.disponible)}</dd>
          </dl>
          {cuenta.advertencia && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-warning-strong">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {cuenta.advertencia}
            </p>
          )}
          <p className="text-xs text-muted-foreground">El servidor recalcula el saldo y el límite al confirmar.</p>
        </div>
      )}
    </div>
  );
}
