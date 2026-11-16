"use client";

/**
 * Formulario de inicio de sesión. Consume POST /api/auth/login: la cookie de
 * sesión la deja el servidor (httpOnly); aquí no se guarda nada en
 * localStorage ni sessionStorage. El error queda visible dentro del
 * formulario (no es una notificación temporal) hasta el próximo intento.
 *
 * La contraseña usa el mismo PasswordField que /perfil: oculta por defecto y
 * con un botón para mostrarla u ocultarla que no cambia el valor ni agrega
 * nada a lo que se envía (el cuerpo es siempre { email, password }).
 *
 * Con Cache Components, /login queda oculto con <Activity> (no se desmonta)
 * mientras se usa el área protegida. Al ocultarse se cancela el envío en
 * curso y el formulario vuelve al estado inicial (ver estado-login.ts): al
 * cerrar sesión aparece habilitado, en «Ingresar», sin correo, contraseña ni
 * errores anteriores y con la contraseña oculta.
 */
import { CircleAlertIcon, LogInIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useReducer, useRef, type FormEvent } from "react";

import { FormField } from "@/components/formularios/form-field";
import { PasswordField } from "@/components/formularios/password-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RespuestaError } from "@/lib/api-error";

import { ESTADO_INICIAL_LOGIN, reducirLogin } from "./estado-login";

/** Cuerpo de POST /api/auth/login: únicamente email y password. */
export function cuerpoLogin(datos: FormData) {
  return JSON.stringify({ email: datos.get("email"), password: datos.get("password") });
}

export function FormularioLogin({ destino }: { destino: string }) {
  const router = useRouter();
  const [estado, despachar] = useReducer(reducirLogin, ESTADO_INICIAL_LOGIN);
  const { email, password, error, enviando, intento, generacion } = estado;
  /** Envío en curso; su identidad identifica el intento (null = ninguno). */
  const enCurso = useRef<AbortController | null>(null);

  // Al ocultarse (Activity) o desmontarse: se cancela el envío pendiente, una
  // respuesta tardía ya no puede tocar el estado y el formulario se reinicia.
  useLayoutEffect(
    () => () => {
      enCurso.current?.abort();
      enCurso.current = null;
      despachar({ tipo: "reiniciar" });
    },
    [],
  );

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enCurso.current) return; // doble envío
    const controlador = new AbortController();
    enCurso.current = controlador;
    const esteIntento = intento + 1;
    despachar({ tipo: "enviar" });

    /** Reactiva el formulario con el error, solo si este intento sigue vigente. */
    const fallar = (mensaje: string) => {
      if (enCurso.current !== controlador) return;
      enCurso.current = null;
      despachar({ tipo: "fallo", intento: esteIntento, mensaje });
    };

    const datos = new FormData(evento.currentTarget);
    try {
      const respuesta = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cuerpoLogin(datos),
        signal: controlador.signal,
      });
      if (enCurso.current !== controlador) return; // cancelado al ocultarse
      if (respuesta.ok) {
        // El botón sigue bloqueado mientras se navega; al ocultarse /login, el
        // reinicio lo deja otra vez en «Ingresar».
        router.replace(destino);
        router.refresh();
        return;
      }
      const cuerpo = (await respuesta.json()) as RespuestaError;
      fallar(cuerpo.error.message);
    } catch {
      fallar("No fue posible comunicarse con el servidor. Intente nuevamente.");
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate aria-describedby={error ? "error-login" : undefined}>
      <FormField id="login-email" etiqueta="Correo electrónico">
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => despachar({ tipo: "email", valor: e.target.value })}
          aria-invalid={error ? true : undefined}
          className="h-10"
        />
      </FormField>
      <PasswordField
        key={generacion}
        id="login-password"
        etiqueta="Contraseña"
        name="password"
        valor={password}
        onCambiar={(valor) => despachar({ tipo: "password", valor })}
        autoComplete="current-password"
        required
        aria-invalid={error ? true : undefined}
        className="h-10"
      />
      {error && (
        <Alert variant="destructive" id="error-login">
          <CircleAlertIcon aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" disabled={enviando} className="mt-1 h-11 w-full">
        <LogInIcon aria-hidden />
        {enviando ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
