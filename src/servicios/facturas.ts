/**
 * Servicio de facturación (sección 11.6):
 * - emisión de facturas (RF-V1 a RF-V6; reglas 1, 2, 3, 4, 6, 7, 9, 10 y 11);
 * - consulta de una factura para el comprobante (RF-V7; reglas 3 y 11);
 * - listado con filtros, búsqueda y paginado (RF-V8);
 * - anulación (RF-V9; reglas 2, 5, 7 y 11; decisión temporal C1).
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
 * Anular también es UNA transacción (RF-V9, regla 5): estado y datos de
 * anulación, reingreso de stock (un movimiento de anulación por renglón) y,
 * si fue a cuenta corriente, el crédito por el total. Ver anularFactura().
 *
 * Este módulo NUNCA modifica `productos.existencia` ni escribe
 * movimientos_cuenta por su cuenta: delega en moverStock(), registrarDebito()
 * y registrarCredito().
 *
 * Solo servidor.
 */
import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { NUMERACION } from "@/config/comercio";
import { MOTIVO_ANULACION, MOTIVO_VENTA } from "@/config/motivos-stock";
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
import { inicioDelDiaEnArgentina, inicioDelDiaSiguienteEnArgentina } from "@/lib/fechas";
import { formatearNumeroFactura } from "@/lib/formatos";
import { desplazamiento, type ListaPaginada } from "@/lib/paginacion";
import {
  esquemaAnulacionFactura,
  esquemaConsultaFacturas,
  esquemaEmisionFactura,
  esquemaParametrosFactura,
  IMPORTE_MAXIMO_FACTURA,
  NOMBRE_CONSUMIDOR_FINAL,
  type DatosPagoFactura,
  type DatosTarjeta,
  type EmisionFacturaValidada,
} from "@/lib/validacion-facturas";

import type { UsuarioAutenticado } from "./auth";
import { exigirClienteDeCuenta, obtenerSaldo, registrarCredito, registrarDebito } from "./cuenta-corriente";
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
  /**
   * Solo en la RESPUESTA DE EMISIÓN de una venta a cuenta corriente: saldo
   * del cliente después del débito. NO se guarda en la factura, así que
   * GET /api/facturas/{id} lo OMITE (no se inventa un saldo histórico ni se
   * muestra el saldo actual como si fuera el de la venta).
   */
  saldoCliente?: number;
  /** Solo si la factura está anulada (RF-V9): fecha, usuario y motivo. */
  anulacion?: AnulacionPublica;
};

/** Datos de la anulación (RF-V9, regla 11: usuario y fecha y hora). */
export type AnulacionPublica = {
  fecha: string; // ISO 8601 UTC
  usuario: { id: number; nombre: string };
  motivo: string;
};

/**
 * Renglón del listado (RF-V8): encabezado de la factura SIN sus ítems.
 * Comprador y vendedor con los mismos datos y la misma forma que el detalle.
 */
export type FacturaResumenPublica = {
  id: number;
  puntoVenta: number;
  numero: number;
  numeroFormateado: string;
  fecha: string; // ISO 8601 UTC
  estado: EstadoFactura;
  cliente: CompradorPublico | null; // null = consumidor final
  vendedor: { id: number; nombre: string };
  formaPago: FormaPago;
  total: number; // centavos
};

/** Respuesta de GET /api/facturas: paginación + suma de las emitidas del filtro. */
export type ListaFacturas = ListaPaginada<FacturaResumenPublica> & {
  /** Suma de `total` de las facturas EMITIDAS que cumplen el filtro (centavos). */
  totalEmitido: number;
};

/** Usuario que anuló la factura (segunda referencia a `usuarios`). */
const anulador = alias(usuarios, "anulador");

/** Columnas del encabezado: comunes al detalle y al listado (lista blanca). */
const columnasEncabezado = {
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
};

type FilaEncabezado = {
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
};

/**
 * Regla 3, D4: comprador CONGELADO en la factura (nunca se lee de `clientes`).
 * null = consumidor final.
 */
function aCompradorPublico(fila: FilaEncabezado): CompradorPublico | null {
  return fila.clienteId === null
    ? null
    : {
        id: fila.clienteId,
        nombre: fila.compradorNombre,
        tipoDoc: fila.compradorTipoDoc,
        nroDoc: fila.compradorNroDoc,
        domicilio: fila.compradorDomicilio,
      };
}

/** RF-V8: renglón del listado a partir del encabezado. */
function aFacturaResumen(fila: FilaEncabezado): FacturaResumenPublica {
  return {
    id: fila.id,
    puntoVenta: fila.puntoVenta,
    numero: fila.numero,
    numeroFormateado: formatearNumeroFactura(fila.puntoVenta, fila.numero),
    fecha: fila.fecha.toISOString(),
    estado: fila.estado,
    cliente: aCompradorPublico(fila),
    vendedor: { id: fila.vendedorId, nombre: fila.vendedorNombre },
    formaPago: fila.formaPago,
    total: fila.total,
  };
}

/** Columnas de la factura que se leen para la forma pública completa (lista blanca). */
const columnasFactura = {
  ...columnasEncabezado,
  montoRecibido: facturas.montoRecibido,
  tarjetaTipo: facturas.tarjetaTipo,
  tarjetaMarca: facturas.tarjetaMarca,
  tarjetaUltimos4: facturas.tarjetaUltimos4,
  motivoAnulacion: facturas.motivoAnulacion,
  fechaAnulacion: facturas.fechaAnulacion,
  anuladorId: anulador.id,
  anuladorNombre: anulador.nombre,
};

type FilaFactura = FilaEncabezado & {
  montoRecibido: number | null;
  tarjetaTipo: TipoTarjeta | null;
  tarjetaMarca: string | null;
  tarjetaUltimos4: string | null;
  motivoAnulacion: string | null;
  fechaAnulacion: Date | null;
  anuladorId: number | null;
  anuladorNombre: string | null;
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

/** RF-V9: datos de la anulación; null si la factura sigue emitida. */
function aAnulacionPublica(fila: FilaFactura): AnulacionPublica | null {
  if (fila.estado !== "anulada") return null;
  return {
    fecha: requerido(fila.fechaAnulacion, "fecha_anulacion").toISOString(),
    usuario: { id: requerido(fila.anuladorId, "anulada_por_id"), nombre: requerido(fila.anuladorNombre, "anulada_por_id") },
    motivo: requerido(fila.motivoAnulacion, "motivo_anulacion"),
  };
}

/**
 * Única conversión de una factura guardada a su forma pública (RF-V7). La
 * usan la emisión, GET /api/facturas/{id} y la anulación. Usa SOLO los datos
 * congelados en la factura y sus renglones: si después cambian el cliente o
 * el catálogo, la factura se sigue mostrando igual (regla 3, D4).
 */
export function aFacturaPublica(fila: FilaFactura, items: ItemFacturaPublico[]): FacturaPublica {
  const resumen = aFacturaResumen(fila);
  const anulacion = aAnulacionPublica(fila);
  return {
    id: resumen.id,
    puntoVenta: resumen.puntoVenta,
    numero: resumen.numero,
    numeroFormateado: resumen.numeroFormateado,
    fecha: resumen.fecha,
    estado: resumen.estado,
    cliente: resumen.cliente,
    vendedor: resumen.vendedor,
    items,
    total: resumen.total,
    pago: aPagoPublico(fila),
    ...(anulacion && { anulacion }),
  };
}

/**
 * Lee una factura con su vendedor, su anulación (si la hay) y sus renglones
 * (en el orden en que se cargaron) y la lleva a la forma pública. null si no
 * existe. La usan emitirFactura(), obtenerFactura() y anularFactura().
 */
export async function buscarFacturaPublica(conexion: Conexion, id: number): Promise<FacturaPublica | null> {
  const [fila] = await conexion
    .select(columnasFactura)
    .from(facturas)
    .innerJoin(usuarios, eq(facturas.vendedorId, usuarios.id))
    .leftJoin(anulador, eq(facturas.anuladaPorId, anulador.id))
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

// ---------------------------------------------------------------------------
// RF-V8 — listado de facturas
// ---------------------------------------------------------------------------

/** Escapa los comodines de LIKE para buscar el texto literal. */
function patronContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Búsqueda `q` del listado (RF-V8). Coincide si se cumple alguna de:
 * - nombre CONGELADO del comprador contiene el texto (sin distinguir
 *   mayúsculas; «Consumidor final» también es un nombre congelado);
 * - número completo: «0001-00000123», «1-123» o «000100000123» (12 dígitos)
 *   → punto de venta y número exactos;
 * - parte numérica (1 a 8 dígitos): el número, escrito con sus 8 dígitos,
 *   contiene esos dígitos («123» encuentra 00000123 y 00001234).
 */
function condicionBusqueda(q: string): SQL {
  const condiciones: SQL[] = [
    sql`lower(${facturas.compradorNombre}) like ${patronContiene(q.toLowerCase())} escape '\\'`,
  ];
  const completo = /^(\d{1,4})-(\d{1,8})$/.exec(q) ?? /^(\d{4})(\d{8})$/.exec(q);
  if (completo) {
    condiciones.push(and(eq(facturas.puntoVenta, Number(completo[1])), eq(facturas.numero, Number(completo[2])))!);
  } else if (/^\d{1,8}$/.test(q)) {
    condiciones.push(sql`printf('%08d', ${facturas.numero}) like ${patronContiene(q)} escape '\\'`);
  }
  return or(...condiciones)!;
}

/** Regla 10: suma en centavos de las facturas EMITIDAS del filtro (las anuladas no cuentan). */
const sumaEmitida = sql<number>`coalesce(sum(case when ${facturas.estado} = 'emitida' then ${facturas.total} else 0 end), 0)`.mapWith(
  Number,
);

/**
 * RF-V8: listado de facturas, de la más nueva a la más vieja (a igual fecha,
 * por id descendente: orden estable), paginado y SIN renglones. Ambos roles.
 *
 * Filtros (todos combinables): `q`, `desde`, `hasta` (días de Argentina,
 * inclusive), `clienteId`, `vendedorId` (aunque el cliente o el usuario estén
 * inactivos), `forma` y `estado`.
 *
 * Responde `{ data, page, pageSize, total, totalEmitido }`; `totalEmitido`
 * suma solo las emitidas que cumplen TODOS los filtros.
 */
export async function listarFacturas(usuario: UsuarioAutenticado, consulta: unknown): Promise<ListaFacturas> {
  // 1. Validar.
  const { q, desde, hasta, clienteId, vendedorId, forma, estado, page, pageSize } =
    esquemaConsultaFacturas.parse(consulta);
  // 2. Permiso: ambos roles consultan facturas (sección 3).
  exigirRol(usuario, "admin", "vendedor");

  // 3. Reglas: armar el filtro.
  const condiciones: SQL[] = [];
  if (q) condiciones.push(condicionBusqueda(q));
  if (desde) condiciones.push(gte(facturas.fecha, inicioDelDiaEnArgentina(desde)));
  if (hasta) condiciones.push(lt(facturas.fecha, inicioDelDiaSiguienteEnArgentina(hasta)));
  if (clienteId !== undefined) condiciones.push(eq(facturas.clienteId, clienteId));
  if (vendedorId !== undefined) condiciones.push(eq(facturas.vendedorId, vendedorId));
  if (forma !== undefined) condiciones.push(eq(facturas.formaPago, forma));
  if (estado !== undefined) condiciones.push(eq(facturas.estado, estado));
  const filtro = condiciones.length > 0 ? and(...condiciones) : undefined;

  // 4. Base: una página de encabezados (sin factura_items) y los totales.
  const [filas, [totales]] = await Promise.all([
    db
      .select(columnasEncabezado)
      .from(facturas)
      .innerJoin(usuarios, eq(facturas.vendedorId, usuarios.id))
      .where(filtro)
      .orderBy(desc(facturas.fecha), desc(facturas.id))
      .limit(pageSize)
      .offset(desplazamiento({ page, pageSize })),
    db.select({ total: count(), totalEmitido: sumaEmitida }).from(facturas).where(filtro),
  ]);

  // 5. Forma pública.
  return {
    data: filas.map(aFacturaResumen),
    page,
    pageSize,
    total: totales.total,
    totalEmitido: totales.totalEmitido,
  };
}

/** Opción de un filtro del listado: `{ id, nombre }`. */
export type OpcionFiltro = { id: number; nombre: string };

/**
 * RF-V8 (apoyo de la pantalla /ventas): clientes y vendedores que figuran en
 * alguna factura, para llenar los filtros. Incluye inactivos, porque el
 * historial no se oculta. Ambos roles.
 */
export async function opcionesFiltroFacturas(
  usuario: UsuarioAutenticado,
): Promise<{ clientes: OpcionFiltro[]; vendedores: OpcionFiltro[] }> {
  exigirRol(usuario, "admin", "vendedor");
  const [clientesConFacturas, vendedores] = await Promise.all([
    db
      .selectDistinct({ id: clientes.id, nombre: clientes.nombre })
      .from(facturas)
      .innerJoin(clientes, eq(facturas.clienteId, clientes.id))
      .orderBy(asc(clientes.nombre), asc(clientes.id)),
    db
      .selectDistinct({ id: usuarios.id, nombre: usuarios.nombre })
      .from(facturas)
      .innerJoin(usuarios, eq(facturas.vendedorId, usuarios.id))
      .orderBy(asc(usuarios.nombre), asc(usuarios.id)),
  ]);
  return { clientes: clientesConFacturas, vendedores };
}

// ---------------------------------------------------------------------------
// RF-V7 — consulta de una factura (comprobante)
// ---------------------------------------------------------------------------

/**
 * RF-V7: la factura completa, con la misma forma que la respuesta de emisión
 * (reglas 3 y 11: datos congelados, vendedor y fecha). Si está anulada,
 * agrega `anulacion` con fecha, usuario y motivo. Ambos roles.
 *
 * `saldoCliente` se OMITE: no se guarda en la factura y no se inventa un
 * saldo histórico (el saldo actual se consulta en la cuenta corriente).
 * Inexistente → 404 NO_ENCONTRADO.
 */
export async function obtenerFactura(usuario: UsuarioAutenticado, parametros: unknown): Promise<FacturaPublica> {
  // 1. Validar.
  const { id } = esquemaParametrosFactura.parse(parametros);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  // 3-5. Base y forma pública.
  const factura = await buscarFacturaPublica(db, id);
  if (!factura) throw ApiError.desdeCodigo("NO_ENCONTRADO", "La factura no existe.");
  return factura;
}

// ---------------------------------------------------------------------------
// RF-V9 — anulación
// ---------------------------------------------------------------------------

/**
 * DECISIÓN TEMPORAL C1 (pendiente de consulta al profesor).
 *
 * Contradicción: RF-V9 pide registrar un crédito por el TOTAL al anular una
 * factura a cuenta corriente, pero la regla 8 prohíbe los saldos a favor. Si
 * el cliente ya pagó (total o parcialmente), ese crédito dejaría el saldo
 * negativo.
 *
 * Solución conservadora adoptada: si el saldo actual es MENOR que el total de
 * la factura, la anulación se RECHAZA con 422 VALIDACION (sin código nuevo),
 * con `details: { saldoActual, totalFactura }`, y no se modifica nada. No se
 * anulan ni devuelven pagos (fuera del alcance actual).
 *
 * Para cambiar el criterio cuando el profesor lo aclare (p. ej. permitir el
 * saldo a favor o acreditar solo hasta el saldo), basta modificar ESTA
 * función (y, si se permitiera el saldo a favor, la regla 8 de
 * registrarMovimientoCuenta()).
 */
export function exigirAnulacionSinSaldoAFavor(saldoActual: number, totalFactura: number): void {
  if (saldoActual < totalFactura) {
    throw ApiError.desdeCodigo(
      "VALIDACION",
      "La factura no puede anularse porque el cliente tiene pagos aplicados en su cuenta corriente: " +
        "el crédito por el total dejaría un saldo a favor. Gestione primero esos pagos.",
      { saldoActual, totalFactura },
    );
  }
}

/** Factura que se va a anular, con lo necesario para revertirla. */
type FacturaAnulable = {
  id: number;
  puntoVenta: number;
  numero: number;
  total: number;
  formaPago: FormaPago;
  clienteId: number | null;
};

/**
 * Reglas previas a la anulación (RF-V9, regla 5), sin escribir nada:
 * - inexistente → 404 NO_ENCONTRADO;
 * - ya anulada → 409 FACTURA_ANULADA;
 * - a cuenta corriente: decisión C1 (exigirAnulacionSinSaldoAFavor).
 */
async function verificarAnulable(conexion: Conexion, id: number): Promise<FacturaAnulable> {
  const [factura] = await conexion
    .select({
      id: facturas.id,
      puntoVenta: facturas.puntoVenta,
      numero: facturas.numero,
      estado: facturas.estado,
      total: facturas.total,
      formaPago: facturas.formaPago,
      clienteId: facturas.clienteId,
    })
    .from(facturas)
    .where(eq(facturas.id, id))
    .limit(1);
  if (!factura) throw ApiError.desdeCodigo("NO_ENCONTRADO", "La factura no existe.");
  if (factura.estado === "anulada") throw ApiError.desdeCodigo("FACTURA_ANULADA");

  if (factura.formaPago === "cuenta_corriente") {
    // Regla 7: saldo actual = débitos − créditos (dentro de la transacción
    // cuando `conexion` es `tx`).
    const saldoActual = await obtenerSaldo(conexion, requerido(factura.clienteId, "cliente_id"));
    exigirAnulacionSinSaldoAFavor(saldoActual, factura.total);
  }
  return {
    id: factura.id,
    puntoVenta: factura.puntoVenta,
    numero: factura.numero,
    total: factura.total,
    formaPago: factura.formaPago,
    clienteId: factura.clienteId,
  };
}

/**
 * RF-V9: anula una factura. SOLO el administrador (sección 3).
 *
 * Recibe el usuario autenticado, los parámetros de la ruta `{ id }` y el
 * cuerpo SIN validar `{ motivo }`. Regla 5: la factura nunca se edita ni se
 * borra; solo cambia a «anulada» y queda visible.
 *
 * En UNA transacción (todo o nada):
 *   a. vuelve a leer la factura con el bloqueo de escritura tomado;
 *   b. verifica que siga emitida (y la decisión C1 si es a cuenta);
 *   c-d. la marca anulada con motivo, fecha y usuario (regla 11), con un
 *        UPDATE condicional `WHERE estado = 'emitida'`;
 *   e-f. reingresa cada renglón con moverStock() (regla 2): un movimiento de
 *        tipo «anulacion» por renglón, cantidad positiva, existencia
 *        resultante, usuario, fecha y factura;
 *   g. si fue a cuenta corriente, un crédito por el total con
 *      registrarCredito() (regla 7), vinculado con la factura;
 *   h. devuelve la factura actualizada (misma forma que GET /api/facturas/{id}).
 *
 * Contado y tarjeta no crean movimientos de cuenta.
 * Errores: 422 VALIDACION, 401/403 SIN_PERMISO, 404 NO_ENCONTRADO,
 * 409 FACTURA_ANULADA y 422 VALIDACION por la decisión C1.
 */
export async function anularFactura(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<FacturaPublica> {
  // 1. Validar (solo `motivo`, recortado y con longitud acotada).
  const { id } = esquemaParametrosFactura.parse(parametros);
  const { motivo } = esquemaAnulacionFactura.parse(datos);
  // 2. Permiso: solo el administrador anula (RF-V9).
  exigirRol(usuario, "admin");
  // 3. Control previo, sin tomar el bloqueo de escritura (respuesta rápida).
  await verificarAnulable(db, id);

  // 4. Transacción: todo o nada.
  return enTransaccion(async (tx) => {
    // a-b. Otra vez, con el bloqueo tomado: es el control que vale ante dos
    // anulaciones simultáneas (la segunda ve «anulada» → 409).
    const factura = await verificarAnulable(tx, id);

    // c-d. Reglas 5 y 11: estado, motivo, fecha y usuario. El WHERE por
    // estado es una barrera más: nunca se anula dos veces.
    const fechaAnulacion = new Date();
    const marcadas = await tx
      .update(facturas)
      .set({ estado: "anulada", motivoAnulacion: motivo, fechaAnulacion, anuladaPorId: usuario.id })
      .where(and(eq(facturas.id, id), eq(facturas.estado, "emitida")))
      .returning({ id: facturas.id });
    if (marcadas.length === 0) throw ApiError.desdeCodigo("FACTURA_ANULADA");

    // e-f. Reglas 2 y 11: reingreso SOLO mediante moverStock(), un
    // movimiento de anulación por renglón, en el orden de la factura.
    const renglones = await tx
      .select({ productoId: facturaItems.productoId, cantidad: facturaItems.cantidad })
      .from(facturaItems)
      .where(eq(facturaItems.facturaId, id))
      .orderBy(asc(facturaItems.id));
    for (const r of renglones) {
      await moverStock(
        usuario,
        { productoId: r.productoId, tipo: "anulacion", cantidad: r.cantidad, motivo: MOTIVO_ANULACION, facturaId: id },
        tx,
      );
    }

    // g. Regla 7: crédito por el total, vinculado con la factura.
    if (factura.formaPago === "cuenta_corriente") {
      await registrarCredito(tx, {
        clienteId: requerido(factura.clienteId, "cliente_id"),
        importe: factura.total,
        descripcion: `Anulación factura ${formatearNumeroFactura(factura.puntoVenta, factura.numero)}`,
        origen: { facturaId: id },
        fecha: fechaAnulacion,
      });
    }

    // h. Forma pública, leída de lo que quedó grabado.
    return (await buscarFacturaPublica(tx, id))!;
  });
}
