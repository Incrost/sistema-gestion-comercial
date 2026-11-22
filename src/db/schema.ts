/**
 * Esquema de la base de datos (Drizzle ORM, dialecto SQLite / libSQL).
 *
 * Es el ÚNICO lugar donde se definen las tablas, sus restricciones e índices y
 * las relaciones entre ellas (consigna, sección 7: modelo de datos).
 *
 * Para crear una tabla o agregar un campo: modificar este archivo, ejecutar
 * `pnpm run db:generate` (genera una migración SQL en ./drizzle) y luego
 * `pnpm run db:migrate` (la aplica sobre la base configurada en src/db/config.ts).
 *
 * Convenciones:
 * - Nombres físicos (tablas y columnas) en snake_case; propiedades de
 *   TypeScript en camelCase. Ej.: columna `stock_minimo` ↔ `stockMinimo`.
 * - Todas las tablas tienen `id` entero autoincremental y `creado_en`.
 * - Importes: enteros en CENTAVOS, nunca coma flotante (regla 10).
 *   Ej.: 1250000 = $ 12.500,00.
 * - Fechas: enteros con milisegundos desde 1970 en UTC (modo `timestamp_ms`).
 *   Drizzle las entrega como `Date`, que se serializa en ISO 8601 UTC
 *   (`2026-10-29T18:24:00.000Z`). Ordenan y filtran por rango como números.
 * - Booleanos: enteros 0/1 (modo `boolean`).
 * - Valores permitidos ("enums"): texto con restricción CHECK en la base y
 *   tipo literal en TypeScript. Las listas se exportan para reutilizarlas en
 *   los esquemas de validación (Zod).
 * - Bajas lógicas (regla 12): columnas `activo`/`activa`; nada con historial
 *   se borra, por eso las claves foráneas usan ON DELETE RESTRICT.
 */
import { relations, sql, type SQL } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Valores permitidos
// ---------------------------------------------------------------------------

/** Roles de usuario (sección 3). */
export const ROLES = ["admin", "vendedor"] as const;
export type Rol = (typeof ROLES)[number];

/** Tipos de movimiento de stock (regla 2). La cantidad lleva signo. */
export const TIPOS_MOVIMIENTO_STOCK = [
  "venta",
  "anulacion",
  "ingreso",
  "egreso",
] as const;
export type TipoMovimientoStock = (typeof TIPOS_MOVIMIENTO_STOCK)[number];

/** Tipos de documento del cliente (RF-C2). */
export const TIPOS_DOCUMENTO = ["DNI", "CUIT"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** Formas de pago de una factura (RF-V5). */
export const FORMAS_PAGO = ["contado", "tarjeta", "cuenta_corriente"] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];

/** Tipos de tarjeta (RF-V5, regla 9). */
export const TIPOS_TARJETA = ["debito", "credito"] as const;
export type TipoTarjeta = (typeof TIPOS_TARJETA)[number];

/** Estados de una factura (regla 5: solo se anula, nunca se modifica). */
export const ESTADOS_FACTURA = ["emitida", "anulada"] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

/** Medios de pago de la cuenta corriente (RF-C5, decisión C2). */
export const MEDIOS_PAGO = ["efectivo", "transferencia", "tarjeta_debito"] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];

/** Tipos de movimiento de cuenta corriente (regla 7: saldo = débitos − créditos). */
export const TIPOS_MOVIMIENTO_CUENTA = ["debito", "credito"] as const;
export type TipoMovimientoCuenta = (typeof TIPOS_MOVIMIENTO_CUENTA)[number];

/** Claves de numeración correlativa (regla 4: facturas y recibos por separado). */
export const CLAVES_SECUENCIA = ["factura", "recibo"] as const;
export type ClaveSecuencia = (typeof CLAVES_SECUENCIA)[number];

// ---------------------------------------------------------------------------
// Ayudantes de columnas y restricciones
// ---------------------------------------------------------------------------

/** Momento actual en milisegundos UTC, calculado por SQLite. */
const AHORA_MS = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** Columna de fecha y hora (milisegundos UTC ↔ Date). */
const fechaHora = (nombre: string) => integer(nombre, { mode: "timestamp_ms" });

/** Fecha y hora obligatoria que por defecto toma el momento de inserción. */
const fechaHoraAhora = (nombre: string) =>
  fechaHora(nombre).notNull().default(AHORA_MS);

/** Columna `creado_en`, común a todas las tablas. */
const creadoEn = () => fechaHoraAhora("creado_en");

/** Clave primaria entera autoincremental. */
const id = () => integer("id").primaryKey({ autoIncrement: true });

/** Booleano 0/1. */
const booleano = (nombre: string) => integer(nombre, { mode: "boolean" });

/**
 * Columna SIN calificar con la tabla, para usar dentro de CHECK: con
 * "tabla"."columna", las migraciones que recrean la tabla fallarían.
 */
function c(columna: AnySQLiteColumn): SQL {
  return sql`${sql.identifier(columna.name)}`;
}

/** Condición SQL: la columna toma uno de los valores de la lista. */
function enLista(columna: AnySQLiteColumn, valores: readonly string[]): SQL {
  const lista = sql.join(
    valores.map((v) => sql.raw(`'${v}'`)),
    sql.raw(", "),
  );
  return sql`${c(columna)} in (${lista})`;
}

/** Condición SQL: texto no vacío (ignorando espacios). */
function noVacio(columna: AnySQLiteColumn): SQL {
  return sql`length(trim(${c(columna)})) > 0`;
}

/** Condición SQL: columna booleana con valor 0 o 1. */
function esBooleano(columna: AnySQLiteColumn): SQL {
  return sql`${c(columna)} in (0, 1)`;
}

// ---------------------------------------------------------------------------
// usuarios — RF-U1 a RF-U5, sección 3
// ---------------------------------------------------------------------------

export const usuarios = sqliteTable(
  "usuarios",
  {
    id: id(),
    // Único. El servicio lo guarda normalizado (sin espacios, en minúsculas).
    email: text("email").notNull(),
    nombre: text("nombre").notNull(),
    // Hash bcrypt (bcryptjs); la contraseña en claro nunca se guarda.
    passwordHash: text("password_hash").notNull(),
    rol: text("rol", { enum: ROLES }).notNull(),
    // Un usuario desactivado no puede iniciar sesión (RF-U4).
    activo: booleano("activo").notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex("usuarios_email_unico").on(t.email),
    check("usuarios_email_no_vacio", noVacio(t.email)),
    check("usuarios_nombre_no_vacio", noVacio(t.nombre)),
    check("usuarios_rol_valido", enLista(t.rol, ROLES)),
    check("usuarios_activo_booleano", esBooleano(t.activo)),
  ],
);

// ---------------------------------------------------------------------------
// categorias — RF-P7
// ---------------------------------------------------------------------------

export const categorias = sqliteTable(
  "categorias",
  {
    id: id(),
    nombre: text("nombre").notNull(),
    activa: booleano("activa").notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex("categorias_nombre_unico").on(t.nombre),
    check("categorias_nombre_no_vacio", noVacio(t.nombre)),
    check("categorias_activa_booleano", esBooleano(t.activa)),
  ],
);

// ---------------------------------------------------------------------------
// productos — RF-P1 a RF-P3
// ---------------------------------------------------------------------------

export const productos = sqliteTable(
  "productos",
  {
    id: id(),
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    categoriaId: integer("categoria_id")
      .notNull()
      .references(() => categorias.id, { onDelete: "restrict" }),
    // Precio de venta final en centavos (sin discriminar IVA).
    precio: integer("precio").notNull(),
    // Existencia guardada (decisión C4). SOLO la modifica moverStock(),
    // que actualiza con `WHERE existencia >= ?` y graba el movimiento en la
    // misma transacción (sección 10.2, reglas 1 y 2). Nunca se edita a mano.
    existencia: integer("existencia").notNull().default(0),
    // Bajo mínimo ⇔ existencia < stockMinimo (decisión D2).
    stockMinimo: integer("stock_minimo").notNull().default(0),
    activo: booleano("activo").notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex("productos_codigo_unico").on(t.codigo),
    index("productos_categoria_idx").on(t.categoriaId),
    index("productos_activo_idx").on(t.activo),
    check("productos_codigo_no_vacio", noVacio(t.codigo)),
    check("productos_descripcion_no_vacia", noVacio(t.descripcion)),
    check("productos_precio_no_negativo", sql`${c(t.precio)} >= 0`),
    // Regla 1: la existencia nunca es negativa (segunda barrera tras el servicio).
    check("productos_existencia_no_negativa", sql`${c(t.existencia)} >= 0`),
    check("productos_stock_minimo_no_negativo", sql`${c(t.stockMinimo)} >= 0`),
    check("productos_activo_booleano", esBooleano(t.activo)),
  ],
);

// ---------------------------------------------------------------------------
// clientes — RF-C1 a RF-C7
// ---------------------------------------------------------------------------

export const clientes = sqliteTable(
  "clientes",
  {
    id: id(),
    tipoDoc: text("tipo_doc", { enum: TIPOS_DOCUMENTO }).notNull(),
    // Número tal como se muestra, p. ej. "28.456.123" o "20-28456123-4".
    nroDoc: text("nro_doc").notNull(),
    // Solo dígitos, p. ej. "28456123". Garantiza la unicidad y permite buscar
    // sin importar puntos ni guiones (GET /api/clientes?q=...).
    nroDocNormalizado: text("nro_doc_normalizado").notNull(),
    nombre: text("nombre").notNull(),
    domicilio: text("domicilio"),
    telefono: text("telefono"),
    email: text("email"),
    // Habilitado para comprar en cuenta corriente (regla 6).
    cuentaCorriente: booleano("cuenta_corriente").notNull().default(false),
    // En centavos; null = sin límite (regla 7).
    limiteCredito: integer("limite_credito"),
    activo: booleano("activo").notNull().default(true),
    creadoEn: creadoEn(),
    // El saldo NO se guarda: se calcula como débitos − créditos de
    // movimientos_cuenta (decisión C4, regla 7, sección 10.2).
  },
  (t) => [
    // Documento único por tipo y número normalizado (RF-C2).
    // El número va primero para que el índice sirva también para buscarlo solo.
    uniqueIndex("clientes_documento_unico").on(t.nroDocNormalizado, t.tipoDoc),
    index("clientes_nombre_idx").on(t.nombre),
    check("clientes_tipo_doc_valido", enLista(t.tipoDoc, TIPOS_DOCUMENTO)),
    check("clientes_nro_doc_no_vacio", noVacio(t.nroDoc)),
    check(
      "clientes_nro_doc_normalizado_valido",
      sql`${c(t.nroDocNormalizado)} not glob '*[^0-9]*' and (
        (${c(t.tipoDoc)} = 'DNI' and length(${c(t.nroDocNormalizado)}) between 6 and 8)
        or (${c(t.tipoDoc)} = 'CUIT' and length(${c(t.nroDocNormalizado)}) = 11)
      )`,
    ),
    check("clientes_nombre_no_vacio", noVacio(t.nombre)),
    check("clientes_cuenta_corriente_booleano", esBooleano(t.cuentaCorriente)),
    check(
      "clientes_limite_credito_no_negativo",
      sql`${c(t.limiteCredito)} is null or ${c(t.limiteCredito)} >= 0`,
    ),
    check("clientes_activo_booleano", esBooleano(t.activo)),
  ],
);

// ---------------------------------------------------------------------------
// facturas — RF-V1 a RF-V9, reglas 3 a 6 y 9
// ---------------------------------------------------------------------------

export const facturas = sqliteTable(
  "facturas",
  {
    id: id(),
    // Numeración "0001-00000001" = puntoVenta-numero (regla 4). El número lo
    // asigna la tabla secuencias al confirmar, dentro de la transacción.
    puntoVenta: integer("punto_venta").notNull(),
    numero: integer("numero").notNull(),
    fecha: fechaHoraAhora("fecha"),
    // Total en centavos, calculado por el servidor (nunca enviado por el cliente).
    total: integer("total").notNull(),
    formaPago: text("forma_pago", { enum: FORMAS_PAGO }).notNull(),
    // null = consumidor final.
    clienteId: integer("cliente_id").references(() => clientes.id, {
      onDelete: "restrict",
    }),
    // Datos del comprador congelados al emitir (decisión D4): si luego se
    // edita el cliente, el comprobante no cambia.
    compradorNombre: text("comprador_nombre").notNull(),
    compradorTipoDoc: text("comprador_tipo_doc", { enum: TIPOS_DOCUMENTO }),
    compradorNroDoc: text("comprador_nro_doc"),
    compradorDomicilio: text("comprador_domicilio"),
    // Usuario que emitió la factura (regla 11).
    vendedorId: integer("vendedor_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
    // Solo contado: monto entregado, en centavos (vuelto = montoRecibido − total).
    montoRecibido: integer("monto_recibido"),
    // Solo tarjeta. Regla 9: tipo, marca y últimos 4 dígitos; NO existe
    // ninguna columna para el número completo.
    tarjetaTipo: text("tarjeta_tipo", { enum: TIPOS_TARJETA }),
    tarjetaMarca: text("tarjeta_marca"),
    tarjetaUltimos4: text("tarjeta_ultimos4"),
    estado: text("estado", { enum: ESTADOS_FACTURA }).notNull().default("emitida"),
    // Datos de anulación (RF-V9): obligatorios solo si estado = 'anulada'.
    motivoAnulacion: text("motivo_anulacion"),
    fechaAnulacion: fechaHora("fecha_anulacion"),
    anuladaPorId: integer("anulada_por_id").references(() => usuarios.id, {
      onDelete: "restrict",
    }),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex("facturas_punto_venta_numero_unico").on(t.puntoVenta, t.numero),
    // Filtros del listado (RF-V8) y del tablero (RF-T1, RF-T2).
    index("facturas_fecha_idx").on(t.fecha),
    index("facturas_cliente_fecha_idx").on(t.clienteId, t.fecha),
    index("facturas_vendedor_fecha_idx").on(t.vendedorId, t.fecha),
    index("facturas_forma_pago_fecha_idx").on(t.formaPago, t.fecha),
    index("facturas_estado_fecha_idx").on(t.estado, t.fecha),
    check("facturas_punto_venta_valido", sql`${c(t.puntoVenta)} between 1 and 9999`),
    check("facturas_numero_valido", sql`${c(t.numero)} between 1 and 99999999`),
    check("facturas_total_no_negativo", sql`${c(t.total)} >= 0`),
    check("facturas_forma_pago_valida", enLista(t.formaPago, FORMAS_PAGO)),
    check("facturas_estado_valido", enLista(t.estado, ESTADOS_FACTURA)),
    check("facturas_comprador_nombre_no_vacio", noVacio(t.compradorNombre)),
    check(
      "facturas_comprador_tipo_doc_valido",
      sql`${c(t.compradorTipoDoc)} is null or ${enLista(t.compradorTipoDoc, TIPOS_DOCUMENTO)}`,
    ),
    // Regla 6: consumidor final no compra en cuenta corriente.
    check(
      "facturas_cuenta_corriente_con_cliente",
      sql`${c(t.formaPago)} <> 'cuenta_corriente' or ${c(t.clienteId)} is not null`,
    ),
    // Monto recibido solo en contado y cubriendo el total.
    check(
      "facturas_monto_recibido_valido",
      sql`(${c(t.formaPago)} = 'contado' and ${c(t.montoRecibido)} is not null and ${c(t.montoRecibido)} >= ${c(t.total)})
        or (${c(t.formaPago)} <> 'contado' and ${c(t.montoRecibido)} is null)`,
    ),
    // Datos de tarjeta: los tres presentes si es tarjeta, ninguno si no.
    // (Los `is not null` son necesarios: en SQLite un CHECK que da NULL se acepta.)
    check(
      "facturas_tarjeta_valida",
      sql`(${c(t.formaPago)} = 'tarjeta'
          and ${c(t.tarjetaTipo)} is not null and ${enLista(t.tarjetaTipo, TIPOS_TARJETA)}
          and ${c(t.tarjetaMarca)} is not null and ${noVacio(t.tarjetaMarca)}
          and ${c(t.tarjetaUltimos4)} is not null
          and ${c(t.tarjetaUltimos4)} glob '[0-9][0-9][0-9][0-9]')
        or (${c(t.formaPago)} <> 'tarjeta'
          and ${c(t.tarjetaTipo)} is null
          and ${c(t.tarjetaMarca)} is null
          and ${c(t.tarjetaUltimos4)} is null)`,
    ),
    // Anulada ⇔ tiene motivo, fecha y usuario de anulación.
    check(
      "facturas_anulacion_coherente",
      sql`(${c(t.estado)} = 'anulada'
          and ${c(t.motivoAnulacion)} is not null and ${noVacio(t.motivoAnulacion)}
          and ${c(t.fechaAnulacion)} is not null
          and ${c(t.anuladaPorId)} is not null)
        or (${c(t.estado)} = 'emitida'
          and ${c(t.motivoAnulacion)} is null
          and ${c(t.fechaAnulacion)} is null
          and ${c(t.anuladaPorId)} is null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// factura_items — RF-V3, regla 3 (precio congelado)
// ---------------------------------------------------------------------------

export const facturaItems = sqliteTable(
  "factura_items",
  {
    id: id(),
    facturaId: integer("factura_id")
      .notNull()
      .references(() => facturas.id, { onDelete: "restrict" }),
    productoId: integer("producto_id")
      .notNull()
      .references(() => productos.id, { onDelete: "restrict" }),
    // Código y descripción copiados del catálogo al emitir (regla 3).
    codigo: text("codigo").notNull(),
    descripcion: text("descripcion").notNull(),
    cantidad: integer("cantidad").notNull(),
    // Precio del momento, en centavos: cambiar el catálogo no altera la factura.
    precioUnitario: integer("precio_unitario").notNull(),
    subtotal: integer("subtotal").notNull(),
    creadoEn: creadoEn(),
  },
  (t) => [
    // Sin productos repetidos en una misma factura (sección 11.6).
    uniqueIndex("factura_items_factura_producto_unico").on(t.facturaId, t.productoId),
    // Más vendidos (RF-T3) e historial por producto.
    index("factura_items_producto_idx").on(t.productoId),
    check("factura_items_cantidad_positiva", sql`${c(t.cantidad)} > 0`),
    check("factura_items_precio_no_negativo", sql`${c(t.precioUnitario)} >= 0`),
    check(
      "factura_items_subtotal_coherente",
      sql`${c(t.subtotal)} = ${c(t.cantidad)} * ${c(t.precioUnitario)}`,
    ),
    check("factura_items_descripcion_no_vacia", noVacio(t.descripcion)),
  ],
);

// ---------------------------------------------------------------------------
// movimientos_stock — RF-P4 a RF-P6, regla 2 (todo cambio de stock deja un movimiento)
// ---------------------------------------------------------------------------

export const movimientosStock = sqliteTable(
  "movimientos_stock",
  {
    id: id(),
    productoId: integer("producto_id")
      .notNull()
      .references(() => productos.id, { onDelete: "restrict" }),
    tipo: text("tipo", { enum: TIPOS_MOVIMIENTO_STOCK }).notNull(),
    // Con signo: negativa en venta/egreso, positiva en anulación/ingreso.
    // La suma de cantidades de un producto debe dar su existencia (regla 2).
    cantidad: integer("cantidad").notNull(),
    // Existencia del producto inmediatamente después de este movimiento.
    existenciaResultante: integer("existencia_resultante").notNull(),
    // P. ej. "Venta", "Anulación", "Reposición", "Rotura" (sección 11.4).
    motivo: text("motivo").notNull(),
    observacion: text("observacion"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
    // Solo en ventas y anulaciones.
    facturaId: integer("factura_id").references(() => facturas.id, {
      onDelete: "restrict",
    }),
    // Momento de la operación. Se separa de creado_en para que los datos de
    // prueba puedan registrar operaciones de días anteriores.
    fecha: fechaHoraAhora("fecha"),
    creadoEn: creadoEn(),
  },
  (t) => [
    // Ficha del producto, del más nuevo al más viejo (RF-P6).
    index("movimientos_stock_producto_fecha_idx").on(t.productoId, t.fecha),
    index("movimientos_stock_tipo_fecha_idx").on(t.tipo, t.fecha),
    index("movimientos_stock_fecha_idx").on(t.fecha),
    index("movimientos_stock_factura_idx").on(t.facturaId),
    index("movimientos_stock_usuario_idx").on(t.usuarioId),
    check("movimientos_stock_tipo_valido", enLista(t.tipo, TIPOS_MOVIMIENTO_STOCK)),
    check(
      "movimientos_stock_signo_coherente",
      sql`(${c(t.tipo)} in ('venta', 'egreso') and ${c(t.cantidad)} < 0)
        or (${c(t.tipo)} in ('anulacion', 'ingreso') and ${c(t.cantidad)} > 0)`,
    ),
    check(
      "movimientos_stock_existencia_no_negativa",
      sql`${c(t.existenciaResultante)} >= 0`,
    ),
    check("movimientos_stock_motivo_no_vacio", noVacio(t.motivo)),
    // Ventas y anulaciones referencian su factura; ingresos y egresos, no.
    check(
      "movimientos_stock_factura_coherente",
      sql`(${c(t.tipo)} in ('venta', 'anulacion') and ${c(t.facturaId)} is not null)
        or (${c(t.tipo)} in ('ingreso', 'egreso') and ${c(t.facturaId)} is null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// pagos — RF-C5 (recibos de la cuenta corriente), regla 8
// ---------------------------------------------------------------------------

export const pagos = sqliteTable(
  "pagos",
  {
    id: id(),
    // Recibo "R 0001-00000341" = puntoVenta-numero, con numeración propia
    // en la tabla secuencias (regla 4).
    puntoVenta: integer("punto_venta").notNull(),
    numero: integer("numero").notNull(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "restrict" }),
    fecha: fechaHoraAhora("fecha"),
    // En centavos, mayor que cero y no mayor que la deuda (regla 8, en el servicio).
    importe: integer("importe").notNull(),
    medio: text("medio", { enum: MEDIOS_PAGO }).notNull(),
    observacion: text("observacion"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "restrict" }),
    // Saldo del cliente después del pago, congelado para reimprimir el recibo
    // tal como se emitió (decisión C7). No es fuente de verdad del saldo.
    saldoResultante: integer("saldo_resultante").notNull(),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex("pagos_punto_venta_numero_unico").on(t.puntoVenta, t.numero),
    index("pagos_cliente_fecha_idx").on(t.clienteId, t.fecha),
    index("pagos_fecha_idx").on(t.fecha),
    index("pagos_usuario_idx").on(t.usuarioId),
    check("pagos_punto_venta_valido", sql`${c(t.puntoVenta)} between 1 and 9999`),
    check("pagos_numero_valido", sql`${c(t.numero)} between 1 and 99999999`),
    check("pagos_importe_positivo", sql`${c(t.importe)} > 0`),
    check("pagos_medio_valido", enLista(t.medio, MEDIOS_PAGO)),
    check("pagos_saldo_resultante_no_negativo", sql`${c(t.saldoResultante)} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// movimientos_cuenta — RF-C4, regla 7 (saldo = débitos − créditos)
// ---------------------------------------------------------------------------

export const movimientosCuenta = sqliteTable(
  "movimientos_cuenta",
  {
    id: id(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => clientes.id, { onDelete: "restrict" }),
    // debito: venta a cuenta. credito: pago o anulación de una venta a cuenta.
    tipo: text("tipo", { enum: TIPOS_MOVIMIENTO_CUENTA }).notNull(),
    // Siempre positivo, en centavos; el tipo indica si suma o resta.
    importe: integer("importe").notNull(),
    fecha: fechaHoraAhora("fecha"),
    // P. ej. "Factura 0001-00001223" o "Recibo R 0001-00000340".
    descripcion: text("descripcion").notNull(),
    // Origen: exactamente uno de los dos.
    facturaId: integer("factura_id").references(() => facturas.id, {
      onDelete: "restrict",
    }),
    pagoId: integer("pago_id").references(() => pagos.id, { onDelete: "restrict" }),
    creadoEn: creadoEn(),
  },
  (t) => [
    // Cuenta corriente en orden cronológico y cálculo del saldo (RF-C4, RF-C6).
    index("movimientos_cuenta_cliente_fecha_idx").on(t.clienteId, t.fecha),
    // Una factura genera a lo sumo un débito (venta) y un crédito (anulación).
    uniqueIndex("movimientos_cuenta_factura_tipo_unico").on(t.facturaId, t.tipo),
    // Un pago genera exactamente un crédito.
    uniqueIndex("movimientos_cuenta_pago_unico").on(t.pagoId),
    check("movimientos_cuenta_tipo_valido", enLista(t.tipo, TIPOS_MOVIMIENTO_CUENTA)),
    check("movimientos_cuenta_importe_positivo", sql`${c(t.importe)} > 0`),
    check("movimientos_cuenta_descripcion_no_vacia", noVacio(t.descripcion)),
    check(
      "movimientos_cuenta_origen_coherente",
      sql`(${c(t.tipo)} = 'debito' and ${c(t.facturaId)} is not null and ${c(t.pagoId)} is null)
        or (${c(t.tipo)} = 'credito'
          and ((${c(t.facturaId)} is not null and ${c(t.pagoId)} is null)
            or (${c(t.facturaId)} is null and ${c(t.pagoId)} is not null)))`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// secuencias — regla 4 (numeración correlativa y sin huecos), decisión D3
// ---------------------------------------------------------------------------

export const secuencias = sqliteTable(
  "secuencias",
  {
    id: id(),
    // 'factura' o 'recibo': cada una con su propia numeración.
    clave: text("clave", { enum: CLAVES_SECUENCIA }).notNull(),
    puntoVenta: integer("punto_venta").notNull(),
    // Último número asignado (0 = todavía ninguno). Se incrementa dentro de la
    // MISMA transacción que graba la factura o el pago: si ésta falla, el
    // incremento se revierte y no quedan huecos.
    ultimoNumero: integer("ultimo_numero").notNull().default(0),
    actualizadoEn: fechaHoraAhora("actualizado_en"),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex("secuencias_clave_punto_venta_unico").on(t.clave, t.puntoVenta),
    check("secuencias_clave_valida", enLista(t.clave, CLAVES_SECUENCIA)),
    check("secuencias_punto_venta_valido", sql`${c(t.puntoVenta)} between 1 and 9999`),
    check(
      "secuencias_ultimo_numero_valido",
      sql`${c(t.ultimoNumero)} between 0 and 99999999`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relaciones (consultas relacionales de Drizzle: db.query.<tabla>.findMany({ with }))
// No generan SQL: las claves foráneas reales están en `.references()` arriba.
// ---------------------------------------------------------------------------

export const usuariosRelations = relations(usuarios, ({ many }) => ({
  facturasEmitidas: many(facturas, { relationName: "factura_vendedor" }),
  facturasAnuladas: many(facturas, { relationName: "factura_anulada_por" }),
  movimientosStock: many(movimientosStock),
  pagos: many(pagos),
}));

export const categoriasRelations = relations(categorias, ({ many }) => ({
  productos: many(productos),
}));

export const productosRelations = relations(productos, ({ one, many }) => ({
  categoria: one(categorias, {
    fields: [productos.categoriaId],
    references: [categorias.id],
  }),
  movimientosStock: many(movimientosStock),
  facturaItems: many(facturaItems),
}));

export const clientesRelations = relations(clientes, ({ many }) => ({
  facturas: many(facturas),
  pagos: many(pagos),
  movimientosCuenta: many(movimientosCuenta),
}));

export const facturasRelations = relations(facturas, ({ one, many }) => ({
  cliente: one(clientes, {
    fields: [facturas.clienteId],
    references: [clientes.id],
  }),
  vendedor: one(usuarios, {
    fields: [facturas.vendedorId],
    references: [usuarios.id],
    relationName: "factura_vendedor",
  }),
  anuladaPor: one(usuarios, {
    fields: [facturas.anuladaPorId],
    references: [usuarios.id],
    relationName: "factura_anulada_por",
  }),
  items: many(facturaItems),
  movimientosStock: many(movimientosStock),
  movimientosCuenta: many(movimientosCuenta),
}));

export const facturaItemsRelations = relations(facturaItems, ({ one }) => ({
  factura: one(facturas, {
    fields: [facturaItems.facturaId],
    references: [facturas.id],
  }),
  producto: one(productos, {
    fields: [facturaItems.productoId],
    references: [productos.id],
  }),
}));

export const movimientosStockRelations = relations(movimientosStock, ({ one }) => ({
  producto: one(productos, {
    fields: [movimientosStock.productoId],
    references: [productos.id],
  }),
  usuario: one(usuarios, {
    fields: [movimientosStock.usuarioId],
    references: [usuarios.id],
  }),
  factura: one(facturas, {
    fields: [movimientosStock.facturaId],
    references: [facturas.id],
  }),
}));

export const pagosRelations = relations(pagos, ({ one, many }) => ({
  cliente: one(clientes, {
    fields: [pagos.clienteId],
    references: [clientes.id],
  }),
  usuario: one(usuarios, {
    fields: [pagos.usuarioId],
    references: [usuarios.id],
  }),
  movimientosCuenta: many(movimientosCuenta),
}));

export const movimientosCuentaRelations = relations(movimientosCuenta, ({ one }) => ({
  cliente: one(clientes, {
    fields: [movimientosCuenta.clienteId],
    references: [clientes.id],
  }),
  factura: one(facturas, {
    fields: [movimientosCuenta.facturaId],
    references: [facturas.id],
  }),
  pago: one(pagos, {
    fields: [movimientosCuenta.pagoId],
    references: [pagos.id],
  }),
}));

// ---------------------------------------------------------------------------
// Tipos inferidos (fila leída / fila a insertar)
// ---------------------------------------------------------------------------

export type Usuario = typeof usuarios.$inferSelect;
export type NuevoUsuario = typeof usuarios.$inferInsert;
export type Categoria = typeof categorias.$inferSelect;
export type NuevaCategoria = typeof categorias.$inferInsert;
export type Producto = typeof productos.$inferSelect;
export type NuevoProducto = typeof productos.$inferInsert;
export type Cliente = typeof clientes.$inferSelect;
export type NuevoCliente = typeof clientes.$inferInsert;
export type Factura = typeof facturas.$inferSelect;
export type NuevaFactura = typeof facturas.$inferInsert;
export type FacturaItem = typeof facturaItems.$inferSelect;
export type NuevoFacturaItem = typeof facturaItems.$inferInsert;
export type MovimientoStock = typeof movimientosStock.$inferSelect;
export type NuevoMovimientoStock = typeof movimientosStock.$inferInsert;
export type Pago = typeof pagos.$inferSelect;
export type NuevoPago = typeof pagos.$inferInsert;
export type MovimientoCuenta = typeof movimientosCuenta.$inferSelect;
export type NuevoMovimientoCuenta = typeof movimientosCuenta.$inferInsert;
export type Secuencia = typeof secuencias.$inferSelect;
export type NuevaSecuencia = typeof secuencias.$inferInsert;
