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

// ---------------------------------------------------------------------------
// Aritmética de días de calendario (AAAA-MM-DD)
// ---------------------------------------------------------------------------
// Trabajan sobre el TEXTO del día, no sobre instantes: el cálculo se hace con
// Date.UTC, así que no depende de la zona horaria de la máquina ni del
// servidor. Para pasar de un día a instantes se usa inicioDelDiaEnArgentina().

const DIA_MS = 24 * 60 * 60 * 1000;

/** Valida un día "AAAA-MM-DD" y devuelve sus partes numéricas. */
function partesDelDia(dia: string): { anio: number; mes: number; dia: number } {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!coincidencia) throw new RangeError(`El día «${dia}» no tiene el formato AAAA-MM-DD.`);
  const [anio, mes, d] = coincidencia.slice(1).map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, d));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== d) {
    throw new RangeError(`El día «${dia}» no existe.`);
  }
  return { anio, mes, dia: d };
}

/** Date.UTC → "AAAA-MM-DD" (sin zona horaria). */
function diaDesdeUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Suma (o resta) días de calendario: ("2026-11-01", -1) → "2026-10-31". */
export function sumarDias(dia: string, cantidad: number): string {
  const { anio, mes, dia: d } = partesDelDia(dia);
  return diaDesdeUtc(Date.UTC(anio, mes - 1, d) + cantidad * DIA_MS);
}

/** Primer día del mes del día indicado: "2026-11-15" → "2026-11-01". */
export function primerDiaDelMes(dia: string): string {
  const { anio, mes } = partesDelDia(dia);
  return diaDesdeUtc(Date.UTC(anio, mes - 1, 1));
}

/** Primer día del mes siguiente: "2026-12-15" → "2027-01-01". */
export function primerDiaDelMesSiguiente(dia: string): string {
  const { anio, mes } = partesDelDia(dia);
  return diaDesdeUtc(Date.UTC(anio, mes, 1));
}

/**
 * Lista de `cantidad` días consecutivos que termina en `ultimo` (inclusive),
 * del más antiguo al más reciente: ("2026-11-15", 3) → ["2026-11-13", "2026-11-14", "2026-11-15"].
 */
export function diasHasta(ultimo: string, cantidad: number): string[] {
  return Array.from({ length: cantidad }, (_, i) => sumarDias(ultimo, i - (cantidad - 1)));
}
