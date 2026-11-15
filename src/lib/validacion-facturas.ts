/**
 * Esquemas de validación de la emisión de facturas (RF-V1 a RF-V6; reglas
 * 3, 9 y 10; sección 11.6).
 *
 * Los usa el servicio de facturación (src/servicios/facturas.ts) para validar
 * en el servidor y los usará la pantalla de Nueva venta para adelantar los
 * mismos mensajes (sección 10.8, punto 6).
 *
 * Principios:
 * - TODOS los objetos son estrictos: un campo no previsto produce
 *   422 VALIDACION. Así el número completo de una tarjeta, el CVV o el
 *   vencimiento se rechazan sin código extra (regla 9, sección 10.4).
 * - El cliente envía SOLO productos, cantidades, comprador y forma de pago.
 *   Precios, subtotales, total, número, fecha, estado y vendedor los decide
 *   el servidor (sección 11.1: «Precios desde el servidor»). Esos campos se
 *   rechazan con un mensaje explícito.
 * - Cantidades e importes son enteros dentro de límites seguros: ningún
 *   cálculo puede salir del rango exacto de JavaScript (regla 10).
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import { FORMAS_PAGO, TIPOS_TARJETA, type FormaPago, type TipoTarjeta } from "@/db/schema";

import { normalizarEspacios } from "./normalizacion";
import { esquemaId, esquemaImportePositivo, esquemaUltimos4 } from "./validacion";

export { FORMAS_PAGO, TIPOS_TARJETA, type FormaPago, type TipoTarjeta };

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
