/**
 * Borrador de Nueva venta (`/ventas/nueva`) — RF-V1 a RF-V6.
 *
 * Tipos y funciones PURAS del estado de la pantalla. Los componentes de
 * src/app/(protegido)/ventas/nueva/ solo guardan un `BorradorVenta` y lo
 * transforman con estas funciones; así cada regla visual está en un único
 * lugar y se prueba sin navegador (borrador-venta.test.ts).
 *
 * Principio central (sección 11.1, «Precios desde el servidor»): la interfaz
 * ADELANTA validaciones con los mismos esquemas y límites del servidor
 * (src/lib/validacion-facturas.ts), pero no decide nada. Precios, subtotales
 * y total son ESTIMADOS e informativos; el servidor vuelve a verificar
 * productos, existencias, precios, monto recibido, cuenta corriente, límite
 * de crédito y numeración al confirmar. El cuerpo enviado lleva solamente
 * `{ clienteId, items: [{ productoId, cantidad }], pago }`.
 *
 * Importes siempre en centavos enteros (regla 10).
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import type { TipoDocumento } from "@/db/schema"; // solo el tipo
import type { ClientePublico } from "@/servicios/clientes";
import type { FacturaPublica } from "@/servicios/facturas";
import type { ProductoPublico } from "@/servicios/productos";

import { ErrorDeApi, erroresDeZod, llamarApi, type ErroresCampo } from "./cliente-api";
import { formatearMoneda } from "./formatos";
import { pesosACentavos } from "./importes";
import { esquemaAltaCliente } from "./validacion-clientes";
import {
  CANTIDAD_MAXIMA_POR_RENGLON,
  esquemaCantidadItem,
  esquemaDatosTarjeta,
  esquemaEmisionFactura,
  IMPORTE_MAXIMO_FACTURA,
  RENGLONES_MAXIMOS,
  type FormaPago,
  type TipoTarjeta,
} from "./validacion-facturas";

// ---------------------------------------------------------------------------
// Tipos del borrador
// ---------------------------------------------------------------------------

/** Datos del producto que muestra la venta (consultados con GET /api/productos). */
export type ProductoVenta = Pick<ProductoPublico, "id" | "codigo" | "descripcion" | "precio" | "existencia">;

/** Datos del cliente que muestra la venta (consultados con GET /api/clientes). */
export type ClienteVenta = Pick<
  ClientePublico,
  "id" | "nombre" | "tipoDoc" | "nroDoc" | "saldo" | "cuentaCorriente" | "limiteCredito" | "disponible"
>;

/**
 * Renglón en edición. La cantidad se guarda como TEXTO, tal como la escribe
 * el vendedor: su validez se deriva con validarCantidad() y, mientras sea
 * inválida, se muestra el error y no se puede confirmar.
 */
export type RenglonBorrador = { producto: ProductoVenta; cantidad: string };

/** Forma de pago en edición. De la tarjeta, SOLO tipo, marca y últimos 4 (regla 9). */
export type PagoBorrador = {
  forma: FormaPago;
  /** Contado: pesos escritos por el vendedor ("15000,50"); vacío = igual al total. */
  montoRecibido: string;
  tarjetaTipo: TipoTarjeta | "";
  tarjetaMarca: string;
  tarjetaUltimos4: string;
};

export type BorradorVenta = {
  /** null = consumidor final (RF-V2). */
  cliente: ClienteVenta | null;
  renglones: RenglonBorrador[];
  pago: PagoBorrador;
};

export const PAGO_INICIAL: PagoBorrador = {
  forma: "contado",
  montoRecibido: "",
  tarjetaTipo: "",
  tarjetaMarca: "",
  tarjetaUltimos4: "",
};

/** RF-V2: la venta empieza a consumidor final, sin ítems y de contado. */
export function borradorInicial(): BorradorVenta {
  return { cliente: null, renglones: [], pago: { ...PAGO_INICIAL } };
}

/** Errores para mostrar: general, por campo (misma ruta que la API) y por producto. */
export type ErroresVenta = {
  general: string | null;
  campos: ErroresCampo;
  /** Mensaje por `productoId`, para mostrarlo en su renglón. */
  productos: Record<number, string>;
};

export const SIN_ERRORES: ErroresVenta = { general: null, campos: {}, productos: {} };

// ---------------------------------------------------------------------------
// Búsquedas (GET /api/productos y GET /api/clientes)
// ---------------------------------------------------------------------------

/** Cantidad de resultados que se piden en cada búsqueda. */
export const RESULTADOS_BUSQUEDA = 10;

/** Estados visuales de una búsqueda. */
export type EstadoBusqueda<T> =
  | { tipo: "inicial" }
  | { tipo: "cargando" }
  | { tipo: "vacio" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "resultados"; datos: T[] };

function urlBusqueda(ruta: string, texto: string): string | null {
  const q = texto.trim();
  if (q === "") return null;
  return `${ruta}?${new URLSearchParams({ q, pageSize: String(RESULTADOS_BUSQUEDA) })}`;
}

/**
 * Productos por código o descripción. El listado devuelve por defecto solo
 * los ACTIVOS (regla 12): no se pide `activo`.
 */
export function urlBusquedaProductos(texto: string): string | null {
  return urlBusqueda("/api/productos", texto);
}

/** Clientes por nombre o documento. Por defecto el listado devuelve solo los ACTIVOS. */
export function urlBusquedaClientes(texto: string): string | null {
  return urlBusqueda("/api/clientes", texto);
}

/** Lista recibida → estado «vacío» o «resultados». */
export function estadoDeResultados<T>(datos: T[]): EstadoBusqueda<T> {
  return datos.length === 0 ? { tipo: "vacio" } : { tipo: "resultados", datos };
}

/** Productos que se ofrecen en la venta: solo activos, con los datos que muestra la pantalla. */
export function productosVendibles(lista: ProductoPublico[]): ProductoVenta[] {
  return lista
    .filter((p) => p.activo)
    .map(({ id, codigo, descripcion, precio, existencia }) => ({ id, codigo, descripcion, precio, existencia }));
}

/** Clientes que se pueden seleccionar: nunca los inactivos. */
export function clientesSeleccionables(lista: ClientePublico[]): ClienteVenta[] {
  return lista.filter((c) => c.activo).map(aClienteVenta);
}

export function aClienteVenta(c: ClientePublico): ClienteVenta {
  return {
    id: c.id,
    nombre: c.nombre,
    tipoDoc: c.tipoDoc,
    nroDoc: c.nroDoc,
    saldo: c.saldo,
    cuentaCorriente: c.cuentaCorriente,
    limiteCredito: c.limiteCredito,
    disponible: c.disponible,
  };
}

/** Recorre una lista con las flechas, de forma circular. */
export function moverIndice(actual: number, delta: number, largo: number): number {
  if (largo <= 0) return 0;
  return (((actual + delta) % largo) + largo) % largo;
}

// ---------------------------------------------------------------------------
// Comprador — RF-V2
// ---------------------------------------------------------------------------

/**
 * Selecciona un cliente sin tocar los ítems. Si el pago estaba en cuenta
 * corriente y el nuevo cliente no la tiene habilitada, vuelve a contado.
 */
export function seleccionarCliente(b: BorradorVenta, cliente: ClienteVenta): BorradorVenta {
  const pago = b.pago.forma === "cuenta_corriente" && !cliente.cuentaCorriente ? { ...PAGO_INICIAL } : b.pago;
  return { ...b, cliente, pago };
}

/** Vuelve a consumidor final sin perder los ítems (regla 6: sin cuenta corriente). */
export function quitarCliente(b: BorradorVenta): BorradorVenta {
  const pago = b.pago.forma === "cuenta_corriente" ? { ...PAGO_INICIAL } : b.pago;
  return { ...b, cliente: null, pago };
}

// ---------------------------------------------------------------------------
// Ítems — RF-V3 y RF-V4
// ---------------------------------------------------------------------------

/** Máximo visual de un renglón: la existencia consultada, sin superar el máximo del servidor. */
export function cantidadMaxima(producto: ProductoVenta): number {
  return Math.max(0, Math.min(producto.existencia, CANTIDAD_MAXIMA_POR_RENGLON));
}

export type ResultadoCantidad = { ok: true; cantidad: number } | { ok: false; mensaje: string };

/**
 * Cantidad escrita por el vendedor: entero mayor que 0, dentro de
 * CANTIDAD_MAXIMA_POR_RENGLON (mismo esquema que el servidor) y sin superar
 * la existencia consultada (RF-V4).
 */
export function validarCantidad(texto: string, producto: ProductoVenta): ResultadoCantidad {
  const limpio = texto.trim();
  if (limpio === "") return { ok: false, mensaje: "Indique la cantidad." };
  if (!/^-?\d+(?:[.,]\d+)?$/.test(limpio)) return { ok: false, mensaje: "Debe ser un número entero." };
  const resultado = esquemaCantidadItem.safeParse(Number(limpio.replace(",", ".")));
  if (!resultado.success) return { ok: false, mensaje: resultado.error.issues[0].message };
  if (resultado.data > producto.existencia) {
    return {
      ok: false,
      mensaje:
        producto.existencia <= 0
          ? "El producto no tiene existencia disponible."
          : `Supera la existencia disponible (${producto.existencia}).`,
    };
  }
  return { ok: true, cantidad: resultado.data };
}

export type ResultadoBorrador = { ok: true; borrador: BorradorVenta } | { ok: false; mensaje: string };

/**
 * RF-V3: agrega un producto. Si ya está en la venta, SUMA la cantidad al
 * renglón existente (sin duplicarlo) y actualiza sus datos con los recién
 * consultados. Rechaza la operación si la suma supera la existencia.
 */
export function agregarProducto(b: BorradorVenta, producto: ProductoVenta, cantidadTexto: string): ResultadoBorrador {
  if (producto.existencia <= 0) return { ok: false, mensaje: "El producto no tiene existencia disponible." };
  const pedida = validarCantidad(cantidadTexto, producto);
  if (!pedida.ok) return pedida;

  const indice = b.renglones.findIndex((r) => r.producto.id === producto.id);
  if (indice === -1) {
    if (b.renglones.length >= RENGLONES_MAXIMOS) {
      return { ok: false, mensaje: `La venta no puede tener más de ${RENGLONES_MAXIMOS} productos distintos.` };
    }
    return { ok: true, borrador: { ...b, renglones: [...b.renglones, { producto, cantidad: String(pedida.cantidad) }] } };
  }

  const anterior = validarCantidad(b.renglones[indice].cantidad, b.renglones[indice].producto);
  const suma = (anterior.ok ? anterior.cantidad : 0) + pedida.cantidad;
  const total = validarCantidad(String(suma), producto);
  if (!total.ok) {
    return { ok: false, mensaje: `Ya hay ${anterior.ok ? anterior.cantidad : 0} en la venta. ${total.mensaje}` };
  }
  const renglones = b.renglones.map((r, i) => (i === indice ? { producto, cantidad: String(total.cantidad) } : r));
  return { ok: true, borrador: { ...b, renglones } };
}

/** Cambia el texto de la cantidad de un renglón (la validez se deriva al mostrar). */
export function cambiarCantidad(b: BorradorVenta, productoId: number, cantidad: string): BorradorVenta {
  return { ...b, renglones: b.renglones.map((r) => (r.producto.id === productoId ? { ...r, cantidad } : r)) };
}

export function quitarRenglon(b: BorradorVenta, productoId: number): BorradorVenta {
  return { ...b, renglones: b.renglones.filter((r) => r.producto.id !== productoId) };
}

/**
 * Tras un 409 STOCK_INSUFICIENTE, actualiza la existencia de los renglones
 * con lo que informó el servidor: el control visual pasa a marcar el exceso.
 */
export function actualizarExistencias(
  b: BorradorVenta,
  faltantes: { productoId: number; disponible: number }[],
): BorradorVenta {
  const disponibles = new Map(faltantes.map((f) => [f.productoId, f.disponible]));
  return {
    ...b,
    renglones: b.renglones.map((r) =>
      disponibles.has(r.producto.id) ? { ...r, producto: { ...r.producto, existencia: disponibles.get(r.producto.id)! } } : r,
    ),
  };
}

// ---------------------------------------------------------------------------
// Importes estimados (informativos; el servidor los recalcula)
// ---------------------------------------------------------------------------

export type RenglonCalculado = {
  renglon: RenglonBorrador;
  /** Cantidad válida, o null si el texto no es válido. */
  cantidad: number | null;
  error: string | null;
  /** precio × cantidad en centavos, o null si la cantidad no es válida. */
  subtotal: number | null;
};

const MENSAJE_IMPORTE_MAXIMO = "El importe supera el máximo admitido.";

/** Subtotal estimado en centavos enteros, o null si sale del rango exacto o del máximo. */
export function subtotalEstimado(precio: number, cantidad: number): number | null {
  const subtotal = precio * cantidad;
  return Number.isSafeInteger(subtotal) && subtotal <= IMPORTE_MAXIMO_FACTURA ? subtotal : null;
}

export function calcularRenglones(b: BorradorVenta): RenglonCalculado[] {
  return b.renglones.map((renglon) => {
    const cantidad = validarCantidad(renglon.cantidad, renglon.producto);
    if (!cantidad.ok) return { renglon, cantidad: null, error: cantidad.mensaje, subtotal: null };
    const subtotal = subtotalEstimado(renglon.producto.precio, cantidad.cantidad);
    return subtotal === null
      ? { renglon, cantidad: cantidad.cantidad, error: MENSAJE_IMPORTE_MAXIMO, subtotal: null }
      : { renglon, cantidad: cantidad.cantidad, error: null, subtotal };
  });
}

/** Total estimado: suma de los subtotales válidos, en centavos. */
export function totalEstimado(b: BorradorVenta): number {
  return calcularRenglones(b).reduce((suma, r) => suma + (r.subtotal ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Forma de pago — RF-V5
// ---------------------------------------------------------------------------

/** Cambia la forma de pago. Los datos de las otras formas se descartan (no se conservan datos de tarjeta). */
export function cambiarFormaPago(b: BorradorVenta, forma: FormaPago): BorradorVenta {
  return {
    ...b,
    pago: {
      ...PAGO_INICIAL,
      forma,
      ...(forma === "contado" && { montoRecibido: b.pago.montoRecibido }),
      ...(forma === "tarjeta" && {
        tarjetaTipo: b.pago.tarjetaTipo,
        tarjetaMarca: b.pago.tarjetaMarca,
        tarjetaUltimos4: b.pago.tarjetaUltimos4,
      }),
    },
  };
}

export function actualizarPago(b: BorradorVenta, campos: Partial<Omit<PagoBorrador, "forma">>): BorradorVenta {
  return { ...b, pago: { ...b.pago, ...campos } };
}

export type EstadoContado =
  | { ok: true; montoRecibido: number | null; vuelto: number }
  | { ok: false; mensaje: string };

/**
 * Contado: monto recibido opcional. Vacío = igual al total (vuelto 0). Un
 * monto menor que el total estimado se marca y bloquea la confirmación; el
 * servidor vuelve a verificarlo con el total real (MONTO_INSUFICIENTE).
 */
export function evaluarContado(texto: string, total: number): EstadoContado {
  if (texto.trim() === "") return { ok: true, montoRecibido: null, vuelto: 0 };
  const monto = pesosACentavos(texto);
  if (monto === null) return { ok: false, mensaje: "Ingrese un importe válido, por ejemplo 15000,50." };
  if (monto <= 0) return { ok: false, mensaje: "Debe ser mayor que 0." };
  if (monto > IMPORTE_MAXIMO_FACTURA) return { ok: false, mensaje: MENSAJE_IMPORTE_MAXIMO };
  if (monto < total) {
    return {
      ok: false,
      mensaje: `El monto recibido no cubre el total estimado: faltan ${formatearMoneda(total - monto)}.`,
    };
  }
  return { ok: true, montoRecibido: monto, vuelto: monto - total };
}

export type EstadoCuentaCorriente = {
  /** Se puede elegir la forma de pago (cliente registrado y habilitado). */
  habilitada: boolean;
  /** Por qué no se puede elegir. */
  motivo: string | null;
  /** Aviso no bloqueante: el total estimado supera el crédito disponible. */
  advertencia: string | null;
};

/**
 * Cuenta corriente (reglas 6 y 7): solo con cliente registrado y habilitado.
 * Si el total estimado supera el disponible, se ADVIERTE; quien decide es el
 * servidor, que recalcula el saldo y el límite (LIMITE_CREDITO_EXCEDIDO).
 */
export function evaluarCuentaCorriente(cliente: ClienteVenta | null, total: number): EstadoCuentaCorriente {
  if (!cliente) {
    return { habilitada: false, motivo: "Seleccione un cliente registrado para vender en cuenta corriente.", advertencia: null };
  }
  if (!cliente.cuentaCorriente) {
    return { habilitada: false, motivo: "El cliente no tiene la cuenta corriente habilitada.", advertencia: null };
  }
  const advertencia =
    cliente.disponible !== null && total > cliente.disponible
      ? `El total estimado (${formatearMoneda(total)}) supera el crédito disponible (${formatearMoneda(
          cliente.disponible,
        )}). El servidor rechazará la venta si excede el límite.`
      : null;
  return { habilitada: true, motivo: null, advertencia };
}

/** Errores de los datos de la tarjeta, con la misma ruta que la API (`pago.tarjeta.*`). */
export function validarTarjeta(pago: PagoBorrador): ErroresCampo {
  const errores: ErroresCampo = {};
  const resultado = esquemaDatosTarjeta.safeParse({
    tipo: pago.tarjetaTipo,
    marca: pago.tarjetaMarca,
    ultimos4: pago.tarjetaUltimos4,
  });
  if (!resultado.success) {
    for (const [campo, mensaje] of Object.entries(erroresDeZod(resultado.error))) errores[`pago.tarjeta.${campo}`] = mensaje;
  }
  if (pago.tarjetaTipo === "") errores["pago.tarjeta.tipo"] = "Seleccione débito o crédito.";
  return errores;
}

// ---------------------------------------------------------------------------
// Confirmación — POST /api/facturas
// ---------------------------------------------------------------------------

/** Cuerpo de POST /api/facturas: comprador, productos con cantidades y forma de pago. Nada más. */
export type CuerpoEmision = {
  clienteId: number | null;
  items: { productoId: number; cantidad: number }[];
  pago:
    | { forma: "contado"; montoRecibido?: number }
    | { forma: "tarjeta"; tarjeta: { tipo: TipoTarjeta; marca: string; ultimos4: string } }
    | { forma: "cuenta_corriente" };
};

export type ResultadoCuerpo = { ok: true; cuerpo: CuerpoEmision } | { ok: false; errores: ErroresVenta };

const MENSAJE_REVISAR = "Revise los datos marcados antes de confirmar.";

/**
 * Valida el borrador y arma el cuerpo de la emisión. Exige al menos un ítem,
 * cantidades válidas y los datos de la forma de pago. El cuerpo se verifica
 * además con esquemaEmisionFactura, el mismo esquema que usa el servidor.
 */
export function construirCuerpoEmision(b: BorradorVenta): ResultadoCuerpo {
  const errores: ErroresVenta = { general: null, campos: {}, productos: {} };
  const renglones = calcularRenglones(b);
  if (renglones.length === 0) errores.campos.items = "Debe agregar al menos un producto.";
  for (const r of renglones) if (r.error) errores.productos[r.renglon.producto.id] = r.error;

  const total = renglones.reduce((suma, r) => suma + (r.subtotal ?? 0), 0);
  if (total > IMPORTE_MAXIMO_FACTURA) errores.campos.items = "El total supera el importe máximo admitido.";

  let pago: CuerpoEmision["pago"];
  switch (b.pago.forma) {
    case "contado": {
      const contado = evaluarContado(b.pago.montoRecibido, total);
      if (!contado.ok) errores.campos["pago.montoRecibido"] = contado.mensaje;
      pago = contado.ok && contado.montoRecibido !== null ? { forma: "contado", montoRecibido: contado.montoRecibido } : { forma: "contado" };
      break;
    }
    case "tarjeta": {
      Object.assign(errores.campos, validarTarjeta(b.pago));
      pago = {
        forma: "tarjeta",
        tarjeta: {
          tipo: b.pago.tarjetaTipo as TipoTarjeta,
          marca: b.pago.tarjetaMarca,
          ultimos4: b.pago.tarjetaUltimos4,
        },
      };
      break;
    }
    case "cuenta_corriente": {
      const cuenta = evaluarCuentaCorriente(b.cliente, total);
      if (!cuenta.habilitada) errores.campos["pago.forma"] = cuenta.motivo!;
      pago = { forma: "cuenta_corriente" };
      break;
    }
  }

  const cuerpo: CuerpoEmision = {
    clienteId: b.cliente?.id ?? null,
    items: renglones.map((r) => ({ productoId: r.renglon.producto.id, cantidad: r.cantidad ?? 0 })),
    pago,
  };

  if (Object.keys(errores.campos).length > 0 || Object.keys(errores.productos).length > 0) {
    return { ok: false, errores: { ...errores, general: MENSAJE_REVISAR } };
  }

  // Defensa adicional: el mismo esquema del servidor.
  const validacion = esquemaEmisionFactura.safeParse(cuerpo);
  if (!validacion.success) {
    return { ok: false, errores: { ...repartirErroresCampo(erroresDeZod(validacion.error), b), general: MENSAJE_REVISAR } };
  }
  return { ok: true, cuerpo };
}

/** Lleva los errores `items.N.campo` al renglón N; el resto queda por campo. */
function repartirErroresCampo(campos: ErroresCampo, b: BorradorVenta): ErroresVenta {
  const resultado: ErroresVenta = { general: null, campos: {}, productos: {} };
  for (const [campo, mensaje] of Object.entries(campos)) {
    const coincidencia = /^items\.(\d+)(?:\.|$)/.exec(campo);
    const renglon = coincidencia ? b.renglones[Number(coincidencia[1])] : undefined;
    if (renglon) resultado.productos[renglon.producto.id] ??= mensaje;
    else resultado.campos[campo] = mensaje;
  }
  return resultado;
}

/** Envía la venta. POST /api/facturas es la ÚNICA vía de confirmación. */
export function enviarVenta(cuerpo: CuerpoEmision): Promise<FacturaPublica> {
  return llamarApi<FacturaPublica>("/api/facturas", { method: "POST", body: JSON.stringify(cuerpo) });
}

/** Comprobante de la factura emitida (RF-V7). */
export function rutaComprobante(id: number): string {
  return `/ventas/${id}`;
}

export type ResultadoEnvio<R> = { estado: "ok"; resultado: R } | { estado: "ignorado" } | { estado: "error"; error: unknown };

/**
 * Evita confirmaciones dobles: mientras un envío está en curso, los demás se
 * ignoran. Si el envío fue EXITOSO queda bloqueado (la pantalla se va al
 * comprobante y la venta no puede reenviarse); si falló, se libera para
 * poder corregir y reintentar.
 */
export function crearEnvioUnico<A, R>(enviar: (argumento: A) => Promise<R>) {
  let ocupado = false;
  return {
    get ocupado() {
      return ocupado;
    },
    async ejecutar(argumento: A): Promise<ResultadoEnvio<R>> {
      if (ocupado) return { estado: "ignorado" };
      ocupado = true;
      try {
        return { estado: "ok", resultado: await enviar(argumento) };
      } catch (error) {
        ocupado = false;
        return { estado: "error", error };
      }
    },
  };
}

export type Faltante = { productoId: number; solicitado: number; disponible: number };

export type ErrorEmisionInterpretado = ErroresVenta & {
  code: string;
  /** NO_AUTENTICADO: hay que volver a iniciar sesión. */
  sesionVencida: boolean;
  /** STOCK_INSUFICIENTE: lo solicitado y lo disponible por producto. */
  faltantes: Faltante[];
};

function esFaltante(d: unknown): d is Faltante {
  const f = d as Faltante;
  return typeof f?.productoId === "number" && typeof f.solicitado === "number" && typeof f.disponible === "number";
}

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor) ? valor : null;
}

/**
 * Traduce el error de POST /api/facturas a mensajes generales, por campo y
 * por producto (sección 11.6 y 11.8). La venta en curso NO se modifica:
 * solo, ante STOCK_INSUFICIENTE, el componente actualiza las existencias.
 */
export function interpretarErrorEmision(error: unknown, b: BorradorVenta): ErrorEmisionInterpretado {
  const base: ErrorEmisionInterpretado = {
    general: null,
    campos: {},
    productos: {},
    code: "ERROR_INTERNO",
    sesionVencida: false,
    faltantes: [],
  };
  if (!(error instanceof ErrorDeApi)) {
    return { ...base, general: "Ocurrió un error inesperado. La venta no se registró; intente nuevamente." };
  }
  const resultado: ErrorEmisionInterpretado = { ...base, code: error.code, general: error.message };
  const detalles = error.detalles;

  switch (error.code) {
    case "STOCK_INSUFICIENTE": {
      resultado.faltantes = Array.isArray(detalles) ? detalles.filter(esFaltante) : [];
      for (const f of resultado.faltantes) {
        resultado.productos[f.productoId] = `Existencia insuficiente: solicitado ${f.solicitado}, disponible ${f.disponible}.`;
      }
      resultado.general = `${error.message} La venta no se registró: ajuste las cantidades marcadas.`;
      break;
    }
    case "PRODUCTO_INACTIVO":
    case "NO_ENCONTRADO": {
      if (Array.isArray(detalles)) {
        for (const d of detalles as { productoId?: unknown; mensaje?: unknown }[]) {
          if (typeof d?.productoId === "number") {
            resultado.productos[d.productoId] = typeof d.mensaje === "string" ? d.mensaje : error.message;
          }
        }
      }
      if (Object.keys(resultado.productos).length > 0) resultado.general = `${error.message} Quite los productos marcados.`;
      break;
    }
    case "LIMITE_CREDITO_EXCEDIDO": {
      const d = (detalles ?? {}) as Record<string, unknown>;
      const [saldo, limite, excedente] = [numero(d.saldoActual), numero(d.limite), numero(d.excedente)];
      if (saldo !== null && limite !== null && excedente !== null) {
        resultado.general = `${error.message} Saldo actual: ${formatearMoneda(saldo)} · Límite: ${formatearMoneda(
          limite,
        )} · Excedente: ${formatearMoneda(excedente)}.`;
      }
      resultado.campos["pago.forma"] = "La venta supera el límite de crédito del cliente.";
      break;
    }
    case "MONTO_INSUFICIENTE": {
      const d = (detalles ?? {}) as Record<string, unknown>;
      const [total, faltante] = [numero(d.total), numero(d.faltante)];
      resultado.campos["pago.montoRecibido"] =
        total !== null && faltante !== null
          ? `El monto recibido no cubre el total de ${formatearMoneda(total)}: faltan ${formatearMoneda(faltante)}.`
          : error.message;
      break;
    }
    case "NO_AUTENTICADO":
      resultado.sesionVencida = true;
      break;
    default: {
      // VALIDACION, CUENTA_CORRIENTE_NO_HABILITADA y otros: errores por campo.
      const repartidos = repartirErroresCampo(error.campos, b);
      resultado.campos = repartidos.campos;
      resultado.productos = repartidos.productos;
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Descartar
// ---------------------------------------------------------------------------

export const MENSAJE_DESCARTE = "¿Desea descartar la venta en curso? Se perderán el comprador, los ítems y la forma de pago.";

/** La venta tiene datos cargados: descartarla exige confirmación. */
export function tieneDatos(b: BorradorVenta): boolean {
  return (
    b.cliente !== null ||
    b.renglones.length > 0 ||
    (Object.keys(PAGO_INICIAL) as (keyof PagoBorrador)[]).some((campo) => b.pago[campo] !== PAGO_INICIAL[campo])
  );
}

/** Descarta la venta si no tiene datos o si el vendedor lo confirma. */
export function descartarVenta(b: BorradorVenta, confirmar: (mensaje: string) => boolean): BorradorVenta | null {
  if (tieneDatos(b) && !confirmar(MENSAJE_DESCARTE)) return null;
  return borradorInicial();
}

// ---------------------------------------------------------------------------
// Atajos de teclado (sección 9: «Venta ágil»)
// ---------------------------------------------------------------------------

export type AccionAtajo = "producto" | "cliente" | "pago" | "confirmar";

export const ATAJOS: readonly { tecla: string; accion: AccionAtajo; descripcion: string }[] = [
  { tecla: "F2", accion: "producto", descripcion: "Buscar producto" },
  { tecla: "F4", accion: "cliente", descripcion: "Buscar cliente" },
  { tecla: "F8", accion: "pago", descripcion: "Forma de pago" },
  { tecla: "F9", accion: "confirmar", descripcion: "Confirmar venta" },
];

type TeclaPulsada = { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

/**
 * Acción de una tecla de función. Las teclas F no escriben texto, así que se
 * atienden también con el foco en un campo. No se interceptan combinaciones
 * con modificadores (atajos del navegador o del sistema) ni mientras hay una
 * ventana modal abierta.
 */
export function resolverAtajo(tecla: TeclaPulsada, opciones: { modalAbierto: boolean }): AccionAtajo | null {
  if (opciones.modalAbierto) return null;
  if (tecla.altKey || tecla.ctrlKey || tecla.metaKey || tecla.shiftKey) return null;
  return ATAJOS.find((a) => a.tecla === tecla.key)?.accion ?? null;
}

// ---------------------------------------------------------------------------
// Alta rápida de cliente — RF-V2 con RF-C2 (POST /api/clientes)
// ---------------------------------------------------------------------------

export type ValoresAltaRapida = {
  tipoDoc: TipoDocumento;
  nroDoc: string;
  nombre: string;
  domicilio: string;
  telefono: string;
  email: string;
  cuentaCorriente: boolean;
  /** Pesos escritos por el vendedor; vacío = sin límite. */
  limiteCredito: string;
};

export const ALTA_RAPIDA_INICIAL: ValoresAltaRapida = {
  tipoDoc: "DNI",
  nroDoc: "",
  nombre: "",
  domicilio: "",
  telefono: "",
  email: "",
  cuentaCorriente: false,
  limiteCredito: "",
};

/**
 * Arma el cuerpo de POST /api/clientes con todos los campos de RF-C2 y lo
 * valida con esquemaAltaCliente, el mismo del servidor. El límite solo se
 * envía con la cuenta corriente habilitada.
 */
export function prepararAltaRapida(
  v: ValoresAltaRapida,
): { ok: true; cuerpo: Record<string, unknown> } | { ok: false; errores: ErroresCampo } {
  let limiteCredito: number | null = null;
  if (v.cuentaCorriente && v.limiteCredito.trim() !== "") {
    limiteCredito = pesosACentavos(v.limiteCredito);
    if (limiteCredito === null) return { ok: false, errores: { limiteCredito: "Ingrese un importe válido, por ejemplo 150000,00." } };
  }
  const cuerpo = {
    tipoDoc: v.tipoDoc,
    nroDoc: v.nroDoc,
    nombre: v.nombre,
    domicilio: v.domicilio,
    telefono: v.telefono,
    email: v.email,
    cuentaCorriente: v.cuentaCorriente,
    limiteCredito,
  };
  const validacion = esquemaAltaCliente.safeParse(cuerpo);
  return validacion.success ? { ok: true, cuerpo } : { ok: false, errores: erroresDeZod(validacion.error) };
}
