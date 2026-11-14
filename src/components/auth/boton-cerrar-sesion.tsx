"use client";

/**
 * Botón «Cerrar sesión» (RF-U1). Llama a POST /api/auth/logout, que borra la
 * cookie httpOnly (el navegador no puede borrarla por su cuenta), y vuelve al login.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function BotonCerrarSesion() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function cerrarSesion() {
    setEnviando(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh(); // descarta lo que quedó en caché de la sesión anterior
    }
  }

  return (
    <button
      type="button"
      onClick={cerrarSesion}
      disabled={enviando}
      className="rounded border px-3 py-1 disabled:opacity-50"
    >
      {enviando ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
