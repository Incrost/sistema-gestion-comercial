"use client";

/**
 * Formulario de inicio de sesión. Consume POST /api/auth/login: la cookie de
 * sesión la deja el servidor (httpOnly); aquí no se guarda nada en
 * localStorage ni sessionStorage. El error queda visible dentro del
 * formulario (no es una notificación temporal) hasta el próximo intento.
 */
import { CircleAlertIcon, LogInIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField } from "@/components/formularios/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RespuestaError } from "@/lib/api-error";

export function FormularioLogin({ destino }: { destino: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);

    const datos = new FormData(evento.currentTarget);
    try {
      const respuesta = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: datos.get("email"), password: datos.get("password") }),
      });
      if (respuesta.ok) {
        router.replace(destino);
        router.refresh();
        return;
      }
      const cuerpo = (await respuesta.json()) as RespuestaError;
      setError(cuerpo.error.message);
    } catch {
      setError("No fue posible comunicarse con el servidor. Intente nuevamente.");
    }
    setEnviando(false);
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate aria-describedby={error ? "error-login" : undefined}>
      <FormField id="login-email" etiqueta="Correo electrónico">
        <Input id="login-email" name="email" type="email" autoComplete="username" required aria-invalid={error ? true : undefined} />
      </FormField>
      <FormField id="login-password" etiqueta="Contraseña">
        <Input id="login-password" name="password" type="password" autoComplete="current-password" required aria-invalid={error ? true : undefined} />
      </FormField>
      {error && (
        <Alert variant="destructive" id="error-login">
          <CircleAlertIcon aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" disabled={enviando} className="w-full">
        <LogInIcon aria-hidden />
        {enviando ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
