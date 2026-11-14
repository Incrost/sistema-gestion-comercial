"use client";

/**
 * Formulario de inicio de sesión. Consume POST /api/auth/login: la cookie de
 * sesión la deja el servidor (httpOnly); aquí no se guarda nada en
 * localStorage ni sessionStorage.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
    <form onSubmit={enviar} className="flex flex-col gap-3" noValidate>
      <label className="flex flex-col gap-1 text-sm">
        Correo electrónico
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {enviando ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
