"use client";

/**
 * Registro de un pago (RF-C5). Ambos roles.
 *
 * El importe se escribe en pesos con formato argentino ("5.000,50") y se
 * convierte a centavos con pesosACentavos() (regla 10). Valida con el MISMO
 * esquema que el servidor (esquemaAltaPago) y llama a la API REST. Que el
 * pago no supere la deuda (regla 8) lo decide el servidor; aquí solo se
 * adelanta el aviso junto al campo. El resultado se informa con un aviso
 * temporal que ofrece abrir el recibo.
 */
import { ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, propsCampo } from "@/components/formularios/form-field";
import { MoneyField } from "@/components/formularios/money-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useEnvio } from "@/hooks/usar-envio";
import { erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { formatearMoneda } from "@/lib/formatos";
import { pesosACentavos } from "@/lib/importes";
import { esquemaAltaPago, ETIQUETAS_MEDIO_PAGO, MEDIOS_PAGO, type MedioPago } from "@/lib/validacion-pagos";
import type { PagoPublico } from "@/servicios/pagos";

export function FormularioPago({ clienteId, saldo }: { clienteId: number; saldo: number }) {
  const router = useRouter();
  const [importe, setImporte] = useState("");
  const [medio, setMedio] = useState<MedioPago>(MEDIOS_PAGO[0]);
  const [observacion, setObservacion] = useState("");
  const [ultimo, setUltimo] = useState<PagoPublico | null>(null);
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const centavos = pesosACentavos(importe);
    if (centavos === null) {
      setErrores({ importe: "Ingrese un importe válido, por ejemplo 5.000,50." });
      return;
    }
    const validacion = esquemaAltaPago.safeParse({ importe: centavos, medio, observacion });
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    if (centavos > saldo) {
      setErrores({ importe: `No puede superar la deuda (${formatearMoneda(saldo)}).` });
      return;
    }
    const pago = await ejecutar(
      () => llamarApi<PagoPublico>(`/api/clientes/${clienteId}/pagos`, { method: "POST", body: JSON.stringify(validacion.data) }),
      {
        exito: (p) => `Pago registrado: ${p.numeroRecibo}. Saldo del cliente: ${formatearMoneda(p.saldoCliente)}.`,
        opcionesExito: (p) => ({
          id: `pago-${clienteId}`,
          accion: { etiqueta: "Ver recibo", alHacer: () => router.push(`/clientes/recibos/${p.id}`) },
        }),
        idError: `pago-${clienteId}`,
      },
    );
    if (!pago) return;
    setUltimo(pago);
    setImporte("");
    setObservacion("");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <div className="flex items-baseline justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-warning-strong">
        <span className="text-sm">Deuda actual</span>
        <span className="text-lg font-semibold tabular-nums">{formatearMoneda(saldo)}</span>
      </div>

      <MoneyField id="pago-importe" etiqueta="Importe" valor={importe} onCambiar={setImporte} placeholder="5.000,00" error={errores.importe} />

      <FormField id="pago-medio" etiqueta="Medio de pago" error={errores.medio}>
        <NativeSelect {...propsCampo("pago-medio", errores.medio)} value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)} className="w-full">
          {MEDIOS_PAGO.map((m) => (
            <NativeSelectOption key={m} value={m}>
              {ETIQUETAS_MEDIO_PAGO[m]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>

      <FormField id="pago-observacion" etiqueta="Observación (opcional)" error={errores.observacion}>
        <Input {...propsCampo("pago-observacion", errores.observacion)} value={observacion} onChange={(e) => setObservacion(e.target.value)} />
      </FormField>

      <Button type="submit" disabled={enviando} className="w-full">
        {enviando ? "Registrando…" : "Registrar pago"}
      </Button>

      {ultimo && (
        <Button asChild variant="link" className="h-auto justify-start p-0">
          <Link href={`/clientes/recibos/${ultimo.id}`}>
            <ReceiptTextIcon aria-hidden />
            Ver el último recibo ({ultimo.numeroRecibo})
          </Link>
        </Button>
      )}
    </form>
  );
}
