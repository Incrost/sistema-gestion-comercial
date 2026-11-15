"use client";

/**
 * Formulario provisional para registrar un pago (RF-C5). Ambos roles.
 *
 * El importe se escribe en pesos con formato argentino ("5.000,50") y se
 * convierte a centavos con pesosACentavos() (regla 10). Valida con el MISMO
 * esquema que el servidor (esquemaAltaPago) y llama a la API REST. Que el
 * pago no supere la deuda (regla 8) lo decide el servidor; aquí solo se
 * adelanta el aviso.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ErrorDeApi, erroresDeZod, llamarApi, type ErroresCampo } from "@/lib/cliente-api";
import { formatearMoneda } from "@/lib/formatos";
import { pesosACentavos } from "@/lib/importes";
import { esquemaAltaPago, ETIQUETAS_MEDIO_PAGO, MEDIOS_PAGO, type MedioPago } from "@/lib/validacion-pagos";
import type { PagoPublico } from "@/servicios/pagos";

export function FormularioPago({ clienteId, saldo }: { clienteId: number; saldo: number }) {
  const router = useRouter();
  const [importe, setImporte] = useState("");
  const [medio, setMedio] = useState<MedioPago>(MEDIOS_PAGO[0]);
  const [observacion, setObservacion] = useState("");
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [error, setError] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState<PagoPublico | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setRegistrado(null);
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
    setErrores({});
    setEnviando(true);
    try {
      const pago = await llamarApi<PagoPublico>(`/api/clientes/${clienteId}/pagos`, {
        method: "POST",
        body: JSON.stringify(validacion.data),
      });
      setRegistrado(pago);
      setImporte("");
      setObservacion("");
      router.refresh();
    } catch (e) {
      if (e instanceof ErrorDeApi) {
        setErrores(e.campos);
        setError(e.message);
      } else {
        setError("Ocurrió un error inesperado.");
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex w-full max-w-md flex-col gap-3 rounded border p-4" noValidate>
      <h3 className="font-semibold">Registrar pago</h3>
      <p className="text-sm">Deuda actual: {formatearMoneda(saldo)}</p>

      <label className="flex flex-col gap-1 text-sm">
        Importe ($)
        <input
          className="rounded border px-2 py-1"
          inputMode="decimal"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          placeholder="5.000,00"
          aria-invalid={Boolean(errores.importe)}
        />
        {errores.importe && <span className="text-red-700">{errores.importe}</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Medio de pago
        <select className="rounded border px-2 py-1" value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
          {MEDIOS_PAGO.map((m) => (
            <option key={m} value={m}>
              {ETIQUETAS_MEDIO_PAGO[m]}
            </option>
          ))}
        </select>
        {errores.medio && <span className="text-red-700">{errores.medio}</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Observación (opcional)
        <input className="rounded border px-2 py-1" value={observacion} onChange={(e) => setObservacion(e.target.value)} />
        {errores.observacion && <span className="text-red-700">{errores.observacion}</span>}
      </label>

      <button type="submit" disabled={enviando} className="w-fit rounded border px-3 py-1 font-medium disabled:opacity-50">
        {enviando ? "Registrando…" : "Registrar pago"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {registrado && (
        <p role="status" className="text-sm text-green-800">
          Pago registrado: {registrado.numeroRecibo}. Saldo del cliente: {formatearMoneda(registrado.saldoCliente)}.{" "}
          <Link href={`/clientes/recibos/${registrado.id}`} className="underline">
            Ver recibo
          </Link>
        </p>
      )}
    </form>
  );
}
