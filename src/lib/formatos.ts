/**
 * Módulo ÚNICO de formatos locales (consigna, secciones 8 y 10.6).
 *
 * Los componentes nunca formatean por su cuenta: llaman a estas funciones.
 * Todas son deterministas: el resultado no depende del navegador, del sistema
 * operativo ni de la zona horaria de la máquina, por lo que el servidor y el
 * cliente muestran exactamente el mismo texto.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { COMERCIO } from "@/config/comercio";
import type { TipoDocumento } from "@/db/schema"; // solo el tipo; no carga código del servidor

import { partesEnArgentina, type FechaEntrada } from "./fechas";
import { normalizarDocumento } from "./normalizacion";

/** Agrega separador de miles con punto: "1234567" → "1.234.567". */
function separarMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Importe en centavos → pesos con formato argentino (regla 10).
 * 1234550 → "$ 12.345,50" · 0 → "$ 0,00" · -50 → "-$ 0,50"
 *
 * Se calcula con aritmética entera (sin coma flotante ni Intl) para que el
 * resultado sea idéntico en cualquier entorno.
 */
export function formatearMoneda(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError("El importe debe ser un número entero de centavos.");
  }
  const signo = centavos < 0 ? "-" : "";
  const absoluto = Math.abs(centavos);
  const pesos = separarMiles(String(Math.trunc(absoluto / 100)));
  const resto = String(absoluto % 100).padStart(2, "0");
  return `${signo}${COMERCIO.simboloMoneda} ${pesos},${resto}`;
}

/** Fecha en hora de Argentina como dd/mm/aaaa: "2026-10-29T18:24:00Z" → "29/10/2026". */
export function formatearFecha(fecha: FechaEntrada): string {
  const { dia, mes, anio } = partesEnArgentina(fecha);
  return `${dia}/${mes}/${anio}`;
}

/** Fecha y hora de Argentina (24 h): "2026-10-29T18:24:00Z" → "29/10/2026 15:24". */
export function formatearFechaHora(fecha: FechaEntrada): string {
  const { dia, mes, anio, hora, minuto } = partesEnArgentina(fecha);
  return `${dia}/${mes}/${anio} ${hora}:${minuto}`;
}

/**
 * Documento para mostrar:
 * DNI  "28456123"    → "28.456.123"
 * CUIT "20284561234" → "20-28456123-4"
 * Si el número no tiene la cantidad de dígitos esperada, se devuelve sin cambios.
 */
export function formatearDocumento(tipo: TipoDocumento, numero: string): string {
  const digitos = normalizarDocumento(numero);
  if (tipo === "DNI" && /^\d{6,8}$/.test(digitos)) {
    return separarMiles(digitos);
  }
  if (tipo === "CUIT" && /^\d{11}$/.test(digitos)) {
    return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
  }
  return numero;
}

/** Punto de venta (4 dígitos) y número (8 dígitos): (1, 1233) → "0001-00001233". */
function formatearNumeracion(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

/** Número de factura (regla 4): (1, 1) → "0001-00000001". */
export function formatearNumeroFactura(puntoVenta: number, numero: number): string {
  return formatearNumeracion(puntoVenta, numero);
}

/** Número de recibo, con numeración propia (regla 4): (1, 1) → "R 0001-00000001". */
export function formatearNumeroRecibo(puntoVenta: number, numero: number): string {
  return `R ${formatearNumeracion(puntoVenta, numero)}`;
}
