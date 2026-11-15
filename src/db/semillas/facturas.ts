/**
 * Datos iniciales: facturas, anulaciones y pagos académicos (sección 8,
 * «Datos de prueba»: 50 facturas repartidas en los últimos 30 días; sección
 * 10.7: se crean con los MISMOS servicios que usa la aplicación).
 *
 * Todo pasa por los servicios:
 * - reposiciones previas → registrarMovimientoManual() → moverStock();
 * - facturas → emitirFactura() (número, renglones, stock y débito);
 * - anulaciones → anularFactura() (stock y crédito; respeta la decisión C1);
 * - pagos → registrarPago() (recibo y crédito).
 * Nada se inserta a mano: stock, saldos y numeración cumplen todas las reglas.
 *
 * FECHAS: cada operación se ejecuta dentro de conFechaSimulada()
 * (src/servicios/reloj.ts) con el instante que le corresponde en el plan, en
 * hora de Argentina. Las operaciones se ejecutan en orden cronológico, así
 * los números de factura y de recibo crecen junto con la fecha.
 *
 * DETERMINISMO: el plan es una lista fija (sin azar). Las fechas son
 * relativas al día en que se ejecuta el seed («hace N días, a tal hora»), de
 * modo que siempre caen dentro de los últimos 30 días y siempre hay ventas
 * del día actual. Las del día actual nunca quedan en el futuro: si la hora
 * planificada todavía no llegó, se adelantan (ver construirCronograma()).
 *
 * IDEMPOTENCIA: el conjunto se reconoce por una MARCA en la observación de
 * las reposiciones previas (movimientos_stock.observacion empieza con
 * MARCA_SEED_FACTURAS). Es lo PRIMERO que se graba; si ya existe, el seed no
 * vuelve a crear facturas, pagos ni anulaciones y no consume numeración. Las
 * facturas académicas son las 50 primeras (por número) creadas después de la
 * marca. No se modifica el esquema.
 *
 * Solo servidor (lo usan scripts/seed.ts y las pruebas).
 */
import "server-only";

import { and, asc, eq, gte, inArray, like } from "drizzle-orm";

import { db } from "@/db";
import { clientes, facturas, movimientosStock, productos, type MedioPago, type TipoTarjeta } from "@/db/schema";
import { diaEnArgentina, inicioDelDiaEnArgentina } from "@/lib/fechas";
import { normalizarDocumento } from "@/lib/normalizacion";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { obtenerSaldo } from "@/servicios/cuenta-corriente";
import { anularFactura, emitirFactura } from "@/servicios/facturas";
import { registrarPago } from "@/servicios/pagos";
import { conFechaSimulada } from "@/servicios/reloj";
import { registrarMovimientoManual } from "@/servicios/stock";

// ---------------------------------------------------------------------------
// Constantes del conjunto académico
// ---------------------------------------------------------------------------

/** Marca que identifica el conjunto académico (prefijo de la observación). */
export const MARCA_SEED_FACTURAS = "[seed-academico-v1]";
export const OBSERVACION_REPOSICION = `${MARCA_SEED_FACTURAS} Reposición previa a las facturas de prueba`;
export const CANTIDAD_FACTURAS_ACADEMICAS = 50;
/** Días de la ventana: hoy y los 29 anteriores. */
export const DIAS_VENTANA = 30;

const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

// ---------------------------------------------------------------------------
// Plan determinista
// ---------------------------------------------------------------------------

type Rol = "admin" | "vendedor";
/** [código del producto, cantidad]. */
type ItemPlan = readonly [string, number];

type PagoFacturaPlan =
  /** `redondear`: el cliente entrega el total redondeado hacia arriba a $ 1.000 (hay vuelto). */
  | { forma: "contado"; redondear?: true }
  | { forma: "tarjeta"; tipo: TipoTarjeta; marca: string; ultimos4: string }
  | { forma: "cuenta_corriente" };

export type FacturaPlan = {
  ref: string;
  /** Días antes de hoy (0 = hoy). */
  dia: number;
  /** Hora de Argentina "HH:MM". */
  hora: string;
  vendedor: Rol;
  /** Número de documento del cliente académico; null = consumidor final. */
  cliente: string | null;
  items: readonly ItemPlan[];
  pago: PagoFacturaPlan;
};

export type AnulacionPlan = { factura: string; dia: number; hora: string; motivo: string };

export type PagoCuentaPlan = {
  ref: string;
  cliente: string;
  dia: number;
  hora: string;
  usuario: Rol;
  /** Centavos, o "saldo" para cancelar la deuda completa (pago total). */
  importe: number | "saldo";
  medio: MedioPago;
  observacion: string;
};

/** Reposiciones planificadas antes de la primera venta (llevan la marca). */
export const REPOSICIONES_PLAN: readonly { codigo: string; cantidad: number }[] = [
  { codigo: "EL-003", cantidad: 15 }, // Tomacorriente doble: el catálogo arranca sin stock.
  { codigo: "BU-002", cantidad: 20 }, // Tarugos: la existencia inicial no alcanza para las ventas.
];
/** Momento de las reposiciones: el primer día de la ventana, antes de abrir. */
const REPOSICION_DIA = DIAS_VENTANA - 1;
const REPOSICION_HORA = "08:00";

const MAR = "28.456.123"; // Mariana López — cta. cte., límite $ 400.000
const JUL = "31.204.587"; // Julián Ferreyra — cta. cte., límite $ 150.000
const CON = "30-71000001-1"; // Construcciones del Norte SRL — cta. cte., límite $ 1.500.000
const ROS = "25.890.334"; // Rosa Medina — cta. cte., sin límite
const PAB = "20-33100200-5"; // Pablo Sosa Electricidad — cta. cte., límite $ 80.000
const LUC = "40.112.908"; // Lucía Barrionuevo — sin cta. cte.
const HEC = "7.654.321"; // Héctor Ruiz — sin cta. cte.
const CAR = "27-29555111-0"; // Carla Núñez Pinturas — sin cta. cte.
const DIE = "35.778.002"; // Diego Albornoz — sin cta. cte.
const ESC = "30-71000002-0"; // Escuela Técnica Modelo — cta. cte., sin límite
const MTA = "22.345.876"; // Marta Quiroga — cta. cte., límite $ 50.000

const contado = { forma: "contado" } as const;
const contadoConVuelto = { forma: "contado", redondear: true } as const;
const cuenta = { forma: "cuenta_corriente" } as const;
const tarjeta = (tipo: TipoTarjeta, marca: string, ultimos4: string) =>
  ({ forma: "tarjeta", tipo, marca, ultimos4 }) as const;

/**
 * Las 50 facturas: 20 de contado, 15 con tarjeta y 15 en cuenta corriente;
 * 24 a consumidor final; ambos vendedores; de 1 a 3 renglones.
 */
export const FACTURAS_PLAN: readonly FacturaPlan[] = [
  { ref: "F01", dia: 29, hora: "09:10", vendedor: "vendedor", cliente: null, items: [["BU-003", 40], ["BU-004", 2]], pago: contadoConVuelto },
  { ref: "F02", dia: 29, hora: "11:30", vendedor: "admin", cliente: CON, items: [["PI-001", 4], ["PI-003", 6]], pago: cuenta },
  { ref: "F03", dia: 28, hora: "10:05", vendedor: "vendedor", cliente: null, items: [["HE-002", 2]], pago: tarjeta("debito", "Visa", "4821") },
  { ref: "F04", dia: 28, hora: "17:20", vendedor: "vendedor", cliente: MAR, items: [["HE-001", 1], ["HE-006", 1]], pago: cuenta },
  { ref: "F05", dia: 27, hora: "09:45", vendedor: "admin", cliente: null, items: [["EL-001", 5], ["EL-002", 4], ["PL-001", 3]], pago: contadoConVuelto },
  { ref: "F06", dia: 27, hora: "16:10", vendedor: "vendedor", cliente: LUC, items: [["PI-004", 2], ["PI-003", 2]], pago: tarjeta("credito", "Mastercard", "1188") },
  { ref: "F07", dia: 26, hora: "10:30", vendedor: "vendedor", cliente: null, items: [["PL-003", 6], ["PL-001", 4]], pago: contado },
  { ref: "F08", dia: 25, hora: "12:00", vendedor: "admin", cliente: ROS, items: [["PL-002", 2], ["PL-004", 1]], pago: cuenta },
  { ref: "F09", dia: 25, hora: "18:05", vendedor: "vendedor", cliente: null, items: [["EL-002", 6]], pago: tarjeta("debito", "Maestro", "3307") },
  { ref: "F10", dia: 24, hora: "09:20", vendedor: "vendedor", cliente: HEC, items: [["BU-005", 3], ["BU-001", 2]], pago: contadoConVuelto },
  { ref: "F11", dia: 24, hora: "15:40", vendedor: "admin", cliente: PAB, items: [["EL-005", 1], ["EL-001", 10]], pago: cuenta },
  { ref: "F12", dia: 23, hora: "11:15", vendedor: "vendedor", cliente: null, items: [["PI-005", 20]], pago: contado },
  { ref: "F13", dia: 22, hora: "10:00", vendedor: "vendedor", cliente: null, items: [["JA-002", 1], ["JA-004", 1]], pago: tarjeta("credito", "Visa", "9034") },
  { ref: "F14", dia: 22, hora: "17:30", vendedor: "admin", cliente: ESC, items: [["PI-001", 3], ["PI-004", 3], ["PI-003", 5]], pago: cuenta },
  { ref: "F15", dia: 21, hora: "09:50", vendedor: "vendedor", cliente: CAR, items: [["PI-002", 2], ["PI-005", 10]], pago: contadoConVuelto },
  { ref: "F16", dia: 21, hora: "13:25", vendedor: "vendedor", cliente: null, items: [["HE-003", 2]], pago: contado },
  { ref: "F17", dia: 20, hora: "10:40", vendedor: "admin", cliente: JUL, items: [["HE-004", 2], ["HE-002", 3]], pago: cuenta },
  { ref: "F18", dia: 20, hora: "16:00", vendedor: "vendedor", cliente: DIE, items: [["BU-001", 3], ["BU-002", 5]], pago: tarjeta("debito", "Cabal", "5512") },
  { ref: "F19", dia: 19, hora: "11:10", vendedor: "vendedor", cliente: null, items: [["EL-003", 4], ["EL-001", 3]], pago: contadoConVuelto },
  { ref: "F20", dia: 18, hora: "09:35", vendedor: "admin", cliente: CON, items: [["BU-003", 100], ["BU-001", 5], ["BU-005", 4]], pago: cuenta },
  { ref: "F21", dia: 18, hora: "15:50", vendedor: "vendedor", cliente: null, items: [["PL-004", 2]], pago: tarjeta("credito", "Naranja X", "7720") },
  { ref: "F22", dia: 17, hora: "10:20", vendedor: "vendedor", cliente: MTA, items: [["PL-001", 10], ["PL-003", 5]], pago: cuenta },
  { ref: "F23", dia: 17, hora: "18:10", vendedor: "vendedor", cliente: null, items: [["EL-002", 3], ["EL-003", 2]], pago: contado },
  { ref: "F24", dia: 16, hora: "12:30", vendedor: "admin", cliente: LUC, items: [["JA-001", 1]], pago: contadoConVuelto },
  { ref: "F25", dia: 15, hora: "09:15", vendedor: "vendedor", cliente: null, items: [["HE-006", 1], ["HE-002", 2]], pago: tarjeta("debito", "Visa", "2045") },
  { ref: "F26", dia: 15, hora: "14:45", vendedor: "vendedor", cliente: MAR, items: [["PI-001", 2], ["PI-004", 1]], pago: cuenta },
  { ref: "F27", dia: 14, hora: "10:55", vendedor: "admin", cliente: null, items: [["BU-003", 60], ["BU-004", 5]], pago: contado },
  { ref: "F28", dia: 14, hora: "17:05", vendedor: "vendedor", cliente: ROS, items: [["EL-002", 5], ["EL-001", 4], ["EL-003", 3]], pago: cuenta },
  { ref: "F29", dia: 13, hora: "11:40", vendedor: "vendedor", cliente: null, items: [["PI-005", 15], ["PI-003", 3]], pago: contadoConVuelto },
  { ref: "F30", dia: 12, hora: "09:30", vendedor: "admin", cliente: HEC, items: [["EL-004", 1]], pago: tarjeta("credito", "American Express", "0071") },
  { ref: "F31", dia: 12, hora: "16:20", vendedor: "vendedor", cliente: null, items: [["PL-001", 6]], pago: contado },
  { ref: "F32", dia: 11, hora: "10:10", vendedor: "vendedor", cliente: ESC, items: [["HE-002", 5], ["HE-003", 2], ["EL-001", 6]], pago: cuenta },
  { ref: "F33", dia: 10, hora: "15:00", vendedor: "admin", cliente: null, items: [["JA-003", 1], ["JA-004", 1]], pago: tarjeta("debito", "Mastercard", "6610") },
  { ref: "F34", dia: 10, hora: "18:30", vendedor: "vendedor", cliente: CAR, items: [["PI-002", 1], ["PI-003", 4], ["PI-005", 10]], pago: contadoConVuelto },
  { ref: "F35", dia: 9, hora: "11:20", vendedor: "vendedor", cliente: JUL, items: [["EL-002", 4], ["EL-003", 4]], pago: cuenta },
  { ref: "F36", dia: 8, hora: "09:40", vendedor: "admin", cliente: null, items: [["BU-002", 6], ["BU-003", 50]], pago: contado },
  { ref: "F37", dia: 8, hora: "16:45", vendedor: "vendedor", cliente: CON, items: [["EL-004", 2], ["EL-001", 10]], pago: tarjeta("credito", "Visa", "5150") },
  { ref: "F38", dia: 7, hora: "10:15", vendedor: "vendedor", cliente: null, items: [["HE-001", 1]], pago: tarjeta("credito", "Visa", "3389") },
  { ref: "F39", dia: 7, hora: "14:30", vendedor: "admin", cliente: DIE, items: [["PL-002", 1], ["PL-004", 1]], pago: contadoConVuelto },
  { ref: "F40", dia: 6, hora: "12:05", vendedor: "vendedor", cliente: null, items: [["EL-001", 4], ["PL-001", 5]], pago: contado },
  { ref: "F41", dia: 5, hora: "10:25", vendedor: "vendedor", cliente: PAB, items: [["EL-002", 5]], pago: tarjeta("debito", "Visa", "7754") },
  { ref: "F42", dia: 5, hora: "17:40", vendedor: "admin", cliente: MAR, items: [["BU-005", 4], ["BU-004", 6], ["BU-001", 2]], pago: cuenta },
  { ref: "F43", dia: 4, hora: "11:00", vendedor: "vendedor", cliente: null, items: [["PI-004", 1], ["PI-003", 2]], pago: tarjeta("debito", "Cabal", "1203") },
  { ref: "F44", dia: 3, hora: "09:55", vendedor: "admin", cliente: null, items: [["BU-003", 30]], pago: contadoConVuelto },
  { ref: "F45", dia: 3, hora: "15:35", vendedor: "vendedor", cliente: LUC, items: [["HE-004", 1], ["HE-006", 1]], pago: tarjeta("credito", "Mastercard", "4410") },
  { ref: "F46", dia: 2, hora: "10:45", vendedor: "vendedor", cliente: ROS, items: [["PL-002", 1], ["PL-001", 6]], pago: cuenta },
  { ref: "F47", dia: 1, hora: "16:15", vendedor: "admin", cliente: null, items: [["PI-005", 12], ["PI-003", 2]], pago: contado },
  { ref: "F48", dia: 0, hora: "09:05", vendedor: "vendedor", cliente: null, items: [["EL-001", 3], ["BU-003", 20]], pago: contadoConVuelto },
  { ref: "F49", dia: 0, hora: "10:20", vendedor: "admin", cliente: null, items: [["EL-002", 2], ["PL-003", 4]], pago: tarjeta("debito", "Visa", "6021") },
  { ref: "F50", dia: 0, hora: "11:40", vendedor: "vendedor", cliente: JUL, items: [["HE-002", 2], ["BU-001", 1]], pago: cuenta },
];

/**
 * 6 anulaciones (solo el administrador, RF-V9): 2 de contado, 2 con tarjeta y
 * 2 a cuenta corriente. Las de cuenta corriente se hacen ANTES de cualquier
 * pago de ese cliente, así el crédito nunca deja saldo a favor (decisión C1).
 */
export const ANULACIONES_PLAN: readonly AnulacionPlan[] = [
  { factura: "F07", dia: 26, hora: "11:00", motivo: "Error en la carga de cantidades" },
  { factura: "F13", dia: 21, hora: "09:00", motivo: "El cliente desistió de la compra" },
  { factura: "F14", dia: 20, hora: "12:00", motivo: "Factura emitida con productos equivocados" },
  { factura: "F24", dia: 16, hora: "17:00", motivo: "Producto con falla de fábrica" },
  { factura: "F28", dia: 13, hora: "10:00", motivo: "Precio mal informado al cliente" },
  { factura: "F41", dia: 4, hora: "12:00", motivo: "Factura duplicada por error" },
];

/**
 * 6 pagos (RF-C5): efectivo, transferencia y tarjeta de débito; dos pagos
 * totales (Pablo y Marta quedan sin deuda) y cuatro parciales.
 */
export const PAGOS_PLAN: readonly PagoCuentaPlan[] = [
  { ref: "P1", cliente: PAB, dia: 10, hora: "12:00", usuario: "vendedor", importe: "saldo", medio: "tarjeta_debito", observacion: "Cancelación total de la cuenta" },
  { ref: "P2", cliente: CON, dia: 12, hora: "11:00", usuario: "admin", importe: 10000000, medio: "transferencia", observacion: "Pago parcial por transferencia bancaria" },
  { ref: "P3", cliente: MTA, dia: 9, hora: "17:00", usuario: "vendedor", importe: "saldo", medio: "efectivo", observacion: "Cancelación total en efectivo" },
  { ref: "P4", cliente: MAR, dia: 6, hora: "10:00", usuario: "vendedor", importe: 4000000, medio: "efectivo", observacion: "Entrega a cuenta" },
  { ref: "P5", cliente: JUL, dia: 3, hora: "12:00", usuario: "admin", importe: 2000000, medio: "transferencia", observacion: "Pago parcial" },
  { ref: "P6", cliente: ESC, dia: 1, hora: "11:30", usuario: "vendedor", importe: 1500000, medio: "tarjeta_debito", observacion: "Pago parcial con tarjeta de débito" },
];

// ---------------------------------------------------------------------------
// Fechas del plan (hora de Argentina)
// ---------------------------------------------------------------------------

/**
 * Instante de «hace `dia` días a la hora `hora`» en Argentina, tomando como
 * hoy el día de Argentina de `referencia`. Argentina no tiene horario de
 * verano (UTC−3 fijo), así que restar días enteros es exacto.
 */
export function instanteDelPlan(referencia: Date, dia: number, hora: string): Date {
  const [hh, mm] = hora.split(":").map(Number);
  const inicioHoy = inicioDelDiaEnArgentina(diaEnArgentina(referencia)).getTime();
  return new Date(inicioHoy - dia * DIA_MS + hh * HORA_MS + mm * MINUTO_MS);
}

/** Primer instante de la ventana de 30 días (hoy y los 29 anteriores). */
export function inicioDeVentana(referencia: Date): Date {
  return instanteDelPlan(referencia, DIAS_VENTANA - 1, "00:00");
}

/**
 * Fecha con la que se registra el stock inicial del catálogo en una base
 * nueva: el día anterior a la ventana. Así el historial de cada producto
 * queda en orden cronológico (stock inicial → reposición → ventas).
 */
export function fechaStockInicialSemilla(referencia: Date): Date {
  return instanteDelPlan(referencia, DIAS_VENTANA, "08:00");
}

export type EventoPlan =
  | { tipo: "reposicion"; instante: Date }
  | { tipo: "factura"; instante: Date; plan: FacturaPlan }
  | { tipo: "anulacion"; instante: Date; plan: AnulacionPlan }
  | { tipo: "pago"; instante: Date; plan: PagoCuentaPlan };

/**
 * Todas las operaciones en orden cronológico. Ninguna queda en el futuro:
 * las del día actual cuya hora todavía no llegó se adelantan, conservando el
 * orden, a un minuto de distancia entre sí y antes de `referencia`.
 */
export function construirCronograma(referencia: Date): EventoPlan[] {
  const eventos: EventoPlan[] = [
    { tipo: "reposicion", instante: instanteDelPlan(referencia, REPOSICION_DIA, REPOSICION_HORA) },
    ...FACTURAS_PLAN.map((plan) => ({ tipo: "factura" as const, instante: instanteDelPlan(referencia, plan.dia, plan.hora), plan })),
    ...ANULACIONES_PLAN.map((plan) => ({ tipo: "anulacion" as const, instante: instanteDelPlan(referencia, plan.dia, plan.hora), plan })),
    ...PAGOS_PLAN.map((plan) => ({ tipo: "pago" as const, instante: instanteDelPlan(referencia, plan.dia, plan.hora), plan })),
  ];
  eventos.sort((a, b) => a.instante.getTime() - b.instante.getTime());

  let limite = referencia.getTime() - MINUTO_MS;
  for (let i = eventos.length - 1; i >= 0; i--) {
    const instante = Math.min(eventos[i].instante.getTime(), limite);
    eventos[i] = { ...eventos[i], instante: new Date(instante) };
    limite = instante - MINUTO_MS;
  }
  return eventos;
}

// ---------------------------------------------------------------------------
// Identificación del conjunto académico (idempotencia)
// ---------------------------------------------------------------------------

/** Primera reposición con la marca académica, o undefined si el conjunto no se creó. */
export async function buscarMarcaSeed() {
  const [fila] = await db
    .select({ id: movimientosStock.id, creadoEn: movimientosStock.creadoEn })
    .from(movimientosStock)
    .where(and(eq(movimientosStock.tipo, "ingreso"), like(movimientosStock.observacion, `${MARCA_SEED_FACTURAS}%`)))
    .orderBy(asc(movimientosStock.id))
    .limit(1);
  return fila;
}

/**
 * Ids de las facturas académicas: las 50 primeras, por número, creadas
 * después de la marca. Vacío si el conjunto todavía no se creó.
 */
export async function idsFacturasAcademicas(): Promise<number[]> {
  const marca = await buscarMarcaSeed();
  if (!marca) return [];
  const filas = await db
    .select({ id: facturas.id })
    .from(facturas)
    .where(gte(facturas.creadoEn, marca.creadoEn))
    .orderBy(asc(facturas.puntoVenta), asc(facturas.numero))
    .limit(CANTIDAD_FACTURAS_ACADEMICAS);
  return filas.map((f) => f.id);
}

// ---------------------------------------------------------------------------
// Siembra
// ---------------------------------------------------------------------------

export type ResultadoSemillaFacturas =
  | { estado: "existente"; facturas: number }
  | {
      estado: "creado";
      reposiciones: { codigo: string; cantidad: number }[];
      facturas: number;
      anulaciones: number;
      pagos: number;
    };

type Usuarios = Record<Rol, UsuarioAutenticado>;

/** Centavos redondeados hacia arriba a múltiplos de $ 1.000 (100000 centavos). */
function redondearAMil(centavos: number): number {
  return Math.ceil(centavos / 100000) * 100000;
}

/**
 * Comprueba, SIN escribir nada, que existan y estén activos los productos y
 * clientes del plan (y que los de cuenta corriente la tengan habilitada).
 */
async function resolverReferencias() {
  const codigos = [
    ...new Set([...REPOSICIONES_PLAN.map((r) => r.codigo), ...FACTURAS_PLAN.flatMap((f) => f.items.map(([c]) => c))]),
  ];
  const filasProductos = await db
    .select({ id: productos.id, codigo: productos.codigo, precio: productos.precio, existencia: productos.existencia, activo: productos.activo })
    .from(productos)
    .where(inArray(productos.codigo, codigos));
  const porCodigo = new Map(filasProductos.map((p) => [p.codigo, p]));
  const faltantes = codigos.filter((c) => !porCodigo.get(c)?.activo);
  if (faltantes.length > 0) {
    throw new Error(`Faltan productos académicos activos para las facturas: ${faltantes.join(", ")}.`);
  }

  const documentos = [
    ...new Set([...FACTURAS_PLAN.flatMap((f) => (f.cliente ? [f.cliente] : [])), ...PAGOS_PLAN.map((p) => p.cliente)]),
  ];
  const filasClientes = await db
    .select({ id: clientes.id, nro: clientes.nroDocNormalizado, activo: clientes.activo, cuentaCorriente: clientes.cuentaCorriente })
    .from(clientes)
    .where(inArray(clientes.nroDocNormalizado, documentos.map(normalizarDocumento)));
  const porDocumento = new Map(filasClientes.map((c) => [c.nro, c]));
  const clienteDe = (doc: string) => porDocumento.get(normalizarDocumento(doc));
  const necesitanCuenta = new Set([
    ...FACTURAS_PLAN.filter((f) => f.pago.forma === "cuenta_corriente").map((f) => f.cliente!),
    ...PAGOS_PLAN.map((p) => p.cliente),
  ]);
  const clientesInvalidos = documentos.filter((doc) => {
    const c = clienteDe(doc);
    return !c || !c.activo || (necesitanCuenta.has(doc) && !c.cuentaCorriente);
  });
  if (clientesInvalidos.length > 0) {
    throw new Error(`Faltan clientes académicos activos (o con cuenta corriente) para las facturas: ${clientesInvalidos.join(", ")}.`);
  }

  return { porCodigo, idCliente: (doc: string) => clienteDe(doc)!.id };
}

/**
 * Cantidad a reponer de cada producto ANTES de la primera venta, para que
 * ninguna venta del cronograma quede sin stock. Simula las ventas y
 * anulaciones sobre la existencia actual: si lo planificado no alcanza, se
 * repone además lo que falte. En una base recién sembrada el resultado es
 * siempre REPOSICIONES_PLAN.
 */
export function calcularReposiciones(
  existencias: Map<string, number>,
  cronograma: EventoPlan[],
): { codigo: string; cantidad: number }[] {
  const planificada = new Map(REPOSICIONES_PLAN.map((r) => [r.codigo, r.cantidad]));
  const actual = new Map<string, number>();
  const minimo = new Map<string, number>();
  for (const codigo of new Set([...planificada.keys(), ...FACTURAS_PLAN.flatMap((f) => f.items.map(([c]) => c))])) {
    const inicial = (existencias.get(codigo) ?? 0) + (planificada.get(codigo) ?? 0);
    actual.set(codigo, inicial);
    minimo.set(codigo, inicial);
  }
  const porRef = new Map(FACTURAS_PLAN.map((f) => [f.ref, f]));
  for (const evento of cronograma) {
    let factura: FacturaPlan;
    let signo: number;
    if (evento.tipo === "factura") {
      factura = evento.plan;
      signo = -1;
    } else if (evento.tipo === "anulacion") {
      factura = porRef.get(evento.plan.factura)!;
      signo = 1;
    } else {
      continue;
    }
    for (const [codigo, cantidad] of factura.items) {
      const valor = actual.get(codigo)! + signo * cantidad;
      actual.set(codigo, valor);
      minimo.set(codigo, Math.min(minimo.get(codigo)!, valor));
    }
  }
  const resultado: { codigo: string; cantidad: number }[] = [];
  for (const [codigo, valorMinimo] of minimo) {
    const cantidad = (planificada.get(codigo) ?? 0) + Math.max(0, -valorMinimo);
    if (cantidad > 0) resultado.push({ codigo, cantidad });
  }
  return resultado;
}

/**
 * Crea el conjunto académico si todavía no existe. `referencia` es el
 * momento real a partir del cual se calculan los días (por defecto, ahora).
 */
export async function sembrarFacturas(usuarios: Usuarios, referencia: Date = new Date()): Promise<ResultadoSemillaFacturas> {
  if (usuarios.admin.rol !== "admin" || usuarios.vendedor.rol !== "vendedor") {
    throw new Error("El seed de facturas necesita el administrador y el vendedor académicos.");
  }

  // Idempotencia: si la marca existe, no se crea nada.
  if (await buscarMarcaSeed()) {
    const existentes = (await idsFacturasAcademicas()).length;
    if (existentes !== CANTIDAD_FACTURAS_ACADEMICAS) {
      throw new Error(
        `El conjunto académico de facturas está incompleto (${existentes} de ${CANTIDAD_FACTURAS_ACADEMICAS}): ` +
          "una ejecución anterior se interrumpió. Revise la base manualmente; el seed no lo completa para no duplicar datos.",
      );
    }
    return { estado: "existente", facturas: existentes };
  }

  // Controles previos, sin escribir nada.
  const { porCodigo, idCliente } = await resolverReferencias();
  const cronograma = construirCronograma(referencia);
  const reposiciones = calcularReposiciones(
    new Map([...porCodigo].map(([codigo, p]) => [codigo, p.existencia])),
    cronograma,
  );

  const idsPorRef = new Map<string, number>();
  let anulaciones = 0;
  let pagos = 0;

  for (const evento of cronograma) {
    await conFechaSimulada(evento.instante, async () => {
      switch (evento.tipo) {
        case "reposicion":
          // La primera reposición graba la marca: a partir de aquí el conjunto existe.
          for (const { codigo, cantidad } of reposiciones) {
            await registrarMovimientoManual(
              usuarios.admin,
              { id: String(porCodigo.get(codigo)!.id) },
              { tipo: "ingreso", cantidad, motivo: "Reposición", observacion: OBSERVACION_REPOSICION },
            );
          }
          return;

        case "factura": {
          const { plan } = evento;
          const items = plan.items.map(([codigo, cantidad]) => ({ productoId: porCodigo.get(codigo)!.id, cantidad }));
          let pago;
          if (plan.pago.forma === "contado") {
            // El total lo calcula el servidor; aquí solo se elige cuánto entrega el cliente.
            const totalEstimado = plan.items.reduce((s, [codigo, cantidad]) => s + porCodigo.get(codigo)!.precio * cantidad, 0);
            pago = plan.pago.redondear ? { forma: "contado", montoRecibido: redondearAMil(totalEstimado) } : { forma: "contado" };
          } else if (plan.pago.forma === "tarjeta") {
            const { tipo, marca, ultimos4 } = plan.pago;
            pago = { forma: "tarjeta", tarjeta: { tipo, marca, ultimos4 } };
          } else {
            pago = { forma: "cuenta_corriente" };
          }
          const factura = await emitirFactura(usuarios[plan.vendedor], {
            clienteId: plan.cliente ? idCliente(plan.cliente) : null,
            items,
            pago,
          });
          idsPorRef.set(plan.ref, factura.id);
          return;
        }

        case "anulacion":
          await anularFactura(usuarios.admin, { id: String(idsPorRef.get(evento.plan.factura)!) }, { motivo: evento.plan.motivo });
          anulaciones++;
          return;

        case "pago": {
          const { plan } = evento;
          const clienteId = idCliente(plan.cliente);
          const importe = plan.importe === "saldo" ? await obtenerSaldo(db, clienteId) : plan.importe;
          await registrarPago(usuarios[plan.usuario], { id: String(clienteId) }, { importe, medio: plan.medio, observacion: plan.observacion });
          pagos++;
          return;
        }
      }
    });
  }

  return { estado: "creado", reposiciones, facturas: idsPorRef.size, anulaciones, pagos };
}
