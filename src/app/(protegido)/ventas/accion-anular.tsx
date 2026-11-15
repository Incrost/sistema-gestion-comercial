"use client";

/**
 * Acción provisional de anulación de una factura (RF-V9). Solo se muestra al
 * administrador y con la factura emitida; aun así, quien decide el permiso es
 * el servidor (POST /api/facturas/{id}/anulacion responde 403 al vendedor).
 *
 * Pide el motivo y una confirmación explícita antes de enviar (sección 8:
 * confirmación de acciones irreversibles). Valida con el mismo esquema que
 * el servidor y muestra el mensaje de la API si se rechaza (p. ej. 409
 * FACTURA_ANULADA o la decisión temporal C1).
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ErrorDeApi, erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { esquemaAnulacionFactura, MOTIVO_ANULACION_MAXIMO } from "@/lib/validacion-facturas";
import type { FacturaPublica } from "@/servicios/facturas";

type Props = { facturaId: number; numeroFormateado: string };

export function AccionAnular({ facturaId, numeroFormateado }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    const validacion = esquemaAnulacionFactura.safeParse({ motivo });
    if (!validacion.success) {
      setError(erroresDeZod(validacion.error).motivo ?? "El motivo es inválido.");
      return;
    }
    if (!window.confirm(`¿Confirma la anulación de la factura ${numeroFormateado}? Esta acción no se puede deshacer.`)) {
      return;
    }
    setEnviando(true);
    try {
      await llamarApi<FacturaPublica>(`/api/facturas/${facturaId}/anulacion`, {
        method: "POST",
        body: JSON.stringify(validacion.data),
      });
      setAbierto(false);
      setMotivo("");
      router.refresh();
    } catch (e) {
      setError(e instanceof ErrorDeApi ? (e.campos.motivo ?? e.message) : (e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="rounded border border-red-700 px-2 py-0.5 text-red-700 print:hidden">
        Anular
      </button>
    );
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-2 rounded border p-2 text-sm print:hidden">
      <label className="flex flex-col gap-1">
        Motivo de la anulación de {numeroFormateado}
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={MOTIVO_ANULACION_MAXIMO}
          rows={2}
          className="rounded border px-2 py-1"
          aria-invalid={error !== null}
        />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={enviando} className="rounded border border-red-700 px-2 py-0.5 text-red-700">
          {enviando ? "Anulando…" : "Confirmar anulación"}
        </button>
        <button
          type="button"
          disabled={enviando}
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          className="rounded border px-2 py-0.5"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
