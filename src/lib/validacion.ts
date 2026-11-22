/**
 * Esquemas de validación BASE (sección 10.4): formularios y servicios aplican las
 * mismas reglas. Los esquemas de cada formulario (validacion-*.ts) los combinan.
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import { normalizarDocumento, normalizarEmail } from "./normalizacion";

// ---------------------------------------------------------------------------
// Mensajes por defecto en español
// ---------------------------------------------------------------------------

/**
 * Mensajes genéricos para los casos en que un esquema no define el suyo.
 * Evita que llegue al usuario un mensaje de Zod en inglés. Cada esquema puede
 * indicar un mensaje propio, que tiene prioridad sobre estos.
 */
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case "invalid_type":
        if (issue.input === undefined || issue.input === null) return "Es obligatorio.";
        if (issue.expected === "number" || issue.expected === "int") return "Debe ser un número.";
        if (issue.expected === "string") return "Debe ser un texto.";
        if (issue.expected === "boolean") return "Debe ser verdadero o falso.";
        if (issue.expected === "array") return "Debe ser una lista.";
        return "Tiene un tipo de dato inválido.";
      case "too_small":
        if (issue.origin === "string") return `Debe tener al menos ${issue.minimum} caracteres.`;
        if (issue.origin === "array") return `Debe tener al menos ${issue.minimum} elementos.`;
        return issue.inclusive
          ? `Debe ser mayor o igual que ${issue.minimum}.`
          : `Debe ser mayor que ${issue.minimum}.`;
      case "too_big":
        if (issue.origin === "string") return `No puede superar los ${issue.maximum} caracteres.`;
        if (issue.origin === "array") return `No puede tener más de ${issue.maximum} elementos.`;
        return issue.inclusive
          ? `Debe ser menor o igual que ${issue.maximum}.`
          : `Debe ser menor que ${issue.maximum}.`;
      case "invalid_value":
        return "Tiene un valor no permitido.";
      case "unrecognized_keys":
        return "Contiene campos no permitidos.";
      default:
        return "Tiene un valor inválido.";
    }
  },
});

/** Convierte "" y null en undefined, para que un parámetro vacío tome su valor por defecto. */
function vacioComoAusente(valor: unknown): unknown {
  return valor === "" || valor === null ? undefined : valor;
}

// ---------------------------------------------------------------------------
// Paginación (sección 11.1)
// ---------------------------------------------------------------------------

export const PAGINA_TAMANIO_POR_DEFECTO = 20;
export const PAGINA_TAMANIO_MAXIMO = 100;

/**
 * Parámetros `page` y `pageSize` de los listados. Llegan como texto desde la
 * URL; se convierten a número. `page` empieza en 1; `pageSize` vale 20 por
 * defecto y no puede superar 100.
 */
export const esquemaPaginacion = z.object({
  page: z.preprocess(
    vacioComoAusente,
    z.coerce
      .number({ error: "Debe ser un número." })
      .int("Debe ser un número entero.")
      .min(1, "Debe ser mayor o igual que 1.")
      .default(1),
  ),
  pageSize: z.preprocess(
    vacioComoAusente,
    z.coerce
      .number({ error: "Debe ser un número." })
      .int("Debe ser un número entero.")
      .min(1, "Debe ser mayor o igual que 1.")
      .max(PAGINA_TAMANIO_MAXIMO, `No puede ser mayor que ${PAGINA_TAMANIO_MAXIMO}.`)
      .default(PAGINA_TAMANIO_POR_DEFECTO),
  ),
});
export type Paginacion = z.infer<typeof esquemaPaginacion>;

// ---------------------------------------------------------------------------
// Identificadores (sección 11.1: enteros)
// ---------------------------------------------------------------------------

/** Identificador entero positivo dentro de un cuerpo JSON: `{ "productoId": 4 }`. */
export const esquemaId = z
  .number({ error: "Debe ser un identificador numérico." })
  .int("Debe ser un número entero.")
  .positive("Debe ser mayor que 0.");

/** Identificador que llega como texto en la URL (`/api/productos/4`, `?clienteId=4`). */
export const esquemaIdTexto = z
  .string()
  .regex(/^\d+$/, "Debe ser un identificador numérico.")
  .transform(Number)
  .pipe(esquemaId);

/** Parámetros de ruta `{ id }` (`/api/productos/{id}`, `/api/categorias/{id}`...). */
export const esquemaParametrosId = z.strictObject({ id: esquemaIdTexto });
export type ParametrosId = z.infer<typeof esquemaParametrosId>;

// ---------------------------------------------------------------------------
// Fechas de filtro (sección 11.1: AAAA-MM-DD, en hora de Argentina)
// ---------------------------------------------------------------------------

/**
 * Día con formato AAAA-MM-DD; rechaza fechas inexistentes como 2026-02-30.
 * Para convertirlo en un rango de instantes usar inicioDelDiaEnArgentina()
 * de src/lib/fechas.ts.
 */
export const esquemaFechaFiltro = z.iso.date({
  error: "Debe ser una fecha válida con formato AAAA-MM-DD.",
});

// ---------------------------------------------------------------------------
// Importes en centavos (regla 10)
// ---------------------------------------------------------------------------

/** Importe en centavos, entero y mayor o igual que 0 (por ejemplo, un precio). */
export const esquemaImporte = z
  .number({ error: "Debe ser un importe numérico." })
  .int("Debe expresarse en centavos, sin decimales.")
  .nonnegative("No puede ser negativo.");

/** Importe en centavos, entero y mayor que 0 (por ejemplo, un pago). */
export const esquemaImportePositivo = esquemaImporte.positive("Debe ser mayor que 0.");

// ---------------------------------------------------------------------------
// Textos, email y contraseña
// ---------------------------------------------------------------------------

/** Texto obligatorio: se quitan los espacios extremos y no puede quedar vacío. */
export function textoObligatorio(maximo = 200) {
  return z
    .string()
    .trim()
    .min(1, "Es obligatorio.")
    .max(maximo, `No puede superar los ${maximo} caracteres.`);
}

/** Email normalizado (sin espacios extremos y en minúsculas). */
export const esquemaEmail = z
  .string()
  .overwrite(normalizarEmail)
  .min(1, "Es obligatorio.")
  .max(254, "No puede superar los 254 caracteres.")
  .pipe(z.email("Debe ser un email válido."));

/**
 * Contraseña: mínimo 8 caracteres (sección 11.3). No se recortan espacios.
 * El máximo de 72 corresponde al límite de bcrypt.
 */
export const esquemaContrasena = z
  .string()
  .min(8, "Debe tener al menos 8 caracteres.")
  .max(72, "No puede superar los 72 caracteres.");

// ---------------------------------------------------------------------------
// Documentos y tarjeta
// ---------------------------------------------------------------------------

/** DNI de 6 a 8 dígitos. Acepta "28.456.123" y lo guarda como "28456123". */
export const esquemaDni = z
  .string()
  .overwrite(normalizarDocumento)
  .regex(/^\d{6,8}$/, "El DNI debe tener entre 6 y 8 dígitos.");

/** CUIT de 11 dígitos. Acepta "20-28456123-4" y lo guarda como "20284561234". */
export const esquemaCuit = z
  .string()
  .overwrite(normalizarDocumento)
  .regex(/^\d{11}$/, "El CUIT debe tener 11 dígitos.");

/** Últimos 4 dígitos de la tarjeta (regla 9): nunca el número completo. */
export const esquemaUltimos4 = z
  .string()
  .regex(/^\d{4}$/, "Debe tener exactamente 4 dígitos.");

// ---------------------------------------------------------------------------
// Autenticación (sección 11.3)
// ---------------------------------------------------------------------------

/**
 * Contraseña ingresada para comprobarla (login o contraseña actual). Solo se
 * exige que no esté vacía: el mínimo de 8 se aplica al ELEGIR una contraseña.
 */
const esquemaContrasenaIngresada = z
  .string()
  .min(1, "Es obligatorio.")
  .max(72, "No puede superar los 72 caracteres.");

/** Cuerpo de POST /api/auth/login (RF-U1). */
export const esquemaLogin = z.strictObject({
  email: esquemaEmail,
  password: esquemaContrasenaIngresada,
});
export type DatosLogin = z.infer<typeof esquemaLogin>;

/** Cuerpo de PUT /api/auth/password (RF-U5). */
export const esquemaCambioContrasena = z
  .strictObject({
    actual: esquemaContrasenaIngresada,
    nueva: esquemaContrasena,
  })
  .refine((datos) => datos.nueva !== datos.actual, {
    path: ["nueva"],
    message: "Debe ser distinta de la contraseña actual.",
  });
export type DatosCambioContrasena = z.infer<typeof esquemaCambioContrasena>;
