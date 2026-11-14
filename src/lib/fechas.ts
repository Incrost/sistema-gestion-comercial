/**
 * Utilidades de fechas en hora de Argentina (consigna, sección 11.1).
 *
 * La base guarda instantes en UTC. Para mostrar una fecha, o para saber a qué
 * día corresponde una venta, hay que convertir explícitamente a la zona
 * America/Argentina/Buenos_Aires: así el resultado no depende de la zona
 * horaria de la computadora ni del servidor (Vercel corre en UTC).
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { COMERCIO } from "@/config/comercio";

/** Instante que se acepta como fecha: Date, texto ISO 8601 o milisegundos. */
export type FechaEntrada = Date | string | number;

export type PartesFecha = {
  anio: string;
  mes: string;
  dia: string;
  hora: string;
  minuto: string;
};

const formateadorPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: COMERCIO.zonaHoraria,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Convierte la entrada en Date y rechaza fechas inválidas. */
export function aFecha(valor: FechaEntrada): Date {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new RangeError("La fecha indicada no es válida.");
  }
  return fecha;
}

/** Año, mes, día, hora y minuto del instante, vistos en hora de Argentina. */
export function partesEnArgentina(valor: FechaEntrada): PartesFecha {
  const partes = formateadorPartes.formatToParts(aFecha(valor));
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    anio: parte("year"),
    mes: parte("month"),
    dia: parte("day"),
    hora: parte("hour"),
    minuto: parte("minute"),
  };
}

/** Día de Argentina al que pertenece un instante, como "AAAA-MM-DD". */
export function diaEnArgentina(valor: FechaEntrada): string {
  const { anio, mes, dia } = partesEnArgentina(valor);
  return `${anio}-${mes}-${dia}`;
}

/**
 * Primer instante de un día de Argentina (filtro `desde`).
 * "2026-10-29" → 2026-10-29T03:00:00.000Z
 */
export function inicioDelDiaEnArgentina(dia: string): Date {
  return aFecha(`${dia}T00:00:00.000${COMERCIO.desfaseUtc}`);
}

/**
 * Primer instante del día SIGUIENTE (límite exclusivo del filtro `hasta`):
 * `fecha >= inicioDelDia(desde) AND fecha < inicioDelDiaSiguiente(hasta)`.
 * "2026-10-29" → 2026-10-30T03:00:00.000Z
 */
export function inicioDelDiaSiguienteEnArgentina(dia: string): Date {
  const inicio = inicioDelDiaEnArgentina(dia);
  return new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
}
