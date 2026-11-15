/**
 * Configuración PÚBLICA del comercio (decisión D5).
 *
 * Es el único lugar donde se definen los datos del comercio que aparecen en
 * facturas, recibos y pantallas, y los parámetros regionales (zona horaria,
 * moneda, locale). No contiene secretos: puede importarse desde el cliente.
 *
 * También define la NUMERACIÓN de comprobantes (regla 4, decisión D3): qué
 * clave de la tabla `secuencias` y qué punto de venta usa cada tipo.
 *
 * El CUIT y el domicilio son datos académicos ficticios.
 */
import type { ClaveSecuencia } from "@/db/schema"; // solo el tipo; no carga código del servidor

export const COMERCIO = {
  // --- Identidad del comercio ---
  nombreComercial: "Nexo Comercial",
  razonSocial: "Nexo Comercial S.R.L.",
  /** CUIT académico 30-71654321-4. Solo dígitos; se muestra con formatearDocumento(). */
  cuit: "30716543214",
  domicilio: "Av. Central 1234, San Miguel de Tucumán",

  // --- Facturación ---
  /** Punto de venta de facturas y recibos (regla 4): 0001-00000001. */
  puntoVenta: 1,

  // --- Parámetros regionales ---
  /** Zona horaria en la que se muestran fechas y se calculan días y meses. */
  zonaHoraria: "America/Argentina/Buenos_Aires",
  /**
   * Desfase de la zona horaria respecto de UTC. Argentina usa UTC−3 todo el
   * año (no aplica horario de verano desde 2009). Se usa para interpretar los
   * filtros AAAA-MM-DD como días de Argentina.
   */
  desfaseUtc: "-03:00",
  locale: "es-AR",
  moneda: "ARS",
  simboloMoneda: "$",
} as const;

/**
 * Numeración correlativa de cada comprobante (regla 4): clave de la tabla
 * `secuencias` y punto de venta. Facturas y recibos tienen numeración propia.
 * La asigna src/servicios/numeracion.ts, dentro de la transacción del comprobante.
 *
 * Para cambiar el punto de venta (p. ej. a 0002) basta modificar
 * `COMERCIO.puntoVenta` (o el de un comprobante en particular): la secuencia
 * del nuevo punto de venta empieza en 00000001.
 */
export const NUMERACION = {
  factura: { clave: "factura", puntoVenta: COMERCIO.puntoVenta },
  recibo: { clave: "recibo", puntoVenta: COMERCIO.puntoVenta },
} as const satisfies Record<ClaveSecuencia, { clave: ClaveSecuencia; puntoVenta: number }>;

export type Numeracion = (typeof NUMERACION)[ClaveSecuencia];

/** Indica si la identidad del comercio todavía tiene datos de ejemplo. */
export const COMERCIO_CON_DATOS_PROVISORIOS = false;
