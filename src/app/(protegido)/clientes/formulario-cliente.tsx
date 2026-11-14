"use client";

/**
 * Formulario provisional de alta y edición de clientes (RF-C2). Ambos roles.
 *
 * Valida con los MISMOS esquemas de Zod que el servidor
 * (src/lib/validacion-clientes.ts) y luego llama a la API REST. La decisión
 * final (permisos, documento único, saldo pendiente) la toma el servicio.
 * El límite de crédito se escribe en pesos y se envía en centavos; vacío =
 * sin límite. El saldo NO se edita: se calcula con la cuenta corriente.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { TIPOS_DOCUMENTO, type TipoDocumento } from "@/db/schema";
import { ErrorDeApi, erroresDeZod, llamarApi, type ErroresCampo } from "@/lib/cliente-api";
import { centavosATextoEditable, pesosACentavos } from "@/lib/importes";
import { esquemaAltaCliente, esquemaEdicionCliente } from "@/lib/validacion-clientes";
import type { ClientePublico } from "@/servicios/clientes";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

/** Si se indica `cliente`, el formulario lo edita; si no, da de alta uno nuevo. */
export function FormularioCliente({ cliente }: { cliente?: ClientePublico }) {
  const router = useRouter();
  const edicion = cliente !== undefined;
  const [valores, setValores] = useState({
    tipoDoc: (cliente?.tipoDoc ?? "DNI") as TipoDocumento,
    nroDoc: cliente?.nroDoc ?? "",
    nombre: cliente?.nombre ?? "",
    domicilio: cliente?.domicilio ?? "",
    telefono: cliente?.telefono ?? "",
    email: cliente?.email ?? "",
    cuentaCorriente: cliente?.cuentaCorriente ?? false,
    limiteCredito: cliente?.limiteCredito != null ? centavosATextoEditable(cliente.limiteCredito) : "",
  });
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = <K extends keyof typeof valores>(campo: K, valor: (typeof valores)[K]) =>
    setValores((v) => ({ ...v, [campo]: valor }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setAviso(null);

    let limiteCredito: number | null = null;
    if (valores.cuentaCorriente && valores.limiteCredito.trim() !== "") {
      limiteCredito = pesosACentavos(valores.limiteCredito);
      if (limiteCredito === null) {
        setErrores({ limiteCredito: "Ingrese un importe válido, por ejemplo 150000,00." });
        return;
      }
    }
    const datos = {
      tipoDoc: valores.tipoDoc,
      nroDoc: valores.nroDoc,
      nombre: valores.nombre,
      domicilio: valores.domicilio,
      telefono: valores.telefono,
      email: valores.email,
      cuentaCorriente: valores.cuentaCorriente,
      limiteCredito,
    };

    // En la edición se envían solo los campos que cambiaron.
    let cuerpo: Record<string, unknown> = datos;
    if (edicion) {
      const actual: Record<string, unknown> = {
        tipoDoc: cliente.tipoDoc,
        nroDoc: cliente.nroDoc,
        nombre: cliente.nombre,
        domicilio: cliente.domicilio ?? "",
        telefono: cliente.telefono ?? "",
        email: cliente.email ?? "",
        cuentaCorriente: cliente.cuentaCorriente,
        limiteCredito: cliente.limiteCredito,
      };
      cuerpo = Object.fromEntries(Object.entries(datos).filter(([campo, valor]) => valor !== actual[campo]));
      // El documento se envía completo para que tipo y número se validen juntos.
      if ("tipoDoc" in cuerpo || "nroDoc" in cuerpo) Object.assign(cuerpo, { tipoDoc: datos.tipoDoc, nroDoc: datos.nroDoc });
      if (Object.keys(cuerpo).length === 0) {
        setAviso({ tipo: "ok", texto: "No hay cambios para guardar." });
        return;
      }
    }

    const validacion = (edicion ? esquemaEdicionCliente : esquemaAltaCliente).safeParse(cuerpo);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    setErrores({});
    setEnviando(true);
    try {
      const guardado = await llamarApi<ClientePublico>(edicion ? `/api/clientes/${cliente.id}` : "/api/clientes", {
        method: edicion ? "PATCH" : "POST",
        body: JSON.stringify(cuerpo),
      });
      if (edicion) {
        setAviso({ tipo: "ok", texto: "Cliente actualizado." });
        router.refresh();
      } else {
        router.push(`/clientes/${guardado.id}`);
      }
    } catch (e) {
      if (e instanceof ErrorDeApi) setErrores(e.campos);
      setAviso({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded border p-4 text-sm">
      <h2 className="text-lg font-semibold">{edicion ? "Editar cliente" : "Nuevo cliente"}</h2>
      {aviso && (
        <p role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {aviso.texto}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo de documento" error={errores.tipoDoc}>
          <select value={valores.tipoDoc} onChange={(e) => cambiar("tipoDoc", e.target.value as TipoDocumento)} className="rounded border px-2 py-1">
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Número de documento (con o sin puntos y guiones)" error={errores.nroDoc}>
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
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={valores.cuentaCorriente} onChange={(e) => cambiar("cuentaCorriente", e.target.checked)} />
          Habilitado para cuenta corriente
          {errores.cuentaCorriente && <span className="text-red-700">{errores.cuentaCorriente}</span>}
        </label>
        {valores.cuentaCorriente && (
          <Campo etiqueta="Límite de crédito en pesos (vacío = sin límite)" error={errores.limiteCredito}>
            <input value={valores.limiteCredito} inputMode="decimal" onChange={(e) => cambiar("limiteCredito", e.target.value)} className="rounded border px-2 py-1" />
          </Campo>
        )}
      </div>
      {errores[""] && <p className="text-red-700">{errores[""]}</p>}
      <button type="submit" disabled={enviando} className="w-fit rounded border px-3 py-1 disabled:opacity-50">
        {enviando ? "Guardando…" : edicion ? "Guardar cambios" : "Crear cliente"}
      </button>
    </form>
  );
}

/** Baja o reactivación lógica (RF-C7). Solo se muestra al administrador. */
export function BotonEstadoCliente({ cliente }: { cliente: ClientePublico }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);

  async function cambiar() {
    if (
      cliente.activo &&
      !window.confirm(`¿Confirma que desea dar de baja a ${cliente.nombre}? Conservará su historial, pero no podrá usarse en ventas.`)
    ) {
      return;
    }
    setEnviando(true);
    try {
      await llamarApi(`/api/clientes/${cliente.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !cliente.activo }),
      });
      setAviso({ tipo: "ok", texto: cliente.activo ? "Cliente dado de baja." : "Cliente reactivado." });
      router.refresh();
    } catch (e) {
      setAviso({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" onClick={cambiar} disabled={enviando} className="rounded border px-3 py-1 disabled:opacity-50">
        {cliente.activo ? "Dar de baja" : "Reactivar"}
      </button>
      {aviso && (
        <span role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {aviso.texto}
        </span>
      )}
    </div>
  );
}

function Campo({ etiqueta, error, children }: { etiqueta: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      {etiqueta}
      {children}
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}
