/**
 * Esquemas de validación de categorías, productos y stock (RF-P1 a RF-P7;
 * sección 11.4).
 *
 * Los usan los servicios (src/servicios/categorias.ts, productos.ts y
 * stock.ts) para validar en el servidor y las pantallas de /productos para
 * adelantar los mismos mensajes (sección 10.8, punto 6).
 *
 * Todos son estrictos: un campo no previsto produce 422 VALIDACION. Además,
 * `existencia` (y `stockInicial` en la edición) se rechazan con un mensaje
 * explícito: la existencia solo cambia con movimientos (regla 2).
 *
 * Importes en centavos, enteros (regla 10).
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import {
  MOTIVOS_POR_TIPO,
  TIPOS_MOVIMIENTO_MANUAL,
  type TipoMovimientoManual,
} from "@/config/motivos-stock";
import { TIPOS_MOVIMIENTO_STOCK } from "@/db/schema";

import { normalizarEspacios } from "./normalizacion";
import {
  esquemaFechaFiltro,
  esquemaId,
  esquemaIdTexto,
  esquemaPaginacion,
} from "./validacion";

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

export const NOMBRE_CATEGORIA_MAXIMO = 50;
export const CODIGO_PRODUCTO_MAXIMO = 30;
export const DESCRIPCION_PRODUCTO_MAXIMA = 150;
/** $ 999.999.999,99 expresado en centavos. */
export const PRECIO_MAXIMO = 99_999_999_999;
export const CANTIDAD_MAXIMA = 1_000_000;
export const MOTIVO_MAXIMO = 100;
export const OBSERVACION_MAXIMA = 200;
export const BUSQUEDA_PRODUCTOS_MAXIMA = 100;

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

/** Convierte "" en undefined para que un filtro vacío equivalga a no filtrar. */
function vacioComoAusente(valor: unknown): unknown {
  return valor === "" ? undefined : valor;
}

/** Texto obligatorio con espacios normalizados (extremos quitados, internos reducidos a uno). */
function textoNormalizado(maximo: number) {
  return z
    .string()
    .overwrite(normalizarEspacios)
    .min(1, "Es obligatorio.")
    .max(maximo, `No puede superar los ${maximo} caracteres.`);
}

/** Entero dentro de un rango, con mensajes en español. */
function entero(minimo: number, maximo: number, mensajeMinimo: string) {
  return z
    .number({ error: "Debe ser un número." })
    .int("Debe ser un número entero.")
    .min(minimo, mensajeMinimo)
    .max(maximo, `No puede superar ${maximo}.`);
}

/** Campo que nunca se acepta: si llega con cualquier valor, falla con `mensaje`. */
function campoProhibido(mensaje: string) {
  return z.never({ error: mensaje }).optional();
}

const MENSAJE_EXISTENCIA =
  "La existencia no se edita: cambia solo con ingresos, egresos y ventas.";

/** Exige al menos un campo en una edición parcial (PATCH). */
function alMenosUnCampo(datos: Record<string, unknown>): boolean {
  return Object.values(datos).some((valor) => valor !== undefined);
}
const opcionesAlMenosUnCampo = {
  message: "Debe indicar al menos un campo para modificar.",
  // Solo si no hubo otros errores: con un campo no permitido basta ese aviso.
  when: (payload: { issues: unknown[] }) => payload.issues.length === 0,
};

/** Parámetro booleano de la URL: "true" o "false". */
const booleanoTexto = z.preprocess(
  vacioComoAusente,
  z
    .enum(["true", "false"], { error: "Debe ser «true» o «false»." })
    .transform((valor) => valor === "true")
    .optional(),
);

// ---------------------------------------------------------------------------
// Categorías — RF-P7
// ---------------------------------------------------------------------------

export const esquemaNombreCategoria = textoNormalizado(NOMBRE_CATEGORIA_MAXIMO);

/** POST /api/categorias */
export const esquemaAltaCategoria = z.strictObject({ nombre: esquemaNombreCategoria });
export type DatosAltaCategoria = z.infer<typeof esquemaAltaCategoria>;

/** PATCH /api/categorias/{id}: `nombre` y/o `activa` (baja lógica, regla 12). */
export const esquemaEdicionCategoria = z
  .strictObject({
    nombre: esquemaNombreCategoria.optional(),
    activa: z.boolean({ error: "Debe ser verdadero o falso." }).optional(),
  })
  .refine(alMenosUnCampo, opcionesAlMenosUnCampo);
export type DatosEdicionCategoria = z.infer<typeof esquemaEdicionCategoria>;

/**
 * GET /api/categorias. Sin parámetros devuelve las activas (sección 11.4).
 * `incluirInactivas=true` (solo admin) agrega las inactivas, para poder
 * reactivarlas desde la pantalla de categorías.
 */
export const esquemaConsultaCategorias = z.strictObject({ incluirInactivas: booleanoTexto });
export type ConsultaCategorias = z.infer<typeof esquemaConsultaCategorias>;

// ---------------------------------------------------------------------------
// Productos — RF-P1 a RF-P3
// ---------------------------------------------------------------------------

export const esquemaCodigoProducto = z
  .string()
  .trim()
  .min(1, "Es obligatorio.")
  .max(CODIGO_PRODUCTO_MAXIMO, `No puede superar los ${CODIGO_PRODUCTO_MAXIMO} caracteres.`)
  .regex(/^\S+$/, "No puede contener espacios.");

export const esquemaDescripcionProducto = textoNormalizado(DESCRIPCION_PRODUCTO_MAXIMA);

/** Precio de venta final en centavos: entero mayor que 0 (regla 10). */
export const esquemaPrecio = z
  .number({ error: "Debe ser un importe numérico." })
  .int("Debe expresarse en centavos, sin decimales.")
  .positive("Debe ser mayor que 0.")
  .max(PRECIO_MAXIMO, "El importe es demasiado grande.");

export const esquemaStockMinimo = entero(0, CANTIDAD_MAXIMA, "No puede ser negativo.");
export const esquemaStockInicial = entero(0, CANTIDAD_MAXIMA, "No puede ser negativo.");

/**
 * POST /api/productos (RF-P2). `stockInicial` es opcional: si es mayor que 0
 * se registra como un ingreso con motivo «Stock inicial».
 */
export const esquemaAltaProducto = z.strictObject({
  codigo: esquemaCodigoProducto,
  descripcion: esquemaDescripcionProducto,
  categoriaId: esquemaId,
  precio: esquemaPrecio,
  stockMinimo: esquemaStockMinimo,
  stockInicial: esquemaStockInicial.optional(),
  existencia: campoProhibido(MENSAJE_EXISTENCIA),
});
export type DatosAltaProducto = z.infer<typeof esquemaAltaProducto>;

/** PATCH /api/productos/{id} (RF-P2, RF-P3). `activo: false` es la baja lógica. */
export const esquemaEdicionProducto = z
  .strictObject({
    codigo: esquemaCodigoProducto.optional(),
    descripcion: esquemaDescripcionProducto.optional(),
    categoriaId: esquemaId.optional(),
    precio: esquemaPrecio.optional(),
    stockMinimo: esquemaStockMinimo.optional(),
    activo: z.boolean({ error: "Debe ser verdadero o falso." }).optional(),
    existencia: campoProhibido(MENSAJE_EXISTENCIA),
    stockInicial: campoProhibido(
      "El stock inicial solo se indica en el alta; luego use un ingreso de stock.",
    ),
  })
  .refine(alMenosUnCampo, opcionesAlMenosUnCampo);
export type DatosEdicionProducto = z.infer<typeof esquemaEdicionProducto>;

/** Valores del filtro `activo` del catálogo. */
export const FILTROS_ACTIVO = ["true", "false", "todos"] as const;
export type FiltroActivo = (typeof FILTROS_ACTIVO)[number];

/**
 * GET /api/productos (RF-P1): `q` (código o descripción), `categoriaId`,
 * `bajoMinimo`, `activo` (por defecto `true`) y paginación.
 */
export const esquemaConsultaProductos = z.strictObject({
  ...esquemaPaginacion.shape,
  q: z.preprocess(
    vacioComoAusente,
    z
      .string()
      .trim()
      .max(BUSQUEDA_PRODUCTOS_MAXIMA, `No puede superar los ${BUSQUEDA_PRODUCTOS_MAXIMA} caracteres.`)
      .optional(),
  ),
  categoriaId: z.preprocess(vacioComoAusente, esquemaIdTexto.optional()),
  bajoMinimo: booleanoTexto,
  activo: z.preprocess(
    vacioComoAusente,
    z
      .enum(FILTROS_ACTIVO, { error: "Debe ser «true», «false» o «todos»." })
      .default("true"),
  ),
});
export type ConsultaProductos = z.infer<typeof esquemaConsultaProductos>;

// ---------------------------------------------------------------------------
// Movimientos de stock — RF-P4 a RF-P6, regla 2
// ---------------------------------------------------------------------------

/** Observación opcional: "" o ausente → null. */
const esquemaObservacion = z.preprocess(
  (valor) => (typeof valor === "string" && valor.trim() === "" ? undefined : valor),
  z
    .string()
    .trim()
    .max(OBSERVACION_MAXIMA, `No puede superar los ${OBSERVACION_MAXIMA} caracteres.`)
    .optional(),
);

const esquemaCantidad = entero(1, CANTIDAD_MAXIMA, "Debe ser mayor que 0.");

/** Verifica que el motivo esté en la lista del tipo (ingreso o egreso). */
function motivoPermitido(tipo: TipoMovimientoManual, motivo: string): boolean {
  return MOTIVOS_POR_TIPO[tipo].includes(motivo);
}

function mensajeMotivo(tipo: TipoMovimientoManual): string {
  return `Para un ${tipo} el motivo debe ser: ${MOTIVOS_POR_TIPO[tipo].join(", ")}.`;
}

/**
 * POST /api/productos/{id}/movimientos (RF-P4, RF-P5). Solo `ingreso` o
 * `egreso`: las ventas y anulaciones se registran desde las facturas. La
 * cantidad es positiva; el signo lo pone el servidor.
 */
export const esquemaMovimientoManual = z
  .strictObject({
    tipo: z.enum(TIPOS_MOVIMIENTO_MANUAL, {
      error:
        "Debe ser «ingreso» o «egreso». Las ventas y anulaciones se registran desde las facturas.",
    }),
    cantidad: esquemaCantidad,
    motivo: z.string().trim().min(1, "Es obligatorio."),
    observacion: esquemaObservacion,
  })
  .superRefine((datos, ctx) => {
    if (!motivoPermitido(datos.tipo, datos.motivo)) {
      ctx.addIssue({ code: "custom", path: ["motivo"], message: mensajeMotivo(datos.tipo) });
    }
  });
export type DatosMovimientoManual = z.infer<typeof esquemaMovimientoManual>;

/**
 * Entrada de moverStock() (uso interno de los servicios). Admite los cuatro
 * tipos. Ingreso y egreso usan los motivos permitidos y no llevan factura;
 * venta y anulación exigen la factura de origen (`facturaId`).
 */
export const esquemaMovimientoStock = z
  .strictObject({
    productoId: esquemaId,
    tipo: z.enum(TIPOS_MOVIMIENTO_STOCK, { error: "Tipo de movimiento inválido." }),
    cantidad: esquemaCantidad,
    motivo: z
      .string()
      .trim()
      .min(1, "Es obligatorio.")
      .max(MOTIVO_MAXIMO, `No puede superar los ${MOTIVO_MAXIMO} caracteres.`),
    observacion: esquemaObservacion,
    facturaId: esquemaId.optional(),
  })
  .superRefine((datos, ctx) => {
    if (datos.tipo === "ingreso" || datos.tipo === "egreso") {
      if (!motivoPermitido(datos.tipo, datos.motivo)) {
        ctx.addIssue({ code: "custom", path: ["motivo"], message: mensajeMotivo(datos.tipo) });
      }
      if (datos.facturaId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["facturaId"],
          message: "Un movimiento manual no referencia una factura.",
        });
      }
    } else if (datos.facturaId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["facturaId"],
        message: "Las ventas y anulaciones deben referenciar su factura.",
      });
    }
  });
export type DatosMovimientoStock = z.infer<typeof esquemaMovimientoStock>;

/** GET /api/productos/{id}/movimientos: solo paginación. */
export const esquemaConsultaMovimientosProducto = z.strictObject({ ...esquemaPaginacion.shape });

/**
 * GET /api/movimientos-stock: `productoId`, `tipo`, `desde`, `hasta`
 * (AAAA-MM-DD, hora de Argentina) y paginación.
 */
export const esquemaConsultaMovimientos = z
  .strictObject({
    ...esquemaPaginacion.shape,
    productoId: z.preprocess(vacioComoAusente, esquemaIdTexto.optional()),
    tipo: z.preprocess(
      vacioComoAusente,
      z.enum(TIPOS_MOVIMIENTO_STOCK, { error: "Tipo de movimiento inválido." }).optional(),
    ),
    desde: z.preprocess(vacioComoAusente, esquemaFechaFiltro.optional()),
    hasta: z.preprocess(vacioComoAusente, esquemaFechaFiltro.optional()),
  })
  .refine((d) => !d.desde || !d.hasta || d.desde <= d.hasta, {
    path: ["hasta"],
    message: "Debe ser igual o posterior a «desde».",
  });
export type ConsultaMovimientos = z.infer<typeof esquemaConsultaMovimientos>;
