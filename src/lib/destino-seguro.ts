/**
 * Destino al que se vuelve después de iniciar sesión (`/login?desde=/ventas`).
 *
 * Solo se aceptan rutas internas: un valor como `https://otro.sitio` o
 * `//otro.sitio` permitiría usar el login para redirigir a un sitio ajeno
 * (redirección abierta). Ante cualquier duda se vuelve al inicio.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
export function destinoSeguro(desde: string | null | undefined): string {
  if (!desde || !desde.startsWith("/") || desde.startsWith("//") || desde.includes("\\")) {
    return "/";
  }
  if (desde === "/login" || desde.startsWith("/login?") || desde.startsWith("/api/")) {
    return "/";
  }
  return desde;
}
