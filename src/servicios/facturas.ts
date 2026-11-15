/**
 * Servicio de facturación: emisión de facturas (RF-V1 a RF-V6; reglas 1, 2,
 * 3, 4, 6, 7, 9, 10 y 11; sección 11.6).
 *
 * No conoce HTTP ni cookies: lo usan los Route Handlers de /api/facturas y lo
 * usarán la pantalla de Nueva venta y el script de datos iniciales.
 *
 * Emitir una factura es UNA transacción (RF-V6, sección 10.2): número,
 * factura, renglones, descuento de stock con sus movimientos y débito en la
 * cuenta corriente se graban todos o ninguno.
 *
 * Orden dentro de la transacción (sección 11.6):
 *   1. validar el cuerpo (esquemaEmisionFactura);
 *   2. productos existentes y activos;
 *   3. cliente existente y activo (si lo hay);
 *   4. cuenta corriente habilitada (si corresponde);
 *   5. existencias suficientes (todos los faltantes juntos);
 *   6. precios actuales → subtotales y total, en enteros exactos;
 *   7. monto recibido o límite de crédito;
 *   8. número correlativo;
 *   9-10. factura y renglones con los datos congelados;
 *   11. moverStock() por renglón (un movimiento de venta por renglón);
 *   12. registrarDebito() si es a cuenta corriente;
 *   13. representación pública.
 *
 * Los pasos 2 a 7 se ejecutan dos veces: antes de abrir la transacción, para
 * responder rápido sin tomar el bloqueo de escritura, y otra vez DENTRO de
 * ella, que es el control que vale. La transacción abre con BEGIN IMMEDIATE
 * y las escrituras se encolan (src/db/transaccion.ts): si dos vendedores
 * venden la última unidad a la vez, la segunda venta empieza cuando la
 * primera ya confirmó, ve la existencia en 0 y responde 409
 * STOCK_INSUFICIENTE sin consumir número. Además, el UPDATE condicional de
 * moverStock() (`WHERE existencia >= ?`) sigue siendo la barrera definitiva.
 *
 * Este módulo NUNCA modifica `productos.existencia` ni escribe
 * movimientos_cuenta por su cuenta: delega en moverStock() y registrarDebito().
 *
 * Solo servidor.
 */
import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { NUMERACION } from "@/config/comercio";
import { MOTIVO_VENTA } from "@/config/motivos-stock";
import { db } from "@/db";
import {
  clientes,
  facturaItems,
  facturas,
  productos,
  usuarios,
  type EstadoFactura,
  type FormaPago,
  type TipoDocumento,
  type TipoTarjeta,
} from "@/db/schema";
import { enTransaccion, type Conexion, type Transaccion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { formatearNumeroFactura } from "@/lib/formatos";
import {
  esquemaEmisionFactura,
  IMPORTE_MAXIMO_FACTURA,
  NOMBRE_CONSUMIDOR_FINAL,
  type DatosPagoFactura,
  type DatosTarjeta,
  type EmisionFacturaValidada,
} from "@/lib/validacion-facturas";

import type { UsuarioAutenticado } from "./auth";
import { exigirClienteDeCuenta, obtenerSaldo, registrarDebito } from "./cuenta-corriente";
import { asignarNumero, consultarProximoNumero as proximoNumeroDelTalonario } from "./numeracion";
import { exigirRol } from "./permisos";
import { moverStock } from "./stock";

// ---------------------------------------------------------------------------
// Representación pública (sección 11.6)
// ---------------------------------------------------------------------------

/** Comprador registrado, con los datos CONGELADOS en la factura (decisión D4). */
export type CompradorPublico = {
  id: number;
  nombre: string;
  tipoDoc: TipoDocumento | null;
  nroDoc: string | null;
  domicilio: string | null;
};

/** Renglón con código, descripción y precio congelados (regla 3). */
export type ItemFacturaPublico = {
  productoId: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number; // centavos
  subtotal: number; // centavos
};

/** Forma de pago pública. De la tarjeta, solo tipo, marca y últimos 4 (regla 9). */
export type PagoFacturaPublico =
  | { forma: "contado"; montoRecibido: number; vuelto: number }
  | { forma: "tarjeta"; tarjeta: { tipo: TipoTarjeta; marca: string; ultimos4: string } }
  | { forma: "cuenta_corriente" };

export type FacturaPublica = {
  id: number;
  puntoVenta: number;
  numero: number;
  numeroFormateado: string; // "0001-00000001"
  fecha: string; // ISO 8601 UTC
  estado: EstadoFactura;
  /** null = consumidor final (igual que `clienteId: null` en el cuerpo). */
  cliente: CompradorPublico | null;
  vendedor: { id: number; nombre: string };
  items: ItemFacturaPublico[];
  total: number; // centavos
  pago: PagoFacturaPublico;
  /** Solo en ventas a cuenta corriente: saldo del cliente después del débito. */
  saldoCliente?: number;
};

/** Columnas de la factura que se leen para la forma pública (lista blanca). */
const columnasFactura = {
  id: facturas.id,
  puntoVenta: facturas.puntoVenta,
  numero: facturas.numero,
  fecha: facturas.fecha,
  estado: facturas.estado,
  total: facturas.total,
  formaPago: facturas.formaPago,
  clienteId: facturas.clienteId,
  compradorNombre: facturas.compradorNombre,
  compradorTipoDoc: facturas.compradorTipoDoc,
  compradorNroDoc: facturas.compradorNroDoc,
  compradorDomicilio: facturas.compradorDomicilio,
  vendedorId: usuarios.id,
  vendedorNombre: usuarios.nombre,
  montoRecibido: facturas.montoRecibido,
  tarjetaTipo: facturas.tarjetaTipo,
  tarjetaMarca: facturas.tarjetaMarca,
  tarjetaUltimos4: facturas.tarjetaUltimos4,
};

type FilaFactura = {
  id: number;
  puntoVenta: number;
  numero: number;
  fecha: Date;
  estado: EstadoFactura;
  total: number;
  formaPago: FormaPago;
  clienteId: number | null;
  compradorNombre: string;
  compradorTipoDoc: TipoDocumento | null;
  compradorNroDoc: string | null;
  compradorDomicilio: string | null;
  vendedorId: number;
  vendedorNombre: string;
  montoRecibido: number | null;
  tarjetaTipo: TipoTarjeta | null;
  tarjetaMarca: string | null;
  tarjetaUltimos4: string | null;
};

/** Valor que las restricciones CHECK garantizan presente para esta forma de pago. */
function requerido<T>(valor: T | null, campo: string): T {
  if (valor === null) throw new Error(`Factura incoherente: falta ${campo}.`);
  return valor;
}

/** Forma de pago pública a partir de las columnas guardadas. */
function aPagoPublico(fila: FilaFactura): PagoFacturaPublico {
  switch (fila.formaPago) {
    case "contado": {
      const montoRecibido = requerido(fila.montoRecibido, "monto_recibido");
      return { forma: "contado", montoRecibido, vuelto: montoRecibido - fila.total };
    }
    case "tarjeta":
      return {
        forma: "tarjeta",
        tarjeta: {
          tipo: requerido(fila.tarjetaTipo, "tarjeta_tipo"),
          marca: requerido(fila.tarjetaMarca, "tarjeta_marca"),
          ultimos4: requerido(fila.tarjetaUltimos4, "tarjeta_ultimos4"),
        },
      };
    case "cuenta_corriente":
      return { forma: "cuenta_corriente" };
  }
}

/**
 * Única conversión de una factura guardada a su forma pública. Usa SOLO los
 * datos congelados en la factura y sus renglones: si después cambian el
 * cliente o el catálogo, la factura se sigue mostrando igual (regla 3, D4).
 */
export function aFacturaPublica(fila: FilaFactura, items: ItemFacturaPublico[]): FacturaPublica {
  return {
    id: fila.id,
    puntoVenta: fila.puntoVenta,
    numero: fila.numero,
    numeroFormateado: formatearNumeroFactura(fila.puntoVenta, fila.numero),
    fecha: fila.fecha.toISOString(),
    estado: fila.estado,
    cliente:
      fila.clienteId === null
        ? null
        : {
            id: fila.clienteId,
            nombre: fila.compradorNombre,
            tipoDoc: fila.compradorTipoDoc,
            nroDoc: fila.compradorNroDoc,
            domicilio: fila.compradorDomicilio,
          },
    vendedor: { id: fila.vendedorId, nombre: fila.vendedorNombre },
    items,
    total: fila.total,
    pago: aPagoPublico(fila),
  };
}

/**
 * Lee una factura con su vendedor y sus renglones (en el orden en que se
 * cargaron) y la lleva a la forma pública. null si no existe.
 * La reutilizará GET /api/facturas/{id}.
 */
export async function buscarFacturaPublica(conexion: Conexion, id: number): Promise<FacturaPublica | null> {
  const [fila] = await conexion
    .select(columnasFactura)
    .from(facturas)
    .innerJoin(usuarios, eq(facturas.vendedorId, usuarios.id))
    .where(eq(facturas.id, id))
    .limit(1);
  if (!fila) return null;

  const items = await conexion
    .select({
      productoId: facturaItems.productoId,
      codigo: facturaItems.codigo,
      descripcion: facturaItems.descripcion,
      cantidad: facturaItems.cantidad,
      precioUnitario: facturaItems.precioUnitario,
      subtotal: facturaItems.subtotal,
    })
    .from(facturaItems)
    .where(eq(facturaItems.facturaId, id))
    .orderBy(asc(facturaItems.id));

  return aFacturaPublica(fila, items);
}

// ---------------------------------------------------------------------------
// Pasos 2 a 7: verificación de la venta (sin escribir nada)
// ---------------------------------------------------------------------------

type ItemPedido = EmisionFacturaValidada["items"][number];

/** Producto tal como está en el catálogo en este momento. */
type ProductoVendible = {
  id: number;
  codigo: string;
  descripcion: string;
  precio: number;
  existencia: number;
  activo: boolean;
};

/** Datos del comprador que se congelan en la factura (RF-V2, decisión D4). */
type Comprador = {
  clienteId: number | null;
  nombre: string;
  tipoDoc: TipoDocumento | null;
  nroDoc: string | null;
  domicilio: string | null;
  cuentaCorriente: boolean;
  limiteCredito: number | null;
};

/** Renglón calculado por el servidor (mismos campos que el público). */
type Renglon = ItemFacturaPublico;

type PagoResuelto =
  | { forma: "contado"; montoRecibido: number; vuelto: number }
  | { forma: "tarjeta"; tarjeta: Pick<DatosTarjeta, "tipo" | "marca" | "ultimos4"> }
  | { forma: "cuenta_corriente"; saldoActual: number };

type VentaVerificada = {
  comprador: Comprador;
  renglones: Renglon[];
  total: number;
  pago: PagoResuelto;
};

/**
 * Paso 2 — RF-V3: todos los productos existen y están activos.
 * - inexistentes → 404 NO_ENCONTRADO, con cada `productoId` en details;
 * - dados de baja → 422 PRODUCTO_INACTIVO (regla 12: no se ofrecen en ventas).
 * Devuelve los productos por id, con el precio y la existencia actuales.
 */
async function recuperarProductos(conexion: Conexion, items: ItemPedido[]): Promise<Map<number, ProductoVendible>> {
  const filas = await conexion
    .select({
      id: productos.id,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      precio: productos.precio,
      existencia: productos.existencia,
      activo: productos.activo,
    })
    .from(productos)
    .where(inArray(productos.id, items.map((i) => i.productoId)));
  const porId = new Map(filas.map((p) => [p.id, p]));

  const inexistentes = items
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => !porId.has(item.productoId))
    .map(({ item, indice }) => ({
      campo: `items.${indice}.productoId`,
      productoId: item.productoId,
      mensaje: "El producto no existe.",
    }));
  if (inexistentes.length > 0) {
    throw ApiError.desdeCodigo(
      "NO_ENCONTRADO",
      inexistentes.length === 1 ? "El producto no existe." : "Algunos productos no existen.",
      inexistentes,
    );
  }

  const inactivos = items
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => !porId.get(item.productoId)!.activo)
    .map(({ item, indice }) => ({
      campo: `items.${indice}.productoId`,
      productoId: item.productoId,
      mensaje: "El producto está dado de baja.",
    }));
  if (inactivos.length > 0) throw ApiError.desdeCodigo("PRODUCTO_INACTIVO", undefined, inactivos);

  return porId;
}

/**
 * Paso 3 — RF-V2: comprador que se congela en la factura.
 * - sin cliente: «Consumidor final», sin documento ni domicilio;
 * - con cliente: debe existir y estar ACTIVO (la misma regla que la cuenta
 *   corriente: inexistente → 404; inactivo → 404 al vendedor y 422 al
 *   administrador). Se copian nombre, documento y domicilio actuales.
 */
async function congelarComprador(
  conexion: Conexion,
  usuario: UsuarioAutenticado,
  clienteId: number | null,
): Promise<Comprador> {
  if (clienteId === null) {
    return {
      clienteId: null,
      nombre: NOMBRE_CONSUMIDOR_FINAL,
      tipoDoc: null,
      nroDoc: null,
      domicilio: null,
      cuentaCorriente: false,
      limiteCredito: null,
    };
  }

  await exigirClienteDeCuenta(conexion, usuario, clienteId);
  const [cliente] = await conexion
    .select({
      nombre: clientes.nombre,
      tipoDoc: clientes.tipoDoc,
      nroDoc: clientes.nroDoc,
      domicilio: clientes.domicilio,
      cuentaCorriente: clientes.cuentaCorriente,
      limiteCredito: clientes.limiteCredito,
    })
    .from(clientes)
    .where(eq(clientes.id, clienteId))
    .limit(1);
  return { clienteId, ...cliente };
}

/**
 * Paso 4 — regla 6: consumidor final no compra en cuenta corriente; el
 * cliente debe tenerla habilitada. Si no → 422 CUENTA_CORRIENTE_NO_HABILITADA.
 */
function exigirCuentaCorriente(comprador: Comprador): void {
  if (comprador.clienteId === null) {
    throw ApiError.desdeCodigo(
      "CUENTA_CORRIENTE_NO_HABILITADA",
      "El consumidor final no puede comprar en cuenta corriente: seleccione un cliente registrado y habilitado.",
      [{ campo: "clienteId", mensaje: "Para vender a cuenta corriente debe seleccionar un cliente." }],
    );
  }
  if (!comprador.cuentaCorriente) {
    throw ApiError.desdeCodigo("CUENTA_CORRIENTE_NO_HABILITADA", undefined, [
      { campo: "pago.forma", mensaje: "El cliente no tiene la cuenta corriente habilitada." },
    ]);
  }
}

/**
 * Paso 5 — RF-V4, regla 1: la existencia alcanza para cada renglón. Reúne
 * TODOS los faltantes antes de escribir: 409 STOCK_INSUFICIENTE con
 * `details: [{ productoId, solicitado, disponible }]` (el mismo formato que
 * moverStock(), que vuelve a controlarlo con su UPDATE condicional).
 */
function exigirExistencias(items: ItemPedido[], catalogo: Map<number, ProductoVendible>): void {
  const faltantes = items
    .filter((item) => catalogo.get(item.productoId)!.existencia < item.cantidad)
    .map((item) => ({
      productoId: item.productoId,
      solicitado: item.cantidad,
      disponible: catalogo.get(item.productoId)!.existencia,
    }));
  if (faltantes.length > 0) {
    throw ApiError.desdeCodigo(
      "STOCK_INSUFICIENTE",
      faltantes.length === 1
        ? "La existencia no alcanza para la cantidad solicitada."
        : "La existencia no alcanza para varios productos.",
      faltantes,
    );
  }
}

/** Importe fuera del rango admitido: es un dato inválido (422), no un error interno. */
function importeFueraDeRango(campo: string, mensaje: string): ApiError {
  return ApiError.desdeCodigo("VALIDACION", undefined, [{ campo, mensaje }]);
}

/**
 * Paso 6 — reglas 3 y 10: precio unitario, subtotal y total con los precios
 * ACTUALES del catálogo (nunca enviados por el cliente), en centavos.
 *
 * Las multiplicaciones y sumas se hacen con BigInt, que es exacto para
 * cualquier tamaño: así se detecta un importe fuera de rango ANTES de que
 * pueda perder precisión. Si un subtotal o el total superan
 * IMPORTE_MAXIMO_FACTURA → 422 VALIDACION. El resultado vuelve a `number`
 * solo cuando ya se sabe que es un entero seguro.
 */
function calcularImportes(
  items: ItemPedido[],
  catalogo: Map<number, ProductoVendible>,
): { renglones: Renglon[]; total: number } {
  const maximo = BigInt(IMPORTE_MAXIMO_FACTURA);
  let total = BigInt(0);

  const renglones = items.map((item, indice): Renglon => {
    const producto = catalogo.get(item.productoId)!;
    if (!Number.isSafeInteger(producto.precio) || producto.precio < 0) {
      throw new Error(`Precio inválido en el catálogo para el producto ${producto.id}.`);
    }
    const subtotal = BigInt(producto.precio) * BigInt(item.cantidad);
    if (subtotal > maximo) {
      throw importeFueraDeRango(
        `items.${indice}.cantidad`,
        "El subtotal del renglón supera el importe máximo admitido.",
      );
    }
    total += subtotal;
    return {
      productoId: producto.id,
      codigo: producto.codigo,
      descripcion: producto.descripcion,
      cantidad: item.cantidad,
      precioUnitario: producto.precio,
      subtotal: Number(subtotal),
    };
  });

  if (total > maximo) {
    throw importeFueraDeRango("items", "El total de la factura supera el importe máximo admitido.");
  }
  if (total <= BigInt(0)) {
    throw importeFueraDeRango("items", "El total de la factura debe ser mayor que 0.");
  }
  return { renglones, total: Number(total) };
}

/**
 * Paso 7 — RF-V5: verifica la forma de pago contra el total.
 * - contado: `montoRecibido` (o el total si falta) debe cubrir el total;
 *   si no → 422 MONTO_INSUFICIENTE. vuelto = montoRecibido − total.
 * - tarjeta: solo tipo, marca y últimos 4 (regla 9; ya validados).
 * - cuenta corriente — regla 7: saldo actual (débitos − créditos, desde
 *   movimientos_cuenta) + total no puede superar el límite, si lo hay;
 *   si no → 422 LIMITE_CREDITO_EXCEDIDO con saldoActual, limite y excedente.
 */
async function resolverPago(
  conexion: Conexion,
  pago: DatosPagoFactura,
  total: number,
  comprador: Comprador,
): Promise<PagoResuelto> {
  switch (pago.forma) {
    case "contado": {
      const montoRecibido = pago.montoRecibido ?? total;
      if (montoRecibido < total) {
        throw ApiError.desdeCodigo("MONTO_INSUFICIENTE", undefined, {
          campo: "pago.montoRecibido",
          total,
          montoRecibido,
          faltante: total - montoRecibido,
        });
      }
      return { forma: "contado", montoRecibido, vuelto: montoRecibido - total };
    }
    case "tarjeta": {
      const { tipo, marca, ultimos4 } = pago.tarjeta;
      return { forma: "tarjeta", tarjeta: { tipo, marca, ultimos4 } };
    }
    case "cuenta_corriente": {
      const saldoActual = await obtenerSaldo(conexion, comprador.clienteId!);
      const limite = comprador.limiteCredito;
      if (limite !== null && saldoActual + total > limite) {
        throw ApiError.desdeCodigo(
          "LIMITE_CREDITO_EXCEDIDO",
          "La venta supera el límite de crédito del cliente.",
          { saldoActual, limite, total, excedente: saldoActual + total - limite },
        );
      }
      return { forma: "cuenta_corriente", saldoActual };
    }
  }
}

/** Pasos 2 a 7, en el orden de la sección 11.6. No escribe nada. */
async function verificarVenta(
  conexion: Conexion,
  usuario: UsuarioAutenticado,
  entrada: EmisionFacturaValidada,
): Promise<VentaVerificada> {
  const catalogo = await recuperarProductos(conexion, entrada.items); // 2
  const comprador = await congelarComprador(conexion, usuario, entrada.clienteId); // 3
  if (entrada.pago.forma === "cuenta_corriente") exigirCuentaCorriente(comprador); // 4
  exigirExistencias(entrada.items, catalogo); // 5
  const { renglones, total } = calcularImportes(entrada.items, catalogo); // 6
  const pago = await resolverPago(conexion, entrada.pago, total, comprador); // 7
  return { comprador, renglones, total, pago };
}

// ---------------------------------------------------------------------------
// Pasos 8 a 13: escritura (siempre dentro de la transacción)
// ---------------------------------------------------------------------------

/**
 * Graba la venta ya verificada DENTRO de `tx`. Si cualquier paso falla, la
 * transacción completa se revierte: no queda factura, renglón, movimiento,
 * débito ni número consumido (RF-V6, regla 4).
 */
async function grabarFactura(
  tx: Transaccion,
  usuario: UsuarioAutenticado,
  { comprador, renglones, total, pago }: VentaVerificada,
): Promise<FacturaPublica> {
  // 8. Regla 4 — número correlativo, asignado al confirmar y en esta transacción.
  const { puntoVenta } = NUMERACION.factura;
  const numero = await asignarNumero(tx, NUMERACION.factura);

  // 9. Factura con el comprador congelado (D4) y el vendedor y la fecha (regla 11).
  // Regla 9: de la tarjeta solo existen columnas para tipo, marca y últimos 4.
  const [factura] = await tx
    .insert(facturas)
    .values({
      puntoVenta,
      numero,
      total,
      formaPago: pago.forma,
      clienteId: comprador.clienteId,
      compradorNombre: comprador.nombre,
      compradorTipoDoc: comprador.tipoDoc,
      compradorNroDoc: comprador.nroDoc,
      compradorDomicilio: comprador.domicilio,
      vendedorId: usuario.id,
      montoRecibido: pago.forma === "contado" ? pago.montoRecibido : null,
      tarjetaTipo: pago.forma === "tarjeta" ? pago.tarjeta.tipo : null,
      tarjetaMarca: pago.forma === "tarjeta" ? pago.tarjeta.marca : null,
      tarjetaUltimos4: pago.forma === "tarjeta" ? pago.tarjeta.ultimos4 : null,
    })
    .returning({ id: facturas.id, fecha: facturas.fecha });

  // 10. Regla 3 — renglones con código, descripción y precio congelados.
  await tx.insert(facturaItems).values(renglones.map((r) => ({ facturaId: factura.id, ...r })));

  // 11. Reglas 1 y 2 — descuento de stock SOLO mediante moverStock(): un
  // movimiento de venta por renglón, con usuario, fecha y factura (regla 11).
  for (const r of renglones) {
    await moverStock(
      usuario,
      { productoId: r.productoId, tipo: "venta", cantidad: r.cantidad, motivo: MOTIVO_VENTA, facturaId: factura.id },
      tx,
    );
  }

  // 12. Regla 7 — débito en la cuenta corriente, con la fecha de la factura.
  let saldoCliente: number | undefined;
  if (pago.forma === "cuenta_corriente") {
    const debito = await registrarDebito(tx, {
      clienteId: comprador.clienteId!,
      importe: total,
      descripcion: `Factura ${formatearNumeroFactura(puntoVenta, numero)}`,
      facturaId: factura.id,
      fecha: factura.fecha,
    });
    saldoCliente = debito.saldo;
  }

  // 13. Forma pública, leída de lo que quedó grabado.
  const publica = (await buscarFacturaPublica(tx, factura.id))!;
  return saldoCliente === undefined ? publica : { ...publica, saldoCliente };
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * RF-V1 a RF-V6: emite una factura. Ambos roles (sección 3).
 *
 * Recibe el usuario autenticado y el cuerpo SIN validar
 * `{ clienteId, items: [{ productoId, cantidad }], pago: { forma, ... } }`.
 * Devuelve la factura pública (sección 11.6).
 *
 * Errores: 422 VALIDACION; 401/403; 404 NO_ENCONTRADO; 422 PRODUCTO_INACTIVO;
 * 422 CUENTA_CORRIENTE_NO_HABILITADA; 409 STOCK_INSUFICIENTE;
 * 422 MONTO_INSUFICIENTE; 422 LIMITE_CREDITO_EXCEDIDO.
 */
export async function emitirFactura(usuario: UsuarioAutenticado, datos: unknown): Promise<FacturaPublica> {
  // 1. Validar el cuerpo (estricto: sin precios, totales ni datos de tarjeta completos).
  const entrada = esquemaEmisionFactura.parse(datos);
  // Permiso: ambos roles emiten facturas.
  exigirRol(usuario, "admin", "vendedor");

  // 2-7. Control previo, sin tomar el bloqueo de escritura (respuesta rápida).
  await verificarVenta(db, usuario, entrada);

  // RF-V6 — una única transacción: o se graba todo o nada.
  return enTransaccion(async (tx) => {
    // 2-7 otra vez, con el bloqueo tomado: es el control que vale ante
    // ventas simultáneas (reglas 1 y 7).
    const venta = await verificarVenta(tx, usuario, entrada);
    // 8-13.
    return grabarFactura(tx, usuario, venta);
  });
}

/**
 * RF-V1: próximo número de factura, SOLO informativo
 * (GET /api/facturas/proximo-numero). No reserva ni consume numeración: el
 * número real se asigna al confirmar (regla 4). Ambos roles.
 */
export async function consultarProximoNumero(usuario: UsuarioAutenticado): Promise<{ numeroFormateado: string }> {
  exigirRol(usuario, "admin", "vendedor");
  const { puntoVenta } = NUMERACION.factura;
  const numero = await proximoNumeroDelTalonario(db, NUMERACION.factura);
  return { numeroFormateado: formatearNumeroFactura(puntoVenta, numero) };
}
