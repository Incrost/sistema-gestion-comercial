"use client";

/**
 * Alta y edición de clientes (RF-C2), en una ventana modal. Ambos roles.
 * Baja y reactivación lógica (RF-C7), solo administrador, con confirmación.
 *
 * Valida con los MISMOS esquemas de Zod que el servidor
 * (src/lib/validacion-clientes.ts) y luego llama a la API REST. La decisión
 * final (permisos, documento único, saldo pendiente) la toma el servicio.
 * El límite de crédito se escribe en pesos y se envía en centavos; vacío =
 * sin límite. El saldo NO se edita: se calcula con la cuenta corriente.
 */
import { ArchiveRestoreIcon, PencilIcon, UserPlusIcon, UserXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorCampo, FormField, propsCampo } from "@/components/formularios/form-field";
import { MoneyField } from "@/components/formularios/money-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TIPOS_DOCUMENTO, type TipoDocumento } from "@/db/schema";
import { useEnvio } from "@/hooks/usar-envio";
import { avisos } from "@/lib/avisos";
import { erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { centavosATextoEditable, pesosACentavos } from "@/lib/importes";
import { esquemaAltaCliente, esquemaEdicionCliente } from "@/lib/validacion-clientes";
import type { ClientePublico } from "@/servicios/clientes";

/** Botón + ventana modal. Si se indica `cliente`, lo edita; si no, da de alta uno nuevo. */
export function DialogoCliente({ cliente }: { cliente?: ClientePublico }) {
  const [abierto, setAbierto] = useState(false);
  const edicion = cliente !== undefined;
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        {edicion ? (
          <Button variant="outline">
            <PencilIcon aria-hidden />
            Editar
          </Button>
        ) : (
          <Button>
            <UserPlusIcon aria-hidden />
            Nuevo cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{edicion ? `Editar ${cliente.nombre}` : "Nuevo cliente"}</DialogTitle>
          <DialogDescription>El saldo no se edita: surge de los movimientos de la cuenta corriente.</DialogDescription>
        </DialogHeader>
        {abierto && <FormularioCliente cliente={cliente} onListo={() => setAbierto(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FormularioCliente({ cliente, onListo }: { cliente?: ClientePublico; onListo: () => void }) {
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
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  const cambiar = <K extends keyof typeof valores>(campo: K, valor: (typeof valores)[K]) => setValores((v) => ({ ...v, [campo]: valor }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();

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
        avisos.info("No hay cambios para guardar.", { id: "cliente-sin-cambios" });
        return;
      }
    }

    const validacion = (edicion ? esquemaEdicionCliente : esquemaAltaCliente).safeParse(cuerpo);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    const guardado = await ejecutar(
      () =>
        llamarApi<ClientePublico>(edicion ? `/api/clientes/${cliente.id}` : "/api/clientes", {
          method: edicion ? "PATCH" : "POST",
          body: JSON.stringify(cuerpo),
        }),
      { exito: (c) => (edicion ? "Cliente actualizado." : `Se creó el cliente ${c.nombre}.`), idError: "cliente-error" },
    );
    if (!guardado) return;
    onListo();
    if (edicion) router.refresh();
    else router.push(`/clientes/${guardado.id}`);
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="cliente-tipo-doc" etiqueta="Tipo de documento" error={errores.tipoDoc}>
          <NativeSelect
            {...propsCampo("cliente-tipo-doc", errores.tipoDoc)}
            value={valores.tipoDoc}
            onChange={(e) => cambiar("tipoDoc", e.target.value as TipoDocumento)}
            className="w-full"
          >
            {TIPOS_DOCUMENTO.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="cliente-nro-doc" etiqueta="Número de documento" ayuda="Con o sin puntos y guiones." error={errores.nroDoc}>
          <Input {...propsCampo("cliente-nro-doc", errores.nroDoc, true)} value={valores.nroDoc} inputMode="numeric" onChange={(e) => cambiar("nroDoc", e.target.value)} />
        </FormField>
        <FormField id="cliente-nombre" etiqueta="Nombre o razón social" error={errores.nombre} className="sm:col-span-2">
          <Input {...propsCampo("cliente-nombre", errores.nombre)} value={valores.nombre} onChange={(e) => cambiar("nombre", e.target.value)} />
        </FormField>
        <FormField id="cliente-domicilio" etiqueta="Domicilio (opcional)" error={errores.domicilio} className="sm:col-span-2">
          <Input {...propsCampo("cliente-domicilio", errores.domicilio)} value={valores.domicilio} onChange={(e) => cambiar("domicilio", e.target.value)} />
        </FormField>
        <FormField id="cliente-telefono" etiqueta="Teléfono (opcional)" error={errores.telefono}>
          <Input {...propsCampo("cliente-telefono", errores.telefono)} value={valores.telefono} type="tel" onChange={(e) => cambiar("telefono", e.target.value)} />
        </FormField>
        <FormField id="cliente-email" etiqueta="Email (opcional)" error={errores.email}>
          <Input {...propsCampo("cliente-email", errores.email)} value={valores.email} type="email" onChange={(e) => cambiar("email", e.target.value)} />
        </FormField>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <div className="flex items-center gap-2">
            <Checkbox id="cliente-cuenta" checked={valores.cuentaCorriente} onCheckedChange={(v) => cambiar("cuentaCorriente", v === true)} />
            <Label htmlFor="cliente-cuenta">Habilitado para cuenta corriente</Label>
          </div>
          {errores.cuentaCorriente && <ErrorCampo>{errores.cuentaCorriente}</ErrorCampo>}
        </div>
        {valores.cuentaCorriente && (
          <MoneyField
            id="cliente-limite"
            etiqueta="Límite de crédito"
            ayuda="En pesos. Vacío = sin límite."
            valor={valores.limiteCredito}
            onCambiar={(v) => cambiar("limiteCredito", v)}
            error={errores.limiteCredito}
          />
        )}
      </div>
      {errores[""] && <ErrorCampo>{errores[""]}</ErrorCampo>}
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" onClick={onListo} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : edicion ? "Guardar cambios" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Baja o reactivación lógica (RF-C7). Solo se muestra al administrador. */
export function BotonEstadoCliente({ cliente }: { cliente: ClientePublico }) {
  const router = useRouter();

  async function cambiar(): Promise<boolean> {
    try {
      await llamarApi(`/api/clientes/${cliente.id}`, { method: "PATCH", body: JSON.stringify({ activo: !cliente.activo }) });
    } catch (e) {
      avisos.error((e as Error).message, { id: `cliente-estado-${cliente.id}` });
      return true;
    }
    avisos.exito(cliente.activo ? `${cliente.nombre} fue dado de baja.` : `${cliente.nombre} fue reactivado.`, { id: `cliente-estado-${cliente.id}` });
    router.refresh();
    return true;
  }

  if (!cliente.activo) {
    return (
      <ConfirmDialog
        destructivo={false}
        titulo={`¿Reactivar a ${cliente.nombre}?`}
        descripcion="Podrá volver a usarse en ventas y registrar pagos."
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
      titulo={`¿Dar de baja a ${cliente.nombre}?`}
      descripcion="Conservará su historial de facturas y pagos, pero no podrá usarse en ventas. Si tiene saldo pendiente, el sistema no permitirá la baja."
      textoConfirmar="Dar de baja"
      textoEnviando="Dando de baja…"
      alConfirmar={cambiar}
      disparador={
        <Button variant="destructive-soft">
          <UserXIcon aria-hidden />
          Dar de baja
        </Button>
      }
    />
  );
}
