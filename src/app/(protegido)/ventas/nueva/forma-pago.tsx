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
 * Los cálculos salen de evaluarContado() y evaluarCuentaCorriente()
 * (src/lib/borrador-venta.ts). El servidor vuelve a verificar todo.
 */
import type { ReactNode, Ref } from "react";

import {
  evaluarContado,
  evaluarCuentaCorriente,
  type ClienteVenta,
  type PagoBorrador,
} from "@/lib/borrador-venta";
import type { ErroresCampo } from "@/lib/cliente-api";
import { formatearMoneda } from "@/lib/formatos";
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

export function FormaPago({ pago, cliente, total, errores, onCambiarForma, onActualizar, opcionesRef }: Props) {
  const cuenta = evaluarCuentaCorriente(cliente, total);
  const contado = evaluarContado(pago.montoRecibido, total);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <fieldset ref={opcionesRef} className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1">
          Forma de pago <kbd className="text-xs">(F8)</kbd>
        </legend>
        {FORMAS_PAGO.map((forma) => {
          const deshabilitada = forma === "cuenta_corriente" && !cuenta.habilitada;
          return (
            <label key={forma} className={`flex items-center gap-1 ${deshabilitada ? "text-gray-500" : ""}`}>
              <input
                type="radio"
                name="forma-pago"
                value={forma}
                checked={pago.forma === forma}
                disabled={deshabilitada}
                aria-describedby={deshabilitada ? "motivo-cuenta-corriente" : undefined}
                onChange={() => onCambiarForma(forma)}
              />
              {ETIQUETAS_FORMA_PAGO[forma]}
            </label>
          );
        })}
      </fieldset>
      {!cuenta.habilitada && (
        <p id="motivo-cuenta-corriente" className="text-xs text-gray-600">
          Cuenta corriente no disponible: {cuenta.motivo}
        </p>
      )}
      {errores["pago.forma"] && (
        <p role="alert" className="text-red-700">
          {errores["pago.forma"]}
        </p>
      )}

      {pago.forma === "contado" && (
        <div className="flex flex-col gap-2">
          <Campo id="monto-recibido" etiqueta="Monto recibido en pesos (opcional; vacío = el total)" error={errores["pago.montoRecibido"] ?? (contado.ok ? undefined : contado.mensaje)}>
            <input
              id="monto-recibido"
              value={pago.montoRecibido}
              onChange={(e) => onActualizar({ montoRecibido: e.target.value })}
              inputMode="decimal"
              autoComplete="off"
              placeholder={total > 0 ? formatearMoneda(total) : "Ej.: 15000,50"}
              className="w-48 rounded border px-2 py-1"
            />
          </Campo>
          {contado.ok && (
            <p>
              Vuelto estimado: <strong>{formatearMoneda(contado.vuelto)}</strong>
            </p>
          )}
        </div>
      )}

      {pago.forma === "tarjeta" && (
        <div className="flex flex-col gap-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="tarjeta-tipo" etiqueta="Tipo" error={errores["pago.tarjeta.tipo"]}>
              <select
                id="tarjeta-tipo"
                value={pago.tarjetaTipo}
                onChange={(e) => onActualizar({ tarjetaTipo: e.target.value as TipoTarjeta | "" })}
                className="rounded border px-2 py-1"
              >
                <option value="">Seleccione…</option>
                {TIPOS_TARJETA.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_TARJETA[t]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="tarjeta-marca" etiqueta="Marca" error={errores["pago.tarjeta.marca"]}>
              <input
                id="tarjeta-marca"
                value={pago.tarjetaMarca}
                onChange={(e) => onActualizar({ tarjetaMarca: e.target.value })}
                list="marcas-tarjeta"
                maxLength={MARCA_TARJETA_MAXIMA}
                autoComplete="off"
                className="rounded border px-2 py-1"
              />
              <datalist id="marcas-tarjeta">
                {MARCAS_TARJETA_SUGERIDAS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Campo>
            <Campo id="tarjeta-ultimos4" etiqueta="Últimos 4 dígitos" error={errores["pago.tarjeta.ultimos4"]}>
              <input
                id="tarjeta-ultimos4"
                value={pago.tarjetaUltimos4}
                onChange={(e) => onActualizar({ tarjetaUltimos4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                autoComplete="off"
                className="w-24 rounded border px-2 py-1"
              />
            </Campo>
          </div>
          <p className="text-xs text-gray-600">
            Solo se registran el tipo, la marca y los últimos 4 dígitos. Nunca se solicitan el número completo, el código de
            seguridad ni el vencimiento.
          </p>
        </div>
      )}

      {pago.forma === "cuenta_corriente" && cliente && (
        <div className="flex flex-col gap-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Saldo actual</dt>
            <dd>{formatearMoneda(cliente.saldo)}</dd>
            <dt>Límite</dt>
            <dd>{cliente.limiteCredito === null ? "Sin límite" : formatearMoneda(cliente.limiteCredito)}</dd>
            <dt>Crédito disponible</dt>
            <dd>{cliente.disponible === null ? "Sin límite" : formatearMoneda(cliente.disponible)}</dd>
          </dl>
          {cuenta.advertencia && (
            <p role="alert" className="text-amber-800">
              {cuenta.advertencia}
            </p>
          )}
          <p className="text-xs text-gray-600">El servidor recalcula el saldo y el límite al confirmar.</p>
        </div>
      )}
    </div>
  );
}

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {error && (
        <span role="alert" className="text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
