/**
 * Esquemas de validación de clientes (RF-C1, RF-C2, RF-C3, RF-C6, RF-C7;
 * sección 11.5).
 *
 * Los usan el servicio (src/servicios/clientes.ts) para validar en el
 * servidor y las pantallas de /clientes para adelantar los mismos mensajes
 * (sección 10.8, punto 6).
 *
 * Todos son estrictos: un campo no previsto produce 422 VALIDACION. Además,
 * `saldo`, `disponible` y `nroDocNormalizado` se rechazan con un mensaje
 * explícito: el saldo se calcula desde movimientos_cuenta (regla 7) y el
 * número normalizado lo calcula el servidor.
 *
 * Convenciones de esta etapa:
 * - Documento: se guarda el número VISIBLE con formato canónico
 *   ("28.456.123", "20-28456123-4", ver formatearDocumento()) y el número
 *   NORMALIZADO, solo dígitos ("28456123"). Ambos salen de
 *   `resolverDocumento()`, el ÚNICO lugar que relaciona tipoDoc, nroDoc y
 *   nroDocNormalizado.
 * - Textos opcionales (domicilio, teléfono, email): se quitan los espacios
 *   extremos y se reducen los internos; un texto vacío se guarda como `null`.
 *   En la edición, `undefined` (campo ausente) significa «no cambiar» y
 *   `null` o "" significa «borrar».
 * - Teléfono: texto libre razonable (hasta 40 caracteres). Todavía NO se
 *   exige una cantidad de dígitos.
 * - Límite de crédito: entero en centavos ≥ 0, o `null` (sin límite). Solo
 *   tiene sentido con cuenta corriente habilitada.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import { TIPOS_DOCUMENTO, type TipoDocumento } from "@/db/schema";

import { formatearDocumento } from "./formatos";
import { normalizarDocumento, normalizarEmail, normalizarEspacios } from "./normalizacion";
import { esquemaImporte, esquemaPaginacion } from "./validacion";

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

export const NOMBRE_CLIENTE_MAXIMO = 120;
export const DOMICILIO_MAXIMO = 150;
export const TELEFONO_MAXIMO = 40;
export const NRO_DOC_MAXIMO = 20;
export const BUSQUEDA_CLIENTES_MAXIMA = 100;
/** $ 999.999.999,99 expresado en centavos. */
export const LIMITE_CREDITO_MAXIMO = 99_999_999_999;

// ---------------------------------------------------------------------------
// Documento — única relación entre tipoDoc, nroDoc y nroDocNormalizado
// ---------------------------------------------------------------------------

/** Cantidad de dígitos válida por tipo de documento (RF-C2). */
const DIGITOS_DOCUMENTO: Record<TipoDocumento, { patron: RegExp; mensaje: string }> = {
  DNI: { patron: /^\d{6,8}$/, mensaje: "El DNI debe tener entre 6 y 8 dígitos." },
  CUIT: { patron: /^\d{11}$/, mensaje: "El CUIT debe tener 11 dígitos." },
};

export type DocumentoResuelto = {
  tipoDoc: TipoDocumento;
  /** Número para mostrar, con formato canónico: "28.456.123" o "20-28456123-4". */
  nroDoc: string;
  /** Solo dígitos: "28456123". Garantiza la unicidad y permite buscar sin formato. */
  nroDocNormalizado: string;
};

/**
 * Relaciona tipo y número de documento. Acepta el número con o sin puntos,
 * espacios y guiones. Devuelve el documento resuelto, o el mensaje de error
 * para el campo `nroDoc` si la cantidad de dígitos no corresponde al tipo.
 */
export function resolverDocumento(
  tipoDoc: TipoDocumento,
  nroDoc: string,
): { ok: true; documento: DocumentoResuelto } | { ok: false; mensaje: string } {
  const nroDocNormalizado = normalizarDocumento(nroDoc);
  const { patron, mensaje } = DIGITOS_DOCUMENTO[tipoDoc];
  if (!patron.test(nroDocNormalizado)) return { ok: false, mensaje };
  return {
    ok: true,
    documento: { tipoDoc, nroDoc: formatearDocumento(tipoDoc, nroDocNormalizado), nroDocNormalizado },
  };
}

const esquemaTipoDoc = z.enum(TIPOS_DOCUMENTO, { error: "Debe ser «DNI» o «CUIT»." });

/**
 * Número de documento tal como lo escribe el usuario. Aquí solo se controla
 * la forma general (dígitos, puntos, espacios o guiones); la cantidad de
 * dígitos depende del tipo y la controla resolverDocumento().
 */
const esquemaNroDoc = z
  .string()
  .trim()
  .min(1, "Es obligatorio.")
  .max(NRO_DOC_MAXIMO, `No puede superar los ${NRO_DOC_MAXIMO} caracteres.`)
  .regex(/^[\d.\s-]+$/, "Solo puede contener dígitos, puntos, espacios o guiones.");

/** Agrega al contexto de Zod el error del documento, si lo hay. */
function controlarDocumento(
  datos: { tipoDoc?: TipoDocumento; nroDoc?: string },
  ctx: z.RefinementCtx,
) {
  if (datos.tipoDoc === undefined || datos.nroDoc === undefined) return;
  const resultado = resolverDocumento(datos.tipoDoc, datos.nroDoc);
  if (!resultado.ok) ctx.addIssue({ code: "custom", path: ["nroDoc"], message: resultado.mensaje });
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

/** Convierte "" en undefined para que un filtro vacío equivalga a no filtrar. */
function vacioComoAusente(valor: unknown): unknown {
  return valor === "" ? undefined : valor;
}

/** Campo que nunca se acepta: si llega con cualquier valor, falla con `mensaje`. */
function campoProhibido(mensaje: string) {
  return z.never({ error: mensaje }).optional();
}

const MENSAJE_SALDO =
  "El saldo no se informa: se calcula con los débitos y créditos de la cuenta corriente.";
const MENSAJE_DISPONIBLE = "El crédito disponible no se informa: se calcula con el límite y el saldo.";
const MENSAJE_NORMALIZADO = "El número normalizado lo calcula el servidor a partir de nroDoc.";

/** Campos calculados por el servidor que no se aceptan ni en el alta ni en la edición. */
const camposCalculados = {
  saldo: campoProhibido(MENSAJE_SALDO),
  disponible: campoProhibido(MENSAJE_DISPONIBLE),
  nroDocNormalizado: campoProhibido(MENSAJE_NORMALIZADO),
};

const esquemaNombre = z
  .string()
  .overwrite(normalizarEspacios)
  .min(1, "Es obligatorio.")
  .max(NOMBRE_CLIENTE_MAXIMO, `No puede superar los ${NOMBRE_CLIENTE_MAXIMO} caracteres.`);

/**
 * Texto opcional: espacios normalizados; "" o null → null (sin dato).
 * `undefined` se conserva para que la edición parcial no toque el campo.
 */
function textoOpcional(maximo: number) {
  return z.preprocess(
    (valor) => (typeof valor === "string" ? normalizarEspacios(valor) || null : valor),
    z
      .string()
      .max(maximo, `No puede superar los ${maximo} caracteres.`)
      .nullable()
      .optional(),
  );
}

/** Email opcional: minúsculas y sin espacios extremos; "" o null → null. */
const esquemaEmailOpcional = z.preprocess(
  (valor) => (typeof valor === "string" ? normalizarEmail(valor) || null : valor),
  z
    .string()
    .max(254, "No puede superar los 254 caracteres.")
    .pipe(z.email("Debe ser un email válido."))
    .nullable()
    .optional(),
);

/** Límite de crédito en centavos (regla 10); null = sin límite. */
const esquemaLimiteCredito = esquemaImporte
  .max(LIMITE_CREDITO_MAXIMO, "El importe es demasiado grande.")
  .nullable()
  .optional();

const esquemaBooleano = z.boolean({ error: "Debe ser verdadero o falso." });

const MENSAJE_LIMITE_SIN_CUENTA =
  "Solo puede indicarse un límite de crédito si el cliente tiene cuenta corriente.";

// ---------------------------------------------------------------------------
// Alta — RF-C2 (POST /api/clientes; también el alta rápida de Nueva venta)
// ---------------------------------------------------------------------------

/**
 * POST /api/clientes. El cliente nace siempre activo: `activo` no se acepta.
 * Si `cuentaCorriente` es false (o falta), `limiteCredito` debe ser null o
 * no enviarse.
 */
export const esquemaAltaCliente = z
  .strictObject({
    tipoDoc: esquemaTipoDoc,
    nroDoc: esquemaNroDoc,
    nombre: esquemaNombre,
    domicilio: textoOpcional(DOMICILIO_MAXIMO),
    telefono: textoOpcional(TELEFONO_MAXIMO),
    email: esquemaEmailOpcional,
    cuentaCorriente: esquemaBooleano.default(false),
    limiteCredito: esquemaLimiteCredito,
    activo: campoProhibido("El cliente se crea siempre activo."),
    ...camposCalculados,
  })
  .superRefine((datos, ctx) => {
    controlarDocumento(datos, ctx);
    if (!datos.cuentaCorriente && datos.limiteCredito != null) {
      ctx.addIssue({ code: "custom", path: ["limiteCredito"], message: MENSAJE_LIMITE_SIN_CUENTA });
    }
  });
export type DatosAltaCliente = z.input<typeof esquemaAltaCliente>;

// ---------------------------------------------------------------------------
// Edición — RF-C2, RF-C7 (PATCH /api/clientes/{id})
// ---------------------------------------------------------------------------

/**
 * PATCH /api/clientes/{id}: cualquier campo del alta, más `activo` (baja o
 * reactivación lógica). Exige al menos un campo. Si llegan tipoDoc y nroDoc
 * juntos se controlan aquí; si llega uno solo, el servicio lo combina con el
 * valor guardado y lo controla con resolverDocumento(). Las reglas que
 * dependen del estado guardado (saldo, cuenta corriente actual, permisos)
 * las aplica el servicio.
 */
export const esquemaEdicionCliente = z
  .strictObject({
    tipoDoc: esquemaTipoDoc.optional(),
    nroDoc: esquemaNroDoc.optional(),
    nombre: esquemaNombre.optional(),
    domicilio: textoOpcional(DOMICILIO_MAXIMO),
    telefono: textoOpcional(TELEFONO_MAXIMO),
    email: esquemaEmailOpcional,
    cuentaCorriente: esquemaBooleano.optional(),
    limiteCredito: esquemaLimiteCredito,
    activo: esquemaBooleano.optional(),
    ...camposCalculados,
  })
  .superRefine((datos, ctx) => {
    controlarDocumento(datos, ctx);
    if (datos.cuentaCorriente === false && datos.limiteCredito != null) {
      ctx.addIssue({ code: "custom", path: ["limiteCredito"], message: MENSAJE_LIMITE_SIN_CUENTA });
    }
  })
  .refine((datos) => Object.values(datos).some((valor) => valor !== undefined), {
    message: "Debe indicar al menos un campo para modificar.",
    // Solo si no hubo otros errores: con un campo no permitido basta ese aviso.
    when: (payload) => payload.issues.length === 0,
  });
export type DatosEdicionCliente = z.input<typeof esquemaEdicionCliente>;

// ---------------------------------------------------------------------------
// Consulta — RF-C1, RF-C6 (GET /api/clientes)
// ---------------------------------------------------------------------------

/** Valores del filtro `activo` del listado (por defecto `true`; el resto, solo admin). */
export const FILTROS_ACTIVO_CLIENTE = ["true", "false", "todos"] as const;
export type FiltroActivoCliente = (typeof FILTROS_ACTIVO_CLIENTE)[number];

/** Criterios de orden: por nombre (A→Z) o por saldo (de mayor a menor). */
export const ORDENES_CLIENTE = ["nombre", "saldo"] as const;
export type OrdenCliente = (typeof ORDENES_CLIENTE)[number];

/**
 * GET /api/clientes: `q` (nombre o número de documento, sin importar puntos,
 * espacios ni guiones), `conDeuda=true` (RF-C6), `orden`, `activo` y paginación.
 */
export const esquemaConsultaClientes = z.strictObject({
  ...esquemaPaginacion.shape,
  q: z.preprocess(
    vacioComoAusente,
    z
      .string()
      .overwrite(normalizarEspacios)
      .max(BUSQUEDA_CLIENTES_MAXIMA, `No puede superar los ${BUSQUEDA_CLIENTES_MAXIMA} caracteres.`)
      .optional(),
  ),
  conDeuda: z.preprocess(
    vacioComoAusente,
    z
      .enum(["true", "false"], { error: "Debe ser «true» o «false»." })
      .transform((valor) => valor === "true")
      .default(false),
  ),
  orden: z.preprocess(
    vacioComoAusente,
    z.enum(ORDENES_CLIENTE, { error: "Debe ser «nombre» o «saldo»." }).default("nombre"),
  ),
  activo: z.preprocess(
    vacioComoAusente,
    z
      .enum(FILTROS_ACTIVO_CLIENTE, { error: "Debe ser «true», «false» o «todos»." })
      .default("true"),
  ),
});
export type ConsultaClientes = z.infer<typeof esquemaConsultaClientes>;
