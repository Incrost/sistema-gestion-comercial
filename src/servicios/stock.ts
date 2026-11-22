/**
 * Servicio de stock (RF-P4, RF-P5, RF-P6; reglas 1, 2 y 11). moverStock() es la
 * ÚNICA función que modifica `productos.existencia`: la llaman ingresos, egresos,
 * stock inicial, ventas y anulaciones.
 */
import "server-only";

import { and, count, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  facturas,
  movimientosStock,
  productos,
  usuarios,
  type Rol,
  type TipoMovimientoStock,
} from "@/db/schema";
import { enTransaccion, type Conexion, type Transaccion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { inicioDelDiaEnArgentina, inicioDelDiaSiguienteEnArgentina } from "@/lib/fechas";
import { formatearNumeroFactura } from "@/lib/formatos";
import { desplazamiento, type ListaPaginada } from "@/lib/paginacion";
import { esquemaParametrosId } from "@/lib/validacion";
import {
  esquemaConsultaMovimientos,
  esquemaConsultaMovimientosProducto,
  esquemaMovimientoManual,
  esquemaMovimientoStock,
} from "@/lib/validacion-productos";

import type { UsuarioAutenticado } from "./auth";
import { exigirRol, tieneRol } from "./permisos";
import { ahora } from "./reloj";

// ---------------------------------------------------------------------------
// Representación pública (sección 11.4)
// ---------------------------------------------------------------------------

export type MovimientoPublico = {
  id: number;
  producto: { id: number; codigo: string; descripcion: string };
  tipo: TipoMovimientoStock;
  /** Con signo: negativa en venta y egreso; positiva en ingreso y anulación. */
  cantidad: number;
  existenciaResultante: number;
  motivo: string;
  observacion: string | null;
  /** Factura de origen (solo ventas y anulaciones). */
  referencia: { facturaId: number; numero: string } | null;
  usuario: { id: number; nombre: string };
  fecha: string; // ISO 8601 UTC
};

/** Columnas que se leen para armar un movimiento público (lista blanca). */
const columnasMovimiento = {
  id: movimientosStock.id,
  productoId: productos.id,
  productoCodigo: productos.codigo,
  productoDescripcion: productos.descripcion,
  tipo: movimientosStock.tipo,
  cantidad: movimientosStock.cantidad,
  existenciaResultante: movimientosStock.existenciaResultante,
  motivo: movimientosStock.motivo,
  observacion: movimientosStock.observacion,
  facturaId: facturas.id,
  facturaPuntoVenta: facturas.puntoVenta,
  facturaNumero: facturas.numero,
  usuarioId: usuarios.id,
  usuarioNombre: usuarios.nombre,
  fecha: movimientosStock.fecha,
};

type FilaMovimiento = {
  id: number;
  productoId: number;
  productoCodigo: string;
  productoDescripcion: string;
  tipo: TipoMovimientoStock;
  cantidad: number;
  existenciaResultante: number;
  motivo: string;
  observacion: string | null;
  facturaId: number | null;
  facturaPuntoVenta: number | null;
  facturaNumero: number | null;
  usuarioId: number;
  usuarioNombre: string;
  fecha: Date;
};

/** Única conversión de una fila al movimiento público. */
export function aMovimientoPublico(fila: FilaMovimiento): MovimientoPublico {
  return {
    id: fila.id,
    producto: {
      id: fila.productoId,
      codigo: fila.productoCodigo,
      descripcion: fila.productoDescripcion,
    },
    tipo: fila.tipo,
    cantidad: fila.cantidad,
    existenciaResultante: fila.existenciaResultante,
    motivo: fila.motivo,
    observacion: fila.observacion,
    referencia:
      fila.facturaId !== null && fila.facturaPuntoVenta !== null && fila.facturaNumero !== null
        ? {
            facturaId: fila.facturaId,
            numero: formatearNumeroFactura(fila.facturaPuntoVenta, fila.facturaNumero),
          }
        : null,
    usuario: { id: fila.usuarioId, nombre: fila.usuarioNombre },
    fecha: fila.fecha.toISOString(),
  };
}

/** SELECT de movimientos con producto, usuario y factura (si la hay). */
function seleccionarMovimientos(conexion: Conexion) {
  return conexion
    .select(columnasMovimiento)
    .from(movimientosStock)
    .innerJoin(productos, eq(movimientosStock.productoId, productos.id))
    .innerJoin(usuarios, eq(movimientosStock.usuarioId, usuarios.id))
    .leftJoin(facturas, eq(movimientosStock.facturaId, facturas.id));
}

/** Del más nuevo al más viejo; a igual fecha, por id descendente. */
const ordenDescendente = [desc(movimientosStock.fecha), desc(movimientosStock.id)];

// ---------------------------------------------------------------------------
// moverStock() — reglas 1 y 2, RF-P4, RF-P5
// ---------------------------------------------------------------------------

/**
 * Quién origina cada movimiento (sección 3): ingreso y egreso, solo admin (RF-P4,
 * RF-P5); venta, ambos roles (RF-V6); anulación, solo admin (RF-V9).
 */
const ROLES_POR_TIPO: Record<TipoMovimientoStock, Rol[]> = {
  ingreso: ["admin"],
  egreso: ["admin"],
  venta: ["admin", "vendedor"],
  anulacion: ["admin"],
};

/** Venta y egreso restan existencia; ingreso y anulación la suman. */
function restaExistencia(tipo: TipoMovimientoStock): boolean {
  return tipo === "venta" || tipo === "egreso";
}

/**
 * Única vía para modificar `productos.existencia` (sección 10.2; reglas 1 y 2).
 * Con `tx` trabaja dentro de la operación mayor (alta, venta, anulación); si no,
 * abre su propia transacción. Sin stock suficiente → 409 STOCK_INSUFICIENTE.
 */
export async function moverStock(
  usuario: UsuarioAutenticado,
  datos: unknown,
  tx?: Transaccion,
): Promise<MovimientoPublico> {
  // 1. Validar.
  const movimiento = esquemaMovimientoStock.parse(datos);
  // 2. Permiso según el origen del movimiento.
  exigirRol(usuario, ...ROLES_POR_TIPO[movimiento.tipo]);

  const aplicar = async (t: Transaccion): Promise<MovimientoPublico> => {
    const { productoId, tipo, cantidad } = movimiento;
    const resta = restaExistencia(tipo);

    // 3-4. Regla 1 — la existencia nunca es negativa. El control y la
    // actualización son UNA sola sentencia atómica:
    //   UPDATE productos SET existencia = existencia - ?
    //   WHERE id = ? AND existencia >= ?
    // Si la existencia no alcanza, no se modifica ninguna fila. Así, si dos
    // operaciones compiten por la última unidad, solo una la obtiene.
    const [actualizado] = await t
      .update(productos)
      .set({
        existencia: resta
          ? sql`${productos.existencia} - ${cantidad}`
          : sql`${productos.existencia} + ${cantidad}`,
      })
      .where(
        resta
          ? and(eq(productos.id, productoId), gte(productos.existencia, cantidad))
          : eq(productos.id, productoId),
      )
      .returning({ existencia: productos.existencia });

    if (!actualizado) {
      const [producto] = await t
        .select({ existencia: productos.existencia })
        .from(productos)
        .where(eq(productos.id, productoId))
        .limit(1);
      if (!producto) throw ApiError.desdeCodigo("NO_ENCONTRADO", "El producto no existe.");
      throw ApiError.desdeCodigo(
        "STOCK_INSUFICIENTE",
        `La existencia disponible (${producto.existencia}) no alcanza para la cantidad solicitada (${cantidad}).`,
        [{ productoId, solicitado: cantidad, disponible: producto.existencia }],
      );
    }

    // Regla 2 — todo cambio de stock deja un movimiento, en la MISMA
    // transacción: si esta inserción falla, el UPDATE anterior se revierte.
    // Regla 11 — trazabilidad: usuario y fecha (reloj del servidor, ver reloj.ts).
    const [{ id }] = await t
      .insert(movimientosStock)
      .values({
        productoId,
        tipo,
        cantidad: resta ? -cantidad : cantidad, // el signo lo pone el servidor
        existenciaResultante: actualizado.existencia,
        motivo: movimiento.motivo,
        observacion: movimiento.observacion ?? null,
        usuarioId: usuario.id,
        facturaId: movimiento.facturaId ?? null,
        fecha: ahora(),
      })
      .returning({ id: movimientosStock.id });

    // 5. Forma pública.
    const [fila] = await seleccionarMovimientos(t).where(eq(movimientosStock.id, id));
    return aMovimientoPublico(fila);
  };

  return tx ? aplicar(tx) : enTransaccion(aplicar);
}

// ---------------------------------------------------------------------------
// Operaciones expuestas por la API
// ---------------------------------------------------------------------------

/**
 * RF-P4, RF-P5: ingreso o egreso manual (solo admin), desde
 * POST /api/productos/{id}/movimientos. No admite `venta` ni `anulacion`.
 * Delega en moverStock(): no hay otra forma de cambiar la existencia.
 */
export async function registrarMovimientoManual(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<MovimientoPublico> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  const movimiento = esquemaMovimientoManual.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");
  // 3-5. Reglas, base y forma pública: moverStock().
  return moverStock(usuario, { productoId: id, ...movimiento });
}

/**
 * Comprueba que el producto exista y que el usuario pueda verlo: al vendedor
 * no se le exponen productos inactivos (responde 404, como si no existiera).
 */
async function exigirProductoVisible(usuario: UsuarioAutenticado, id: number) {
  const [producto] = await db
    .select({ activo: productos.activo })
    .from(productos)
    .where(eq(productos.id, id))
    .limit(1);
  if (!producto || (!producto.activo && !tieneRol(usuario, "admin"))) {
    throw ApiError.desdeCodigo("NO_ENCONTRADO", "El producto no existe.");
  }
}

/**
 * RF-P6: historial de un producto, del más nuevo al más viejo, paginado.
 * Ambos roles. Incluye usuario y referencia a la factura cuando la hay.
 */
export async function listarMovimientosProducto(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  consulta: unknown,
): Promise<ListaPaginada<MovimientoPublico>> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  const { page, pageSize } = esquemaConsultaMovimientosProducto.parse(consulta);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  // 3. Reglas.
  await exigirProductoVisible(usuario, id);

  // 4. Base.
  const filtro = eq(movimientosStock.productoId, id);
  const [filas, [{ total }]] = await Promise.all([
    seleccionarMovimientos(db)
      .where(filtro)
      .orderBy(...ordenDescendente)
      .limit(pageSize)
      .offset(desplazamiento({ page, pageSize })),
    db.select({ total: count() }).from(movimientosStock).where(filtro),
  ]);

  // 5. Forma pública.
  return { data: filas.map(aMovimientoPublico), page, pageSize, total };
}

/**
 * RF-P6: movimientos de todos los productos, del más nuevo al más viejo.
 * Filtros: `productoId`, `tipo`, `desde` y `hasta` (días en hora de
 * Argentina, ambos inclusive). Ambos roles; al vendedor no se le muestran
 * movimientos de productos inactivos.
 */
export async function listarMovimientosStock(
  usuario: UsuarioAutenticado,
  consulta: unknown,
): Promise<ListaPaginada<MovimientoPublico>> {
  // 1. Validar.
  const { productoId, tipo, desde, hasta, page, pageSize } =
    esquemaConsultaMovimientos.parse(consulta);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");

  // 3. Reglas: armar el filtro.
  const condiciones: SQL[] = [];
  if (productoId !== undefined) condiciones.push(eq(movimientosStock.productoId, productoId));
  if (tipo !== undefined) condiciones.push(eq(movimientosStock.tipo, tipo));
  if (desde) condiciones.push(gte(movimientosStock.fecha, inicioDelDiaEnArgentina(desde)));
  if (hasta) condiciones.push(lt(movimientosStock.fecha, inicioDelDiaSiguienteEnArgentina(hasta)));
  if (!tieneRol(usuario, "admin")) condiciones.push(eq(productos.activo, true));
  const filtro = condiciones.length > 0 ? and(...condiciones) : undefined;

  // 4. Base.
  const [filas, [{ total }]] = await Promise.all([
    seleccionarMovimientos(db)
      .where(filtro)
      .orderBy(...ordenDescendente)
      .limit(pageSize)
      .offset(desplazamiento({ page, pageSize })),
    db
      .select({ total: count() })
      .from(movimientosStock)
      .innerJoin(productos, eq(movimientosStock.productoId, productos.id))
      .where(filtro),
  ]);

  // 5. Forma pública.
  return { data: filas.map(aMovimientoPublico), page, pageSize, total };
}
