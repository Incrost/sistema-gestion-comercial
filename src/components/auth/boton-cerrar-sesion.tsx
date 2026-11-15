"use client";

/**
 * Cierre de sesión (RF-U1). Llama a POST /api/auth/logout, que borra la
 * cookie httpOnly (el navegador no puede borrarla por su cuenta), y vuelve al
 * login. El hook lo usa el menú de usuario de la barra superior.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function useCerrarSesion() {
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);

  async function cerrarSesion() {
    setCerrando(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh(); // descarta lo que quedó en caché de la sesión anterior
    }
  }

  return { cerrando, cerrarSesion };
}
