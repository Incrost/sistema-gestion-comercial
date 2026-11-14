/**
 * Configuración PÚBLICA del comercio (decisión D5).
 *
 * Es el único lugar donde se definen los datos del comercio que aparecen en
 * facturas, recibos y pantallas, y los parámetros regionales (zona horaria,
 * moneda, locale). No contiene secretos: puede importarse desde el cliente.
 *
 * ⚠ DATOS PROVISIONALES: los valores marcados con «PROVISORIO» son de
 * ejemplo académico y deben REEMPLAZARSE por los definitivos antes de entregar.
 */

export const COMERCIO = {
  // --- Identidad del comercio (PROVISORIO: reemplazar antes de entregar) ---
  nombreComercial: "Comercio de Prueba", // PROVISORIO
  razonSocial: "Comercio de Prueba S.R.L.", // PROVISORIO
  cuit: "30000000000", // PROVISORIO. Solo dígitos; se muestra con formatearDocumento().
  domicilio: "Calle de Prueba 123, Ciudad de Ejemplo", // PROVISORIO

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

/** Indica que la identidad del comercio todavía tiene datos de ejemplo. */
export const COMERCIO_CON_DATOS_PROVISORIOS = true;
