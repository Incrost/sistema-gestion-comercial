/**
 * Esquemas de validación de la cuenta corriente y los pagos (RF-C4, RF-C5;
 * reglas 8 y 10; sección 11.5).
 *
 * Los usan los servicios (src/servicios/cuenta-corriente.ts y pagos.ts) y
 * las pantallas de /clientes, para adelantar los mismos mensajes.
 *
 * Todos son ESTRICTOS: un campo no previsto produce 422 VALIDACION. Los datos
 * que calcula o decide el servidor (saldo, número de recibo, usuario,
 * cliente, fecha, tipo de movimiento) se rechazan con un mensaje explícito.
 *
 * MEDIOS DE PAGO: la lista vive en src/db/schema.ts (MEDIOS_PAGO), porque
 * también es una restricción CHECK de la tabla `pagos`. Para agregar uno
 * (p. ej. «Mercado Pago»):
 *   1. agregar el valor a MEDIOS_PAGO en src/db/schema.ts;
 *   2. generar y aplicar la migración (`pnpm run db:generate` y `db:migrate`),
 *      porque cambia el CHECK de `pagos.medio`;
 *   3. agregar su nombre en ETIQUETAS_MEDIO_PAGO (TypeScript avisa si falta).
 * El esquema, el formulario y el recibo toman la lista de aquí.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import { MEDIOS_PAGO, type MedioPago } from "@/db/schema";

import { normalizarEspacios } from "./normalizacion";
import { esquemaFechaFiltro, esquemaImportePositivo, esquemaParametrosId } from "./validacion";

// ---------------------------------------------------------------------------
// Medios de pago
// ---------------------------------------------------------------------------

export { MEDIOS_PAGO, type MedioPago };

/** Nombre visible de cada medio de pago (formulario y recibo). */
export const ETIQUETAS_MEDIO_PAGO: Record<MedioPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta_debito: "Tarjeta de débito",
};

const esquemaMedioPago = z.enum(MEDIOS_PAGO, {
  error: `Debe ser uno de: ${MEDIOS_PAGO.join(", ")}.`,
});

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

export const OBSERVACION_PAGO_MAXIMA = 200;
/** $ 999.999.999,99 expresado en centavos. */
export const IMPORTE_PAGO_MAXIMO = 99_999_999_999;

// ---------------------------------------------------------------------------
// Parámetros de ruta
// ---------------------------------------------------------------------------

/** `/api/clientes/{id}/cuenta` y `/api/clientes/{id}/pagos`. */
export const esquemaParametrosCliente = esquemaParametrosId;
/** `/api/pagos/{id}`. */
export const esquemaParametrosPago = esquemaParametrosId;

// ---------------------------------------------------------------------------
// Consulta de la cuenta corriente — RF-C4
// ---------------------------------------------------------------------------

/** Convierte "" en undefined: un filtro vacío equivale a no filtrar. */
function vacioComoAusente(valor: unknown): unknown {
  return valor === "" ? undefined : valor;
}

/**
 * GET /api/clientes/{id}/cuenta: `desde` y `hasta` opcionales, AAAA-MM-DD,
 * interpretados como días de Argentina (ambos inclusive). `desde` no puede
 * ser posterior a `hasta`.
 */
export const esquemaConsultaCuenta = z
  .strictObject({
    desde: z.preprocess(vacioComoAusente, esquemaFechaFiltro.optional()),
    hasta: z.preprocess(vacioComoAusente, esquemaFechaFiltro.optional()),
  })
  .refine((f) => f.desde === undefined || f.hasta === undefined || f.desde <= f.hasta, {
    path: ["hasta"],
    message: "No puede ser anterior a la fecha «desde».",
  });
export type ConsultaCuenta = z.infer<typeof esquemaConsultaCuenta>;

// ---------------------------------------------------------------------------
// Alta de pago — RF-C5
// ---------------------------------------------------------------------------

/** Campo que nunca se acepta: si llega con cualquier valor, falla con `mensaje`. */
function campoProhibido(mensaje: string) {
  return z.never({ error: mensaje }).optional();
}

const MENSAJE_SALDO = "El saldo no se informa: lo calcula el servidor con la cuenta corriente.";

/**
 * POST /api/clientes/{id}/pagos: `{ importe, medio, observacion? }`.
 * - importe: entero en centavos, mayor que 0 (regla 10). Que no supere la
 *   deuda (regla 8) lo controla el servicio, porque depende del saldo.
 * - medio: uno de MEDIOS_PAGO.
 * - observacion: opcional; espacios normalizados; "" o null → null.
 * El cliente sale de la URL; número, fecha, usuario y saldo los pone el servidor.
 */
export const esquemaAltaPago = z.strictObject({
  importe: esquemaImportePositivo.max(IMPORTE_PAGO_MAXIMO, "El importe es demasiado grande."),
  medio: esquemaMedioPago,
  observacion: z.preprocess(
    (valor) => (typeof valor === "string" ? normalizarEspacios(valor) || null : valor),
    z
      .string()
      .max(OBSERVACION_PAGO_MAXIMA, `No puede superar los ${OBSERVACION_PAGO_MAXIMA} caracteres.`)
      .nullable()
      .optional(),
  ),
  saldo: campoProhibido(MENSAJE_SALDO),
  saldoCliente: campoProhibido(MENSAJE_SALDO),
  saldoResultante: campoProhibido(MENSAJE_SALDO),
  numero: campoProhibido("El número de recibo lo asigna el servidor."),
  numeroRecibo: campoProhibido("El número de recibo lo asigna el servidor."),
  usuarioId: campoProhibido("El usuario es el de la sesión."),
  clienteId: campoProhibido("El cliente se indica en la dirección de la ruta."),
  fecha: campoProhibido("La fecha y hora las registra el servidor."),
  tipo: campoProhibido("Un pago siempre genera un crédito: el tipo no se informa."),
});
export type DatosAltaPago = z.input<typeof esquemaAltaPago>;
