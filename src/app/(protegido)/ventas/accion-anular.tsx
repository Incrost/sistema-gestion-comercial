"use client";

/**
 * Anulación de una factura (RF-V9). Solo se muestra al administrador y con la
 * factura emitida; aun así, quien decide el permiso es el servidor
 * (POST /api/facturas/{id}/anulacion responde 403 al vendedor).
 *
 * Se confirma en un AlertDialog que explica las consecuencias y pide el
 * motivo (sección 8: confirmación de acciones irreversibles). El motivo se
 * valida con el mismo esquema que el servidor y su error queda junto al
 * campo; el resultado se informa con un aviso temporal.
 */
import { BanIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField, propsCampo } from "@/components/formularios/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { avisos } from "@/lib/avisos";
import { ErrorDeApi, erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { esquemaAnulacionFactura, MOTIVO_ANULACION_MAXIMO } from "@/lib/validacion-facturas";
import type { FacturaPublica } from "@/servicios/facturas";

type Props = { facturaId: number; numeroFormateado: string; compacto?: boolean };

export function AccionAnular({ facturaId, numeroFormateado, compacto = false }: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | undefined>();
  const idCampo = `motivo-anulacion-${facturaId}`;

  async function anular(): Promise<boolean> {
    setError(undefined);
    const validacion = esquemaAnulacionFactura.safeParse({ motivo });
    if (!validacion.success) {
      setError(erroresDeZod(validacion.error).motivo ?? "El motivo es inválido.");
      return false;
    }
    try {
      await llamarApi<FacturaPublica>(`/api/facturas/${facturaId}/anulacion`, {
        method: "POST",
        body: JSON.stringify(validacion.data),
      });
    } catch (e) {
      if (e instanceof ErrorDeApi && e.campos.motivo) {
        setError(e.campos.motivo);
      } else {
        avisos.error((e as Error).message, { id: `anulacion-${facturaId}` });
      }
      return false;
    }
    setMotivo("");
    avisos.exito(`Factura ${numeroFormateado} anulada.`, { id: `anulacion-${facturaId}` });
    router.refresh();
    return true;
  }

  return (
    <ConfirmDialog
      titulo={`¿Anular la factura ${numeroFormateado}?`}
      descripcion={
        <ul className="list-disc space-y-1 pl-5">
          <li>La factura quedará marcada como ANULADA y no podrá volver a emitirse.</li>
          <li>Las existencias de sus productos se reponen.</li>
          <li>Si se vendió a cuenta corriente, se registra un crédito por el total en la cuenta del cliente.</li>
        </ul>
      }
      textoConfirmar="Anular factura"
      textoEnviando="Anulando…"
      alConfirmar={anular}
      onAbiertoCambia={(abierto) => {
        if (!abierto) setError(undefined);
      }}
      disparador={
        <Button type="button" variant="destructive-soft" size={compacto ? "sm" : "default"} className="print:hidden">
          <BanIcon aria-hidden />
          Anular
        </Button>
      }
    >
      <FormField id={idCampo} etiqueta="Motivo de la anulación" error={error} ayuda={`Obligatorio. Hasta ${MOTIVO_ANULACION_MAXIMO} caracteres.`}>
        <Textarea
          {...propsCampo(idCampo, error, true)}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={MOTIVO_ANULACION_MAXIMO}
          rows={3}
        />
      </FormField>
    </ConfirmDialog>
  );
}
