"use client";

/**
 * Cambio de la propia contraseña (RF-U5) mediante PUT /api/auth/password.
 *
 * - Valida con el mismo esquema que el servidor (src/lib/cambio-contrasena.ts)
 *   y envía SOLO { actual, nueva }: la confirmación nunca sale del navegador.
 * - Errores junto a cada campo; los errores generales, con un aviso seguro.
 * - Mientras envía, el botón queda deshabilitado y un candado evita el doble envío.
 * - Las contraseñas solo viven en el estado de este componente: no se guardan
 *   en localStorage, sessionStorage ni en la URL, y no se registran en consola.
 */
import { CircleCheckIcon, KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { PasswordField } from "@/components/formularios/password-field";
import { Button } from "@/components/ui/button";
import { avisos } from "@/lib/avisos";
import {
  CAMPOS_VACIOS,
  camposTrasEnvio,
  crearEnvioUnico,
  DESCRIPCION_EXITO,
  enviarCambioContrasena,
  MENSAJE_EXITO,
  type CamposContrasena,
} from "@/lib/cambio-contrasena";
import type { ErroresCampo } from "@/lib/cliente-api";

const ID_AVISO = "perfil-contrasena";
const sinSuscripcion = () => () => {};

export function FormularioContrasena() {
  const router = useRouter();
  const [campos, setCampos] = useState<CamposContrasena>(CAMPOS_VACIOS);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [enviando, setEnviando] = useState(false);
  const [actualizada, setActualizada] = useState(false);
  // Hasta que React toma el control, el botón queda deshabilitado: así un
  // envío nativo del navegador nunca puede ocurrir.
  const listo = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  // Se incrementa tras un éxito para volver a montar los campos ocultos.
  const [version, setVersion] = useState(0);
  const envio = useRef(crearEnvioUnico());
  const refActual = useRef<HTMLInputElement>(null);
  const refNueva = useRef<HTMLInputElement>(null);
  const refConfirmacion = useRef<HTMLInputElement>(null);

  function cambiar(campo: keyof CamposContrasena, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }));
    setActualizada(false);
    if (errores[campo]) {
      setErrores((e) => {
        const resto = { ...e };
        delete resto[campo];
        return resto;
      });
    }
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    await envio.current.ejecutar(async () => {
      setEnviando(true);
      setActualizada(false);
      try {
        const resultado = await enviarCambioContrasena(campos);
        setCampos(camposTrasEnvio(campos, resultado));
        switch (resultado.tipo) {
          case "exito":
            setErrores({});
            setActualizada(true);
            setVersion((v) => v + 1);
            avisos.exito(MENSAJE_EXITO, { id: ID_AVISO, descripcion: DESCRIPCION_EXITO });
            break;
          case "campos": {
            setErrores(resultado.errores);
            const primero = (["actual", "nueva", "confirmacion"] as const).find((c) => resultado.errores[c]);
            if (primero) ({ actual: refActual, nueva: refNueva, confirmacion: refConfirmacion })[primero].current?.focus();
            break;
          }
          case "sesion":
            // Flujo existente: sin sesión válida se vuelve al login.
            router.replace("/login?desde=/perfil");
            router.refresh();
            break;
          case "error":
            avisos.error(resultado.mensaje, { id: ID_AVISO });
            break;
        }
      } finally {
        setEnviando(false);
      }
    });
  }

  return (
    <form method="post" noValidate onSubmit={enviar} aria-busy={enviando || undefined} className="flex flex-col gap-4">
      <PasswordField
        key={`actual-${version}`}
        ref={refActual}
        id="perfil-actual"
        name="actual"
        etiqueta="Contraseña actual"
        autoComplete="current-password"
        valor={campos.actual}
        onCambiar={(v) => cambiar("actual", v)}
        error={errores.actual}
        readOnly={enviando}
        required
      />
      <PasswordField
        key={`nueva-${version}`}
        ref={refNueva}
        id="perfil-nueva"
        name="nueva"
        etiqueta="Contraseña nueva"
        autoComplete="new-password"
        valor={campos.nueva}
        onCambiar={(v) => cambiar("nueva", v)}
        error={errores.nueva}
        ayuda="Entre 8 y 72 caracteres, distinta de la actual."
        readOnly={enviando}
        required
      />
      <PasswordField
        key={`confirmacion-${version}`}
        ref={refConfirmacion}
        id="perfil-confirmacion"
        name="confirmacion"
        etiqueta="Confirmación de la contraseña nueva"
        autoComplete="new-password"
        valor={campos.confirmacion}
        onCambiar={(v) => cambiar("confirmacion", v)}
        error={errores.confirmacion}
        readOnly={enviando}
        required
      />

      <div role="status" aria-live="polite" className="min-h-0 empty:hidden">
        {actualizada && (
          <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success-strong">
            <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            La contraseña se actualizó correctamente.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" disabled={!listo || enviando} className="w-full sm:w-auto">
          {enviando ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <KeyRoundIcon aria-hidden />}
          {enviando ? "Actualizando…" : "Actualizar contraseña"}
        </Button>
      </div>
    </form>
  );
}
