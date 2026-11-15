"use client";

/**
 * Alta rápida de cliente desde Nueva venta (RF-V2 con RF-C2), en una ventana
 * modal (Dialog de shadcn/ui: atrapa el foco y se cierra con Escape).
 *
 * Usa la MISMA ruta que el alta normal, POST /api/clientes, con todos los
 * campos de RF-C2. Valida antes con el mismo esquema del servidor
 * (prepararAltaRapida) y muestra junto a cada campo los errores que devuelva
 * la API (p. ej. 409 DOCUMENTO_DUPLICADO en el número de documento).
 * La venta en curso no se toca: al crear el cliente, la pantalla lo
 * selecciona y conserva los ítems.
 */
import { CircleAlertIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ErrorCampo, FormField, propsCampo } from "@/components/formularios/form-field";
import { MoneyField } from "@/components/formularios/money-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TIPOS_DOCUMENTO, type TipoDocumento } from "@/db/schema";
import { ALTA_RAPIDA_INICIAL, prepararAltaRapida, type ValoresAltaRapida } from "@/lib/borrador-venta";
import { ErrorDeApi, llamarApi, type ErroresCampo } from "@/lib/cliente-api";
import type { ClientePublico } from "@/servicios/clientes";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  onCreado: (cliente: ClientePublico) => void;
  /** Dónde poner el foco al cerrar la ventana. */
  onFocoAlCerrar?: () => void;
};

export function AltaRapidaCliente({ abierto, onCerrar, onCreado, onFocoAlCerrar }: Props) {
  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && onCerrar()}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(e) => {
          if (onFocoAlCerrar) {
            e.preventDefault();
            onFocoAlCerrar();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Alta rápida de cliente</DialogTitle>
          <DialogDescription>La venta en curso se conserva. Escape cierra esta ventana sin guardar.</DialogDescription>
        </DialogHeader>
        {/* Se monta al abrir: cada apertura empieza con el formulario vacío. */}
        {abierto && <Formulario onCancelar={onCerrar} onCreado={onCreado} />}
      </DialogContent>
    </Dialog>
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
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      {general && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertDescription>{general}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="alta-tipo-doc" etiqueta="Tipo de documento" error={errores.tipoDoc}>
          <NativeSelect
            {...propsCampo("alta-tipo-doc", errores.tipoDoc)}
            value={valores.tipoDoc}
            onChange={(e) => cambiar("tipoDoc", e.target.value as TipoDocumento)}
            className="w-full"
            autoFocus
          >
            {TIPOS_DOCUMENTO.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="alta-nro-doc" etiqueta="Número de documento" error={errores.nroDoc}>
          <Input {...propsCampo("alta-nro-doc", errores.nroDoc)} value={valores.nroDoc} inputMode="numeric" onChange={(e) => cambiar("nroDoc", e.target.value)} />
        </FormField>
        <FormField id="alta-nombre" etiqueta="Nombre o razón social" error={errores.nombre}>
          <Input {...propsCampo("alta-nombre", errores.nombre)} value={valores.nombre} onChange={(e) => cambiar("nombre", e.target.value)} />
        </FormField>
        <FormField id="alta-domicilio" etiqueta="Domicilio (opcional)" error={errores.domicilio}>
          <Input {...propsCampo("alta-domicilio", errores.domicilio)} value={valores.domicilio} onChange={(e) => cambiar("domicilio", e.target.value)} />
        </FormField>
        <FormField id="alta-telefono" etiqueta="Teléfono (opcional)" error={errores.telefono}>
          <Input {...propsCampo("alta-telefono", errores.telefono)} value={valores.telefono} type="tel" onChange={(e) => cambiar("telefono", e.target.value)} />
        </FormField>
        <FormField id="alta-email" etiqueta="Email (opcional)" error={errores.email}>
          <Input {...propsCampo("alta-email", errores.email)} value={valores.email} type="email" onChange={(e) => cambiar("email", e.target.value)} />
        </FormField>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="alta-cuenta-corriente"
              checked={valores.cuentaCorriente}
              onCheckedChange={(v) => cambiar("cuentaCorriente", v === true)}
            />
            <Label htmlFor="alta-cuenta-corriente">Habilitado para cuenta corriente</Label>
          </div>
          {errores.cuentaCorriente && <ErrorCampo>{errores.cuentaCorriente}</ErrorCampo>}
        </div>
        {valores.cuentaCorriente && (
          <MoneyField
            id="alta-limite"
            etiqueta="Límite de crédito en pesos (vacío = sin límite)"
            valor={valores.limiteCredito}
            onCambiar={(v) => cambiar("limiteCredito", v)}
            error={errores.limiteCredito}
          />
        )}
      </div>
      {errores[""] && <ErrorCampo>{errores[""]}</ErrorCampo>}
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Crear y seleccionar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
