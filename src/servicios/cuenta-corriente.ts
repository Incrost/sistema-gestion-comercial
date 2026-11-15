/**
 * Cuenta corriente de clientes (RF-C4; reglas 7, 8 y 11; decisión C4;
 * sección 10.2: «el saldo del cliente sale de sus movimientos de cuenta»).
 *
 *   saldo = suma de débitos − suma de créditos   (en centavos, regla 7)
 *
 * El saldo NO es una columna: se deriva siempre de movimientos_cuenta. Un
 * cliente sin movimientos tiene saldo 0.
 *
 * Este módulo centraliza TODO lo de la cuenta corriente:
 * - la expresión del saldo (`saldoDelCliente`, `importeConSigno`) y
 *   `obtenerSaldo()`: listado (RF-C1), saldos (RF-C6), ficha (RF-C3), baja
 *   (RF-C7), pagos (regla 8) y, más adelante, límite de crédito (regla 7);
 * - la consulta de movimientos con `saldoAnterior` y saldo acumulado por
 *   renglón (`obtenerCuentaCorriente()`, RF-C4);
 * - la ÚNICA función que graba movimientos de cuenta
 *   (`registrarMovimientoCuenta()`, con los atajos `registrarDebito()` y
 *   `registrarCredito()`), que impide que el saldo quede negativo.
 *
 * Los movimientos se graban SIEMPRE dentro de la transacción de la operación
 * que los origina (pago, y en el próximo hito venta y anulación). No hay ruta
 * pública para crear movimientos: solo los servicios llaman a estas funciones.
 *
 * Trazabilidad (regla 11): la tabla movimientos_cuenta no tiene columna de
 * usuario; cada movimiento referencia su origen (pago o factura), que guarda
 * el usuario, y registra su propia fecha y hora.
 *
 * Solo servidor.
 */
import "server-only";

import { and, asc, eq, getTableName, gte, lt, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { clientes, movimientosCuenta, type TipoMovimientoCuenta } from "@/db/schema";
import type { Conexion, Transaccion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { inicioDelDiaEnArgentina, inicioDelDiaSiguienteEnArgentina } from "@/lib/fechas";
import { esquemaConsultaCuenta, esquemaParametrosCliente } from "@/lib/validacion-pagos";

import type { UsuarioAutenticado } from "./auth";
import { exigirRol, tieneRol } from "./permisos";

// ---------------------------------------------------------------------------
// Regla 7 — expresión del saldo (única fuente)
// ---------------------------------------------------------------------------

/** Importe con signo en JavaScript: + débito, − crédito (regla 7). */
export function importeFirmado(tipo: TipoMovimientoCuenta, importe: number): number {
  return tipo === "debito" ? importe : -importe;
}

/** Importe con signo en SQL: + débito, − crédito (regla 7). */
function importeConSigno(tipo: unknown, importe: unknown): SQL {
  return sql`case when ${tipo} = 'debito' then ${importe} else -${importe} end`;
}

/** Suma con signo de los movimientos que cumplen el WHERE (0 si no hay). */
const sumaConSigno = sql<number>`coalesce(sum(${importeConSigno(movimientosCuenta.tipo, movimientosCuenta.importe)}), 0)`.mapWith(
  Number,
);

/** Columna calificada con su tabla ("tabla"."columna"), escrita a mano. */
function calificada(tabla: string, columna: string) {
  return sql`${sql.identifier(tabla)}.${sql.identifier(columna)}`;
}

/**
 * Saldo del cliente de la fila actual de `clientes` (débitos − créditos).
 * Usar en consultas cuyo FROM es la tabla `clientes`.
 *
 * Las columnas se califican a mano: en una consulta sobre una sola tabla
 * Drizzle las escribe sin el nombre de la tabla, y dentro de la subconsulta
 * `id` se resolvería como `movimientos_cuenta.id` en lugar de `clientes.id`.
 */
export const saldoDelCliente = sql<number>`coalesce((select sum(${importeConSigno(
  calificada("mc", movimientosCuenta.tipo.name),
  calificada("mc", movimientosCuenta.importe.name),
)}) from ${movimientosCuenta} as ${sql.identifier("mc")} where ${calificada("mc", movimientosCuenta.clienteId.name)} = ${calificada(getTableName(clientes), clientes.id.name)}), 0)`.mapWith(
  Number,
);

/** Saldo actual de un cliente (0 si no tiene movimientos o no existe). */
export async function obtenerSaldo(conexion: Conexion, clienteId: number): Promise<number> {
  // Misma expresión que el listado y la ficha: una sola fuente del saldo.
  const [fila] = await conexion
    .select({ saldo: saldoDelCliente })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);
  return fila?.saldo ?? 0;
}

/**
 * Crédito disponible: límite − saldo cuando el cliente tiene límite; null
 * cuando no lo tiene (sección 11.5). Puede ser negativo si el límite se bajó
 * por debajo de la deuda.
 */
export function calcularDisponible(limiteCredito: number | null, saldo: number): number | null {
  return limiteCredito === null ? null : limiteCredito - saldo;
}

// ---------------------------------------------------------------------------
// Cliente de una operación de cuenta corriente
// ---------------------------------------------------------------------------

export type ClienteDeCuenta = { id: number; nombre: string; cuentaCorriente: boolean };

/**
 * Cliente existente y ACTIVO para consultar su cuenta o registrarle un pago.
 * - inexistente → 404 NO_ENCONTRADO;
 * - inactivo → al vendedor 404 (nunca se le exponen clientes inactivos, igual
 *   que en la ficha); al administrador 422 VALIDACION «dado de baja».
 */
export async function exigirClienteDeCuenta(
  conexion: Conexion,
  usuario: UsuarioAutenticado,
  clienteId: number,
): Promise<ClienteDeCuenta> {
  const [fila] = await conexion
    .select({
      id: clientes.id,
      nombre: clientes.nombre,
      cuentaCorriente: clientes.cuentaCorriente,
      activo: clientes.activo,
    })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);
  if (!fila || (!fila.activo && !tieneRol(usuario, "admin"))) {
    throw ApiError.desdeCodigo("NO_ENCONTRADO", "El cliente no existe.");
  }
  if (!fila.activo) {
    throw ApiError.desdeCodigo("VALIDACION", "El cliente está dado de baja.", [
      { campo: "clienteId", mensaje: "El cliente está dado de baja." },
    ]);
  }
  return { id: fila.id, nombre: fila.nombre, cuentaCorriente: fila.cuentaCorriente };
}

// ---------------------------------------------------------------------------
// RF-C4 — consulta de la cuenta corriente
// ---------------------------------------------------------------------------

export type MovimientoCuentaPublico = {
  fecha: string; // ISO 8601 UTC
  tipo: TipoMovimientoCuenta;
  importe: number; // centavos, siempre positivo
  descripcion: string;
  facturaId: number | null;
  pagoId: number | null;
  /** Saldo acumulado DESPUÉS de este movimiento. */
  saldo: number;
};

export type CuentaCorriente = {
  cliente: { id: number; nombre: string };
  /** Lo acumulado antes de `desde` (0 sin `desde`). */
  saldoAnterior: number;
  /** Del más antiguo al más reciente. */
  movimientos: MovimientoCuentaPublico[];
  /** Saldo al final del período consultado (sin `hasta`, el saldo actual). */
  saldo: number;
};

/**
 * RF-C4: movimientos de la cuenta en orden cronológico, con el saldo
 * acumulado en cada renglón (regla 7). Ambos roles; cliente existente y activo.
 *
 * Filtros `desde` y `hasta` (AAAA-MM-DD, días de Argentina, ambos inclusive):
 * - `saldoAnterior` = suma con signo de los movimientos ANTERIORES a `desde`;
 * - el primer renglón visible parte de `saldoAnterior`;
 * - `saldo` = saldoAnterior + movimientos del período (con `hasta`, el saldo
 *   al cierre de ese día; sin `hasta`, el saldo actual).
 * Sin movimientos en el período: `movimientos: []` y `saldo = saldoAnterior`.
 */
export async function obtenerCuentaCorriente(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  consulta: unknown,
): Promise<CuentaCorriente> {
  // 1. Validar.
  const { id } = esquemaParametrosCliente.parse(parametros);
  const { desde, hasta } = esquemaConsultaCuenta.parse(consulta);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  // 3. Reglas.
  const cliente = await exigirClienteDeCuenta(db, usuario, id);

  // 4. Base: rango de instantes de los días de Argentina.
  const inicio = desde ? inicioDelDiaEnArgentina(desde) : undefined;
  const fin = hasta ? inicioDelDiaSiguienteEnArgentina(hasta) : undefined;
  const delCliente = eq(movimientosCuenta.clienteId, id);

  const [anterior, filas] = await Promise.all([
    inicio
      ? db.select({ suma: sumaConSigno }).from(movimientosCuenta).where(and(delCliente, lt(movimientosCuenta.fecha, inicio)))
      : Promise.resolve([{ suma: 0 }]),
    db
      .select({
        fecha: movimientosCuenta.fecha,
        tipo: movimientosCuenta.tipo,
        importe: movimientosCuenta.importe,
        descripcion: movimientosCuenta.descripcion,
        facturaId: movimientosCuenta.facturaId,
        pagoId: movimientosCuenta.pagoId,
      })
      .from(movimientosCuenta)
      .where(
        and(
          delCliente,
          inicio ? gte(movimientosCuenta.fecha, inicio) : undefined,
          fin ? lt(movimientosCuenta.fecha, fin) : undefined,
        ),
      )
      // Cronológico; a igual fecha, en el orden en que se grabaron.
      .orderBy(asc(movimientosCuenta.fecha), asc(movimientosCuenta.id)),
  ]);

  // 5. Forma pública con saldo acumulado por renglón (regla 7).
  const saldoAnterior = anterior[0]?.suma ?? 0;
  let acumulado = saldoAnterior;
  const movimientos = filas.map((m) => {
    acumulado += importeFirmado(m.tipo, m.importe);
    return {
      fecha: m.fecha.toISOString(),
      tipo: m.tipo,
      importe: m.importe,
      descripcion: m.descripcion,
      facturaId: m.facturaId,
      pagoId: m.pagoId,
      saldo: acumulado,
    };
  });

  return { cliente: { id: cliente.id, nombre: cliente.nombre }, saldoAnterior, movimientos, saldo: acumulado };
}

// ---------------------------------------------------------------------------
// Registro de movimientos — ÚNICA vía de escritura de movimientos_cuenta
// ---------------------------------------------------------------------------

/** Origen del movimiento: exactamente uno de los dos. */
export type OrigenMovimiento = { facturaId: number; pagoId?: never } | { pagoId: number; facturaId?: never };

export type DatosMovimientoCuenta = {
  clienteId: number;
  tipo: TipoMovimientoCuenta;
  importe: number; // centavos, > 0
  descripcion: string; // p. ej. "Recibo R 0001-00000341"
  origen: OrigenMovimiento;
  /** Momento de la operación; por defecto, el actual (lo pone la base). */
  fecha?: Date;
};

/**
 * Graba un movimiento de cuenta DENTRO de la transacción `tx` de la operación
 * que lo origina; nunca abre una propia. Si la operación mayor falla, el
 * movimiento se revierte con ella. No se expone en ninguna ruta.
 *
 * Reglas:
 * - importe entero positivo en centavos (regla 10);
 * - exactamente un origen: factura o pago; un débito solo nace de una
 *   factura (venta a cuenta). Un pago nunca crea un débito;
 * - regla 8: un crédito no puede superar el saldo (no hay saldos a favor).
 *   El control y la inserción ocurren en la misma transacción de escritura,
 *   así que ningún otro movimiento puede colarse entre ambos.
 *   (Decisión C1, temporal: la anulación de una factura a cuenta ya pagada
 *   se RECHAZA antes de llegar aquí, en exigirAnulacionSinSaldoAFavor() de
 *   src/servicios/facturas.ts. Este control queda como última barrera.)
 *
 * Devuelve el id del movimiento y el saldo del cliente después de grabarlo.
 */
export async function registrarMovimientoCuenta(
  tx: Transaccion,
  datos: DatosMovimientoCuenta,
): Promise<{ id: number; saldo: number }> {
  const { clienteId, tipo, importe, descripcion, origen, fecha } = datos;

  if (!Number.isSafeInteger(importe) || importe <= 0) {
    throw new Error("El importe de un movimiento de cuenta debe ser un entero positivo de centavos.");
  }
  const facturaId = origen.facturaId ?? null;
  const pagoId = origen.pagoId ?? null;
  if ((facturaId === null) === (pagoId === null)) {
    throw new Error("Un movimiento de cuenta debe tener exactamente un origen: factura o pago.");
  }
  if (tipo === "debito" && facturaId === null) {
    throw new Error("Un débito solo puede originarse en una factura.");
  }
  if (descripcion.trim().length === 0) {
    throw new Error("El movimiento de cuenta necesita una descripción.");
  }

  // Regla 8: el saldo nunca queda negativo.
  const saldoPrevio = await obtenerSaldo(tx, clienteId);
  const saldo = saldoPrevio + importeFirmado(tipo, importe);
  if (saldo < 0) {
    throw ApiError.desdeCodigo(
      "PAGO_SUPERA_DEUDA",
      saldoPrevio === 0
        ? "El cliente no tiene deuda pendiente."
        : "El importe del pago supera el saldo adeudado.",
      { saldoActual: saldoPrevio, importe },
    );
  }

  const [{ id }] = await tx
    .insert(movimientosCuenta)
    .values({ clienteId, tipo, importe, descripcion, facturaId, pagoId, ...(fecha && { fecha }) })
    .returning({ id: movimientosCuenta.id });

  return { id, saldo };
}

/** Débito por una venta a cuenta corriente (lo usará Nueva venta, RF-V6). */
export function registrarDebito(
  tx: Transaccion,
  datos: Omit<DatosMovimientoCuenta, "tipo" | "origen"> & { facturaId: number },
) {
  const { facturaId, ...resto } = datos;
  return registrarMovimientoCuenta(tx, { ...resto, tipo: "debito", origen: { facturaId } });
}

/** Crédito por un pago (RF-C5) o, más adelante, por la anulación de una venta (RF-V9). */
export function registrarCredito(
  tx: Transaccion,
  datos: Omit<DatosMovimientoCuenta, "tipo">,
) {
  return registrarMovimientoCuenta(tx, { ...datos, tipo: "credito" });
}
