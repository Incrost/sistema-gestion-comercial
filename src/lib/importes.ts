/**
 * Conversión de importes ESCRITOS por el usuario (formato argentino) a
 * centavos enteros, y de centavos al texto editable de un campo (regla 10).
 *
 * La API recibe y devuelve siempre centavos; esta conversión es solo de la
 * interfaz. Se hace con texto y enteros, sin coma flotante.
 * Para MOSTRAR importes se usa formatearMoneda() de ./formatos.ts.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */

/**
 * "12.500,50" → 1250050 · "12500,5" → 1250050 · "$ 100" → 10000.
 * Coma decimal (hasta 2 dígitos); punto solo como separador de miles en
 * grupos de 3. Devuelve null si el texto no es un importe válido
 * (p. ej. "12.5", que es ambiguo).
 */
export function pesosACentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/^\$\s*/, "");
  const coincidencia = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(limpio);
  if (!coincidencia) return null;
  const pesos = Number(coincidencia[1].replaceAll(".", ""));
  const centavos = Number((coincidencia[2] ?? "0").padEnd(2, "0"));
  const total = pesos * 100 + centavos;
  return Number.isSafeInteger(total) ? total : null;
}

/** 1250050 → "12500,50": texto inicial de un campo de importe. */
export function centavosATextoEditable(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const absoluto = Math.abs(centavos);
  return `${signo}${Math.trunc(absoluto / 100)},${String(absoluto % 100).padStart(2, "0")}`;
}
