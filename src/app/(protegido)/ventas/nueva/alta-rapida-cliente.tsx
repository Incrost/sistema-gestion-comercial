"use client";

/**
 * Alta rápida de cliente desde Nueva venta (RF-V2 con RF-C2), en una ventana
 * modal (`<dialog>` nativo: atrapa el foco y se cierra con Escape).
 *
 * Usa la MISMA ruta que el alta normal, POST /api/clientes, con todos los
 * campos de RF-C2. Valida antes con el mismo esquema del servidor
 * (prepararAltaRapida) y muestra junto a cada campo los errores que devuelva
 * la API (p. ej. 409 DOCUMENTO_DUPLICADO en el número de documento).
 * La venta en curso no se toca: al crear el cliente, la pantalla lo
 * selecciona y conserva los ítems.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { TIPOS_DOCUMENTO, type TipoDocumento } from "@/db/schema";
import { ALTA_RAPIDA_INICIAL, prepararAltaRapida, type ValoresAltaRapida } from "@/lib/borrador-venta";
import { ErrorDeApi, llamarApi, type ErroresCampo } from "@/lib/cliente-api";
import type { ClientePublico } from "@/servicios/clientes";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  onCreado: (cliente: ClientePublico) => void;
};

export function AltaRapidaCliente({ abierto, onCerrar, onCreado }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={dialogo}
      onClose={onCerrar}
      aria-labelledby="titulo-alta-rapida"
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded border p-0 backdrop:bg-black/40"
    >
      {/* Se monta al abrir: cada apertura empieza con el formulario vacío. */}
      {abierto && <Formulario onCancelar={onCerrar} onCreado={onCreado} />}
    </dialog>
  );
}

function Formulario({ onCancelar, onCreado }: { onCancelar: () => void; onCreado: (c: ClientePublico) => void }) {
  const [valores, setValores] = useState<ValoresAltaRapida>(ALTA_RAPIDA_INICIAL);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = <K extends keyof ValoresAltaRapida>(campo: K, valor: ValoresAltaRapida[K]) =>
    setValores((v) => ({ ...v, [campo]: valor }));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setGeneral(null);
    const preparado = prepararAltaRapida(valores);
    if (!preparado.ok) {
      setErrores(preparado.errores);
      return;
    }
    setErrores({});
    setEnviando(true);
    try {
      const cliente = await llamarApi<ClientePublico>("/api/clientes", { method: "POST", body: JSON.stringify(preparado.cuerpo) });
      onCreado(cliente);
    } catch (error) {
      if (error instanceof ErrorDeApi) setErrores(error.campos);
      setGeneral((error as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 p-4 text-sm">
      <h2 id="titulo-alta-rapida" className="text-lg font-semibold">
        Alta rápida de cliente
      </h2>
      <p className="text-xs text-gray-600">La venta en curso se conserva. Escape cierra esta ventana sin guardar.</p>
      {general && (
        <p role="alert" className="text-red-700">
          {general}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo de documento" error={errores.tipoDoc}>
          <select
            value={valores.tipoDoc}
            onChange={(e) => cambiar("tipoDoc", e.target.value as TipoDocumento)}
            className="rounded border px-2 py-1"
            autoFocus
          >
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Número de documento" error={errores.nroDoc}>
          <input value={valores.nroDoc} inputMode="numeric" onChange={(e) => cambiar("nroDoc", e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Nombre o razón social" error={errores.nombre}>
          <input value={valores.nombre} onChange={(e) => cambiar("nombre", e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Domicilio (opcional)" error={errores.domicilio}>
          <input value={valores.domicilio} onChange={(e) => cambiar("domicilio", e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Teléfono (opcional)" error={errores.telefono}>
          <input value={valores.telefono} type="tel" onChange={(e) => cambiar("telefono", e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Email (opcional)" error={errores.email}>
          <input value={valores.email} type="email" onChange={(e) => cambiar("email", e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={valores.cuentaCorriente} onChange={(e) => cambiar("cuentaCorriente", e.target.checked)} />
          Habilitado para cuenta corriente
          {errores.cuentaCorriente && <span className="text-red-700">{errores.cuentaCorriente}</span>}
        </label>
        {valores.cuentaCorriente && (
          <Campo etiqueta="Límite de crédito en pesos (vacío = sin límite)" error={errores.limiteCredito}>
            <input
              value={valores.limiteCredito}
              inputMode="decimal"
              onChange={(e) => cambiar("limiteCredito", e.target.value)}
              className="rounded border px-2 py-1"
            />
          </Campo>
        )}
      </div>
      {errores[""] && <p className="text-red-700">{errores[""]}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={enviando} className="rounded border bg-gray-100 px-3 py-1 disabled:opacity-50">
          {enviando ? "Guardando…" : "Crear y seleccionar"}
        </button>
        <button type="button" onClick={onCancelar} disabled={enviando} className="rounded border px-3 py-1">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Campo({ etiqueta, error, children }: { etiqueta: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      {etiqueta}
      {children}
      {error && (
        <span role="alert" className="text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}
