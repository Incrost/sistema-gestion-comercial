/**
 * Utilidades de normalización de datos de entrada.
 *
 * Se usan dentro de los esquemas de Zod (src/lib/validacion.ts), de modo que
 * el formulario y el servidor normalizan exactamente igual, y también en los
 * servicios para buscar (por ejemplo, un documento escrito con puntos).
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */

/** Quita puntos, espacios y guiones: "20-28.456.123-4" → "20284561234". */
export function normalizarDocumento(valor: string): string {
  return valor.replace(/[.\s-]/g, "");
}

/** Quita espacios extremos y reduce los internos a uno: "  Pintura   al  agua " → "Pintura al agua". */
export function normalizarEspacios(valor: string): string {
  return valor.trim().replace(/\s+/g, " ");
}

/** Quita espacios extremos y pasa a minúsculas: " Laura@Correo.TEST " → "laura@correo.test". */
export function normalizarEmail(valor: string): string {
  return valor.trim().toLowerCase();
}
