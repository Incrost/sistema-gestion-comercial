"use client";

/**
 * Cierre de sesión (RF-U1). Llama a POST /api/auth/logout, que borra la
 * cookie httpOnly (el navegador no puede borrarla por su cuenta), y vuelve al
 * login. El hook lo usa el menú de usuario de la barra superior.
 *
 * Con Cache Components, Next.js no desmonta el layout protegido al ir a
 * /login: lo oculta con <Activity> y conserva su estado. Sin reiniciar
 * `cerrando`, al volver a ingresar en la misma pestaña el menú aparecía ya en
 * «Cerrando sesión…» y deshabilitado. La limpieza de useLayoutEffect corre
 * cuando el componente se oculta, así que el estado vuelve a false.
 */
import { useRouter } from "next/navigation";
import { useLayoutEffect, useState } from "react";

export function useCerrarSesion() {
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);

  // Al ocultarse (o desmontarse) el layout, el cierre en curso deja de existir.
  useLayoutEffect(() => () => setCerrando(false), []);

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
