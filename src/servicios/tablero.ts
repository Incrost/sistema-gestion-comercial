/**
 * Servicio del tablero de inicio (sección 5, «Tablero»; sección 11.2:
 * GET /api/tablero, ambos roles):
 *
 * - RF-T1 Indicadores: ventas del día y del mes (cantidad e importe, más el
 *   ticket promedio del mes), total adeudado en cuentas corrientes y cantidad
 *   de productos bajo el mínimo.
 * - RF-T2 Gráficos: ventas diarias de los últimos 30 días y ventas del mes
 *   por forma de pago.
 * - RF-T3 Más vendidos: los 5 productos más vendidos del mes, por unidades.
 *
 * Criterios comunes:
 * - Solo cuentan las facturas EMITIDAS: una factura anulada no es una venta
 *   (RF-V9), así que se excluye junto con todos sus renglones.
 * - Días y meses son de Argentina (America/Argentina/Buenos_Aires, UTC−3 fijo),
 *   nunca de la zona horaria del servidor. Los límites se calculan una sola
 *   vez en calcularPeriodos() y cada consulta filtra por rango de instantes:
 *   `fecha >= desde AND fecha < hasta` (usa el índice facturas_estado_fecha_idx).
 * - El «ahora» sale de ahora() (src/servicios/reloj.ts): las pruebas lo fijan
 *   con conFechaSimulada(); la API NO recibe ninguna fecha.
 * - Importes en centavos enteros (regla 10). Todo se agrega en SQL: no se
 *   cargan facturas en memoria. Las consultas son independientes y de solo
 *   lectura, por eso se ejecutan en paralelo (sin N+1).
 *
 * No conoce HTTP, cookies ni componentes. Solo servidor.
 */
import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt, sql, sum, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { FORMAS_PAGO, facturaItems, facturas, productos, type FormaPago } from "@/db/schema";
import { diaEnArgentina, diasHasta, inicioDelDiaEnArgentina, primerDiaDelMes, primerDiaDelMesSiguiente, sumarDias } from "@/lib/fechas";

import type { UsuarioAutenticado } from "./auth";
import { resumirDeudas } from "./cuenta-corriente";
import { exigirRol } from "./permisos";
import { condicionBajoMinimo } from "./productos";
import { ahora } from "./reloj";

// ---------------------------------------------------------------------------
// Forma pública (sección 11.2)
// ---------------------------------------------------------------------------

export type VentaDiaria = { fecha: string; importe: number };
export type VentaPorForma = { forma: FormaPago; importe: number };
export type ProductoMasVendido = {
  productoId: number;
  codigo: string;
  descripcion: string;
  unidades: number;
  importe: number;
};

export type Tablero = {
  hoy: { cantidad: number; importe: number };
  mes: { cantidad: number; importe: number; ticketPromedio: number };
  cuentasCorrientes: { totalAdeudado: number; clientesConSaldo: number };
  bajoMinimo: { cantidad: number };
  /** Exactamente DIAS_VENTAS_DIARIAS elementos, del más antiguo a hoy. */
  ventasDiarias: VentaDiaria[];
  /** Siempre las tres formas, en el orden de FORMAS_PAGO. */
  porFormaDePago: VentaPorForma[];
  /** Como máximo CANTIDAD_MAS_VENDIDOS. */
  masVendidos: ProductoMasVendido[];
};

/** RF-T2: días del gráfico de ventas diarias (hoy y los 29 anteriores). */
export const DIAS_VENTAS_DIARIAS = 30;
/** RF-T3: cantidad de productos más vendidos. */
export const CANTIDAD_MAS_VENDIDOS = 5;

// ---------------------------------------------------------------------------
// Períodos (límites centralizados)
// ---------------------------------------------------------------------------

/** Rango de instantes [desde, hasta): `desde` inclusive, `hasta` exclusivo. */
export type Rango = { desde: Date; hasta: Date };

export type Periodos = {
  /** Día de Argentina del instante de referencia ("AAAA-MM-DD"). */
  dia: string;
  hoy: Rango;
  mes: Rango;
  /** Últimos 30 días: rango de instantes y lista ordenada de los días. */
  ventana: Rango & { dias: string[] };
};

/**
 * Límites del día, del mes calendario y de la ventana de 30 días, en hora de
 * Argentina, a partir de un instante. Función pura: no depende de la zona
 * horaria de la máquina (trabaja con el texto del día y el desfase fijo).
 *
 * Ej.: 2026-11-15T02:00Z (= 14/11 23:00 en Argentina) →
 *   dia "2026-11-14", hoy [14/11 03:00Z, 15/11 03:00Z),
 *   mes [01/11 03:00Z, 01/12 03:00Z), ventana desde el 16/10.
 */
export function calcularPeriodos(instante: Date): Periodos {
  const dia = diaEnArgentina(instante);
  const inicio = (d: string) => inicioDelDiaEnArgentina(d);
  const dias = diasHasta(dia, DIAS_VENTAS_DIARIAS);
  return {
    dia,
    hoy: { desde: inicio(dia), hasta: inicio(sumarDias(dia, 1)) },
    mes: { desde: inicio(primerDiaDelMes(dia)), hasta: inicio(primerDiaDelMesSiguiente(dia)) },
    ventana: { desde: inicio(dias[0]), hasta: inicio(sumarDias(dia, 1)), dias },
  };
}

/**
 * Completa con importe 0 los días sin ventas y respeta el orden de `dias`
 * (RF-T2: el gráfico no tiene huecos).
 */
export function completarDias(dias: string[], importesPorDia: ReadonlyMap<string, number>): VentaDiaria[] {
  return dias.map((fecha) => ({ fecha, importe: importesPorDia.get(fecha) ?? 0 }));
}

/**
 * Ticket promedio = importe / cantidad, en centavos enteros. Criterio de
 * redondeo: al centavo más cercano, las mitades hacia arriba
 * (1001 / 2 = 500,5 → 501). Sin ventas, 0.
 */
export function calcularTicketPromedio(importe: number, cantidad: number): number {
  return cantidad > 0 ? Math.round(importe / cantidad) : 0;
}

// ---------------------------------------------------------------------------
// Expresiones SQL compartidas
// ---------------------------------------------------------------------------

/** Factura emitida con fecha dentro del rango (las anuladas no son ventas). */
function emitidasEn(rango: Rango): SQL {
  return and(eq(facturas.estado, "emitida"), gte(facturas.fecha, rango.desde), lt(facturas.fecha, rango.hasta))!;
}

/** Suma de una columna entera (0 si no hay filas). */
function sumaEntera(columna: Parameters<typeof sum>[0]) {
  return sql<number>`coalesce(${sum(columna)}, 0)`.mapWith(Number);
}

/**
 * Día de Argentina ("AAAA-MM-DD") de `facturas.fecha`, calculado en SQL.
 * La columna guarda milisegundos UTC: se le resta el desfase de Argentina
 * (3 h, el mismo que usa inicioDelDiaEnArgentina) y se toma la fecha UTC del
 * resultado. No depende de la zona horaria del servidor ni de SQLite.
 */
const DESFASE_ARGENTINA_MS = inicioDelDiaEnArgentina("1970-01-01").getTime(); // 10 800 000
const diaArgentinoDeFactura = sql<string>`strftime('%Y-%m-%d', (${facturas.fecha} - ${sql.raw(String(DESFASE_ARGENTINA_MS))}) / 1000, 'unixepoch')`;

// ---------------------------------------------------------------------------
// RF-T1 — indicadores
// ---------------------------------------------------------------------------

/** Cantidad e importe de las facturas emitidas en el rango. */
async function resumirVentas(rango: Rango): Promise<{ cantidad: number; importe: number }> {
  const [fila] = await db
    .select({ cantidad: count(), importe: sumaEntera(facturas.total) })
    .from(facturas)
    .where(emitidasEn(rango));
  return { cantidad: fila?.cantidad ?? 0, importe: fila?.importe ?? 0 };
}

/** Productos ACTIVOS con existencia < stockMinimo (decisión D2, misma regla que el catálogo). */
async function contarBajoMinimo(): Promise<number> {
  const [fila] = await db
    .select({ cantidad: count() })
    .from(productos)
    .where(and(eq(productos.activo, true), condicionBajoMinimo));
  return fila?.cantidad ?? 0;
}

// ---------------------------------------------------------------------------
// RF-T2 — gráficos
// ---------------------------------------------------------------------------

/** Importe emitido por día de Argentina dentro de la ventana, sin huecos. */
async function ventasDiarias(ventana: Periodos["ventana"]): Promise<VentaDiaria[]> {
  const filas = await db
    .select({ dia: diaArgentinoDeFactura, importe: sumaEntera(facturas.total) })
    .from(facturas)
    .where(emitidasEn(ventana))
    .groupBy(diaArgentinoDeFactura);
  return completarDias(ventana.dias, new Map(filas.map((f) => [f.dia, f.importe])));
}

/** Importe emitido en el mes por forma de pago: siempre las tres, en orden fijo. */
async function ventasPorForma(mes: Rango): Promise<VentaPorForma[]> {
  const filas = await db
    .select({ forma: facturas.formaPago, importe: sumaEntera(facturas.total) })
    .from(facturas)
    .where(emitidasEn(mes))
    .groupBy(facturas.formaPago);
  const importes = new Map(filas.map((f) => [f.forma, f.importe]));
  return FORMAS_PAGO.map((forma) => ({ forma, importe: importes.get(forma) ?? 0 }));
}

// ---------------------------------------------------------------------------
// RF-T3 — más vendidos
// ---------------------------------------------------------------------------

/**
 * Los 5 productos con más unidades vendidas en el mes (solo renglones de
 * facturas emitidas).
 *
 * - Orden: unidades (desc) → importe (desc) → productoId (asc). El último
 *   criterio hace que el desempate sea estable aunque todo lo demás coincida.
 * - `importe`: suma de los subtotales de esos renglones (precio congelado).
 * - Código y descripción salen de factura_items (congelados al emitir, regla
 *   3), no del catálogo: si el producto se renombró después, el tablero
 *   muestra cómo se vendió. Si en el mes se vendió con más de una
 *   descripción, se toma la del renglón más reciente (mayor id).
 *
 * Dos consultas fijas (nunca una por producto): el ranking agrupado y los
 * datos congelados de los, como máximo, 5 renglones más recientes.
 */
async function masVendidos(mes: Rango): Promise<ProductoMasVendido[]> {
  const unidades = sumaEntera(facturaItems.cantidad);
  const importe = sumaEntera(facturaItems.subtotal);
  const ranking = await db
    .select({
      productoId: facturaItems.productoId,
      unidades,
      importe,
      ultimoItemId: sql<number>`max(${facturaItems.id})`.mapWith(Number),
    })
    .from(facturaItems)
    .innerJoin(facturas, eq(facturaItems.facturaId, facturas.id))
    .where(emitidasEn(mes))
    .groupBy(facturaItems.productoId)
    .orderBy(desc(unidades), desc(importe), asc(facturaItems.productoId))
    .limit(CANTIDAD_MAS_VENDIDOS);
  if (ranking.length === 0) return [];

  const congelados = await db
    .select({ id: facturaItems.id, codigo: facturaItems.codigo, descripcion: facturaItems.descripcion })
    .from(facturaItems)
    .where(inArray(facturaItems.id, ranking.map((r) => r.ultimoItemId)));
  const porId = new Map(congelados.map((c) => [c.id, c]));

  return ranking.map((r) => {
    const item = porId.get(r.ultimoItemId)!;
    return {
      productoId: r.productoId,
      codigo: item.codigo,
      descripcion: item.descripcion,
      unidades: r.unidades,
      importe: r.importe,
    };
  });
}

// ---------------------------------------------------------------------------
// Operación pública
// ---------------------------------------------------------------------------

/**
 * RF-T1, RF-T2 y RF-T3: datos completos del tablero. Ambos roles.
 * Sin usuario → 401; con un rol desconocido → 403 (exigirRol).
 */
export async function obtenerTablero(usuario: UsuarioAutenticado): Promise<Tablero> {
  // 1. Validar: no recibe datos (la fecha nunca viene de afuera).
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  // 3. Reglas: límites del período según el reloj del servidor.
  const periodos = calcularPeriodos(ahora());

  // 4. Base: lecturas independientes, en paralelo.
  const [hoy, mes, cuentasCorrientes, cantidadBajoMinimo, diarias, porFormaDePago, top] = await Promise.all([
    resumirVentas(periodos.hoy),
    resumirVentas(periodos.mes),
    resumirDeudas(db),
    contarBajoMinimo(),
    ventasDiarias(periodos.ventana),
    ventasPorForma(periodos.mes),
    masVendidos(periodos.mes),
  ]);

  // 5. Forma pública.
  return {
    hoy,
    mes: { ...mes, ticketPromedio: calcularTicketPromedio(mes.importe, mes.cantidad) },
    cuentasCorrientes,
    bajoMinimo: { cantidad: cantidadBajoMinimo },
    ventasDiarias: diarias,
    porFormaDePago,
    masVendidos: top,
  };
}
