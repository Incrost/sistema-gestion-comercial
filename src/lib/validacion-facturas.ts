/**
 * Validación de facturas (RF-V1 a RF-V6; reglas 3, 9 y 10), compartida por el
 * servicio y la pantalla de Nueva venta. Objetos estrictos: número completo de
 * tarjeta o CVV → 422 (regla 9). Precios y total los decide el servidor (11.1).
 */
import { z } from "zod";

import {
  ESTADOS_FACTURA,
  FORMAS_PAGO,
  TIPOS_TARJETA,
  type EstadoFactura,
  type FormaPago,
  type TipoTarjeta,
} from "@/db/schema";

import { normalizarEspacios } from "./normalizacion";
import {
  esquemaFechaFiltro,
  esquemaId,
  esquemaIdTexto,
  esquemaImportePositivo,
  esquemaPaginacion,
  esquemaParametrosId,
  esquemaUltimos4,
} from "./validacion";

export { ESTADOS_FACTURA, FORMAS_PAGO, TIPOS_TARJETA, type EstadoFactura, type FormaPago, type TipoTarjeta };

// ---------------------------------------------------------------------------
// Límites seguros (regla 10)
// ---------------------------------------------------------------------------

/** Máximo de renglones distintos en una factura. */
export const RENGLONES_MAXIMOS = 100;

/**
 * Máximo de unidades de un mismo producto en un renglón. Para cambiar la
 * regla (p. ej. «no más de 50 unidades por producto») basta modificar este valor.
 */
export const CANTIDAD_MAXIMA_POR_RENGLON = 100_000;

/**
 * Importe máximo de un subtotal, del total y del monto recibido:
 * $ 999.999.999.999,99 en centavos. Está muy por debajo de
 * Number.MAX_SAFE_INTEGER (≈ 9 × 10^15), así que cualquier suma o resta de
 * importes válidos sigue siendo un entero exacto.
 */
export const IMPORTE_MAXIMO_FACTURA = 99_999_999_999_999;

/** Longitud máxima del nombre de la marca de la tarjeta. */
export const MARCA_TARJETA_MAXIMA = 30;

/** Marcas sugeridas para el formulario (la marca es texto libre validado, decisión D6). */
export const MARCAS_TARJETA_SUGERIDAS = [
  "Visa",
  "Mastercard",
  "American Express",
  "Cabal",
  "Naranja",
  "Maestro",
] as const;

/** Nombre con el que se congela al comprador sin cliente registrado (RF-V2). */
export const NOMBRE_CONSUMIDOR_FINAL = "Consumidor final";

/** Nombre visible de cada forma de pago (pantallas y comprobante). */
export const ETIQUETAS_FORMA_PAGO: Record<FormaPago, string> = {
  contado: "Contado",
  tarjeta: "Tarjeta",
  cuenta_corriente: "Cuenta corriente",
};

/** Nombre visible de cada estado de factura. */
export const ETIQUETAS_ESTADO_FACTURA: Record<EstadoFactura, string> = {
  emitida: "Emitida",
  anulada: "Anulada",
};

/** Nombre visible de cada tipo de tarjeta. */
export const ETIQUETAS_TIPO_TARJETA: Record<TipoTarjeta, string> = {
  debito: "Débito",
  credito: "Crédito",
};

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

/** Campo que nunca se acepta: si llega con cualquier valor, falla con `mensaje`. */
function campoProhibido(mensaje: string) {
  return z.never({ error: mensaje }).optional();
}

const MENSAJE_PRECIOS =
  "Los precios, subtotales y el total los calcula el servidor con los precios del catálogo.";
const MENSAJE_DATOS_CATALOGO =
  "El código y la descripción se toman del catálogo: solo se indica el producto y la cantidad.";
const MENSAJE_TARJETA_COMPLETA =
  "No se admite el número completo ni los datos de seguridad de la tarjeta: solo tipo, marca y últimos 4 dígitos.";

/** Campos con datos sensibles de la tarjeta que se rechazan expresamente (regla 9). */
const camposTarjetaProhibidos = {
  numero: campoProhibido(MENSAJE_TARJETA_COMPLETA),
  numeroCompleto: campoProhibido(MENSAJE_TARJETA_COMPLETA),
  numeroTarjeta: campoProhibido(MENSAJE_TARJETA_COMPLETA),
  cvv: campoProhibido(MENSAJE_TARJETA_COMPLETA),
  codigoSeguridad: campoProhibido(MENSAJE_TARJETA_COMPLETA),
  vencimiento: campoProhibido(MENSAJE_TARJETA_COMPLETA),
};

/** Importe en centavos dentro del máximo de una factura. */
const esquemaImporteFactura = esquemaImportePositivo.max(
  IMPORTE_MAXIMO_FACTURA,
  "El importe supera el máximo admitido.",
);

// ---------------------------------------------------------------------------
// Ítems — RF-V3
// ---------------------------------------------------------------------------

/** Cantidad de un renglón: entero mayor que 0 y dentro del máximo. */
export const esquemaCantidadItem = z
  .number({ error: (issue) => (issue.input == null ? "Es obligatorio." : "Debe ser un número.") })
  .int("Debe ser un número entero.")
  .min(1, "Debe ser mayor que 0.")
  .max(CANTIDAD_MAXIMA_POR_RENGLON, `No puede superar ${CANTIDAD_MAXIMA_POR_RENGLON} unidades.`);

/** Un renglón: solo el producto y la cantidad. */
export const esquemaItemFactura = z.strictObject({
  productoId: esquemaId,
  cantidad: esquemaCantidadItem,
  precio: campoProhibido(MENSAJE_PRECIOS),
  precioUnitario: campoProhibido(MENSAJE_PRECIOS),
  subtotal: campoProhibido(MENSAJE_PRECIOS),
  total: campoProhibido(MENSAJE_PRECIOS),
  codigo: campoProhibido(MENSAJE_DATOS_CATALOGO),
  descripcion: campoProhibido(MENSAJE_DATOS_CATALOGO),
  existencia: campoProhibido("La existencia la controla el servidor al confirmar."),
});
export type DatosItemFactura = z.infer<typeof esquemaItemFactura>;

/** Lista de renglones: al menos uno, sin productos repetidos (sección 11.6). */
export const esquemaItemsFactura = z
  .array(esquemaItemFactura, { error: "Debe ser una lista de productos." })
  .min(1, "Debe agregar al menos un producto.")
  .max(RENGLONES_MAXIMOS, `No puede tener más de ${RENGLONES_MAXIMOS} productos distintos.`)
  .superRefine((items, ctx) => {
    const vistos = new Set<number>();
    items.forEach((item, indice) => {
      if (vistos.has(item.productoId)) {
        ctx.addIssue({
          code: "custom",
          path: [indice, "productoId"],
          message: "El producto está repetido: sume la cantidad en un único renglón.",
        });
      }
      vistos.add(item.productoId);
    });
  });

// ---------------------------------------------------------------------------
// Forma de pago — RF-V5, regla 9
// ---------------------------------------------------------------------------

/**
 * Marca de la tarjeta (decisión D6): texto libre, recortado y con espacios
 * internos reducidos; letras, números y algunos signos. No puede contener 4
 * o más dígitos, para que nunca se cargue allí un número de tarjeta.
 */
export const esquemaMarcaTarjeta = z
  .string({ error: "Debe ser un texto." })
  .overwrite(normalizarEspacios)
  .min(1, "Es obligatorio.")
  .max(MARCA_TARJETA_MAXIMA, `No puede superar los ${MARCA_TARJETA_MAXIMA} caracteres.`)
  .regex(/^[\p{L}\p{N} .&'-]+$/u, "Solo puede contener letras, números, espacios y . & ' -")
  .refine((marca) => (marca.match(/\d/g) ?? []).length < 4, {
    message: "La marca no puede contener números de tarjeta.",
  });

/** Datos de la tarjeta: SOLO tipo, marca y últimos 4 dígitos (regla 9). */
export const esquemaDatosTarjeta = z.strictObject({
  tipo: z.enum(TIPOS_TARJETA, { error: "Debe ser «debito» o «credito»." }),
  marca: esquemaMarcaTarjeta,
  ultimos4: esquemaUltimos4,
  ...camposTarjetaProhibidos,
});
export type DatosTarjeta = z.infer<typeof esquemaDatosTarjeta>;

/**
 * Contado: `montoRecibido` opcional, en centavos. Si falta (o es null) se
 * toma el total. Que cubra el total lo controla el servicio, que es quien
 * conoce el total.
 */
export const esquemaPagoContado = z.strictObject({
  forma: z.literal("contado"),
  montoRecibido: esquemaImporteFactura.nullable().optional(),
  tarjeta: campoProhibido("Los datos de tarjeta solo corresponden al pago con tarjeta."),
  ...camposTarjetaProhibidos,
});

/** Tarjeta: débito o crédito, marca y últimos 4 dígitos. Sin monto recibido. */
export const esquemaPagoTarjeta = z.strictObject({
  forma: z.literal("tarjeta"),
  tarjeta: esquemaDatosTarjeta,
  montoRecibido: campoProhibido("El monto recibido solo corresponde al pago de contado."),
  ...camposTarjetaProhibidos,
});

/** Cuenta corriente: sin datos extra (cliente y límite los verifica el servicio). */
export const esquemaPagoCuentaCorriente = z.strictObject({
  forma: z.literal("cuenta_corriente"),
  montoRecibido: campoProhibido("El monto recibido solo corresponde al pago de contado."),
  tarjeta: campoProhibido("Los datos de tarjeta solo corresponden al pago con tarjeta."),
  ...camposTarjetaProhibidos,
});

/** Forma de pago: una por factura, distinguida por `forma`. */
export const esquemaPagoFactura = z.discriminatedUnion(
  "forma",
  [esquemaPagoContado, esquemaPagoTarjeta, esquemaPagoCuentaCorriente],
  { error: "La forma de pago debe ser «contado», «tarjeta» o «cuenta_corriente»." },
);
export type DatosPagoFactura = z.infer<typeof esquemaPagoFactura>;

// ---------------------------------------------------------------------------
// Emisión completa — POST /api/facturas
// ---------------------------------------------------------------------------

const MENSAJE_SERVIDOR = "Este dato lo asigna el servidor al confirmar la factura.";

/**
 * Cuerpo de POST /api/facturas (RF-V1 a RF-V6):
 *   { clienteId: number | null, items: [{ productoId, cantidad }], pago: { forma, ... } }
 * `clienteId` null (u omitido) = consumidor final (RF-V2).
 */
export const esquemaEmisionFactura = z.strictObject({
  clienteId: esquemaId
    .nullable()
    .optional()
    .transform((id) => id ?? null),
  items: esquemaItemsFactura,
  pago: esquemaPagoFactura,
  // Datos que decide o calcula el servidor: nunca se aceptan.
  total: campoProhibido(MENSAJE_PRECIOS),
  subtotal: campoProhibido(MENSAJE_PRECIOS),
  precio: campoProhibido(MENSAJE_PRECIOS),
  precioUnitario: campoProhibido(MENSAJE_PRECIOS),
  vendedorId: campoProhibido("El vendedor es el usuario de la sesión."),
  usuarioId: campoProhibido("El vendedor es el usuario de la sesión."),
  puntoVenta: campoProhibido(MENSAJE_SERVIDOR),
  numero: campoProhibido(MENSAJE_SERVIDOR),
  numeroFormateado: campoProhibido(MENSAJE_SERVIDOR),
  fecha: campoProhibido("La fecha y hora las registra el servidor."),
  estado: campoProhibido("Toda factura nace con estado «emitida»."),
  saldoCliente: campoProhibido("El saldo lo calcula el servidor con la cuenta corriente."),
});
export type DatosEmisionFactura = z.input<typeof esquemaEmisionFactura>;
export type EmisionFacturaValidada = z.output<typeof esquemaEmisionFactura>;

// ---------------------------------------------------------------------------
// Consulta — GET /api/facturas (RF-V8) y GET /api/facturas/{id} (RF-V7)
// ---------------------------------------------------------------------------

/** Longitud máxima del texto de búsqueda del listado. */
export const BUSQUEDA_FACTURAS_MAXIMA = 100;

/** Convierte "" y null en undefined: un filtro vacío equivale a no filtrar. */
function vacioComoAusente(valor: unknown): unknown {
  return valor === "" || valor === null ? undefined : valor;
}

/**
 * Parámetros de GET /api/facturas (RF-V8), tal como llegan en la URL:
 * - `q`: número de factura (completo «0001-00000001» o una parte numérica)
 *   o nombre CONGELADO del comprador;
 * - `desde`, `hasta`: días AAAA-MM-DD en hora de Argentina, ambos inclusive;
 *   `desde` no puede ser posterior a `hasta`;
 * - `clienteId`, `vendedorId`: enteros positivos (no exigen que el cliente o
 *   el usuario sigan activos: el historial no se oculta);
 * - `forma`: contado | tarjeta | cuenta_corriente;
 * - `estado`: emitida | anulada;
 * - `page`, `pageSize` (sección 11.1).
 * Estricto: un parámetro desconocido → 422 VALIDACION.
 */
export const esquemaConsultaFacturas = z
  .strictObject({
    ...esquemaPaginacion.shape,
    q: z.preprocess(
      vacioComoAusente,
      z
        .string()
        .overwrite(normalizarEspacios)
        .max(BUSQUEDA_FACTURAS_MAXIMA, `No puede superar los ${BUSQUEDA_FACTURAS_MAXIMA} caracteres.`)
        .optional(),
    ),
    desde: z.preprocess(vacioComoAusente, esquemaFechaFiltro.optional()),
    hasta: z.preprocess(vacioComoAusente, esquemaFechaFiltro.optional()),
    clienteId: z.preprocess(vacioComoAusente, esquemaIdTexto.optional()),
    vendedorId: z.preprocess(vacioComoAusente, esquemaIdTexto.optional()),
    forma: z.preprocess(
      vacioComoAusente,
      z.enum(FORMAS_PAGO, { error: "Debe ser «contado», «tarjeta» o «cuenta_corriente»." }).optional(),
    ),
    estado: z.preprocess(
      vacioComoAusente,
      z.enum(ESTADOS_FACTURA, { error: "Debe ser «emitida» o «anulada»." }).optional(),
    ),
  })
  .refine((d) => !d.desde || !d.hasta || d.desde <= d.hasta, {
    path: ["hasta"],
    message: "Debe ser igual o posterior a «desde».",
  });
export type ConsultaFacturas = z.infer<typeof esquemaConsultaFacturas>;

/** Parámetros de ruta `{ id }` de /api/facturas/{id} y /api/facturas/{id}/anulacion. */
export const esquemaParametrosFactura = esquemaParametrosId;

// ---------------------------------------------------------------------------
// Anulación — POST /api/facturas/{id}/anulacion (RF-V9, regla 5)
// ---------------------------------------------------------------------------

export const MOTIVO_ANULACION_MINIMO = 5;
export const MOTIVO_ANULACION_MAXIMO = 200;

const MENSAJE_ANULACION_SERVIDOR =
  "La anulación solo recibe el motivo: estado, fecha, usuario e importes los decide el servidor.";

/**
 * Cuerpo de la anulación: EXCLUSIVAMENTE `{ "motivo": "..." }`.
 * El motivo es obligatorio, se recortan los espacios extremos (y se reducen
 * los internos) y debe tener entre 5 y 200 caracteres. Cualquier otro campo
 * → 422 VALIDACION; los que intentan decidir lo que decide el servidor se
 * rechazan con un mensaje explícito.
 */
export const esquemaAnulacionFactura = z.strictObject({
  motivo: z
    .string({ error: (issue) => (issue.input == null ? "Es obligatorio." : "Debe ser un texto.") })
    .overwrite(normalizarEspacios)
    .min(1, { error: "Es obligatorio.", abort: true })
    .min(MOTIVO_ANULACION_MINIMO, `Debe tener al menos ${MOTIVO_ANULACION_MINIMO} caracteres.`)
    .max(MOTIVO_ANULACION_MAXIMO, `No puede superar los ${MOTIVO_ANULACION_MAXIMO} caracteres.`),
  estado: campoProhibido(MENSAJE_ANULACION_SERVIDOR),
  usuarioId: campoProhibido("El usuario que anula es el de la sesión."),
  anuladaPorId: campoProhibido("El usuario que anula es el de la sesión."),
  fecha: campoProhibido("La fecha y hora de la anulación las registra el servidor."),
  fechaAnulacion: campoProhibido("La fecha y hora de la anulación las registra el servidor."),
  total: campoProhibido(MENSAJE_ANULACION_SERVIDOR),
  items: campoProhibido("La anulación reingresa todos los renglones: no se eligen ítems."),
  clienteId: campoProhibido(MENSAJE_ANULACION_SERVIDOR),
});
export type DatosAnulacionFactura = z.input<typeof esquemaAnulacionFactura>;
