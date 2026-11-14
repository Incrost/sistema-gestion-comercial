CREATE TABLE `categorias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`activa` integer DEFAULT true NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "categorias_nombre_no_vacio" CHECK(length(trim("nombre")) > 0),
	CONSTRAINT "categorias_activa_booleano" CHECK("activa" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categorias_nombre_unico` ON `categorias` (`nombre`);--> statement-breakpoint
CREATE TABLE `clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo_doc` text NOT NULL,
	`nro_doc` text NOT NULL,
	`nro_doc_normalizado` text NOT NULL,
	`nombre` text NOT NULL,
	`domicilio` text,
	`telefono` text,
	`email` text,
	`cuenta_corriente` integer DEFAULT false NOT NULL,
	`limite_credito` integer,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "clientes_tipo_doc_valido" CHECK("tipo_doc" in ('DNI', 'CUIT')),
	CONSTRAINT "clientes_nro_doc_no_vacio" CHECK(length(trim("nro_doc")) > 0),
	CONSTRAINT "clientes_nro_doc_normalizado_valido" CHECK("nro_doc_normalizado" not glob '*[^0-9]*' and (
        ("tipo_doc" = 'DNI' and length("nro_doc_normalizado") between 6 and 8)
        or ("tipo_doc" = 'CUIT' and length("nro_doc_normalizado") = 11)
      )),
	CONSTRAINT "clientes_nombre_no_vacio" CHECK(length(trim("nombre")) > 0),
	CONSTRAINT "clientes_cuenta_corriente_booleano" CHECK("cuenta_corriente" in (0, 1)),
	CONSTRAINT "clientes_limite_credito_no_negativo" CHECK("limite_credito" is null or "limite_credito" >= 0),
	CONSTRAINT "clientes_activo_booleano" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_documento_unico` ON `clientes` (`nro_doc_normalizado`,`tipo_doc`);--> statement-breakpoint
CREATE INDEX `clientes_nombre_idx` ON `clientes` (`nombre`);--> statement-breakpoint
CREATE TABLE `factura_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`factura_id` integer NOT NULL,
	`producto_id` integer NOT NULL,
	`codigo` text NOT NULL,
	`descripcion` text NOT NULL,
	`cantidad` integer NOT NULL,
	`precio_unitario` integer NOT NULL,
	`subtotal` integer NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`factura_id`) REFERENCES `facturas`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "factura_items_cantidad_positiva" CHECK("cantidad" > 0),
	CONSTRAINT "factura_items_precio_no_negativo" CHECK("precio_unitario" >= 0),
	CONSTRAINT "factura_items_subtotal_coherente" CHECK("subtotal" = "cantidad" * "precio_unitario"),
	CONSTRAINT "factura_items_descripcion_no_vacia" CHECK(length(trim("descripcion")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factura_items_factura_producto_unico` ON `factura_items` (`factura_id`,`producto_id`);--> statement-breakpoint
CREATE INDEX `factura_items_producto_idx` ON `factura_items` (`producto_id`);--> statement-breakpoint
CREATE TABLE `facturas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`punto_venta` integer NOT NULL,
	`numero` integer NOT NULL,
	`fecha` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`total` integer NOT NULL,
	`forma_pago` text NOT NULL,
	`cliente_id` integer,
	`comprador_nombre` text NOT NULL,
	`comprador_tipo_doc` text,
	`comprador_nro_doc` text,
	`comprador_domicilio` text,
	`vendedor_id` integer NOT NULL,
	`monto_recibido` integer,
	`tarjeta_tipo` text,
	`tarjeta_marca` text,
	`tarjeta_ultimos4` text,
	`estado` text DEFAULT 'emitida' NOT NULL,
	`motivo_anulacion` text,
	`fecha_anulacion` integer,
	`anulada_por_id` integer,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vendedor_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`anulada_por_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "facturas_punto_venta_valido" CHECK("punto_venta" between 1 and 9999),
	CONSTRAINT "facturas_numero_valido" CHECK("numero" between 1 and 99999999),
	CONSTRAINT "facturas_total_no_negativo" CHECK("total" >= 0),
	CONSTRAINT "facturas_forma_pago_valida" CHECK("forma_pago" in ('contado', 'tarjeta', 'cuenta_corriente')),
	CONSTRAINT "facturas_estado_valido" CHECK("estado" in ('emitida', 'anulada')),
	CONSTRAINT "facturas_comprador_nombre_no_vacio" CHECK(length(trim("comprador_nombre")) > 0),
	CONSTRAINT "facturas_comprador_tipo_doc_valido" CHECK("comprador_tipo_doc" is null or "comprador_tipo_doc" in ('DNI', 'CUIT')),
	CONSTRAINT "facturas_cuenta_corriente_con_cliente" CHECK("forma_pago" <> 'cuenta_corriente' or "cliente_id" is not null),
	CONSTRAINT "facturas_monto_recibido_valido" CHECK(("forma_pago" = 'contado' and "monto_recibido" is not null and "monto_recibido" >= "total")
        or ("forma_pago" <> 'contado' and "monto_recibido" is null)),
	CONSTRAINT "facturas_tarjeta_valida" CHECK(("forma_pago" = 'tarjeta'
          and "tarjeta_tipo" is not null and "tarjeta_tipo" in ('debito', 'credito')
          and "tarjeta_marca" is not null and length(trim("tarjeta_marca")) > 0
          and "tarjeta_ultimos4" is not null
          and "tarjeta_ultimos4" glob '[0-9][0-9][0-9][0-9]')
        or ("forma_pago" <> 'tarjeta'
          and "tarjeta_tipo" is null
          and "tarjeta_marca" is null
          and "tarjeta_ultimos4" is null)),
	CONSTRAINT "facturas_anulacion_coherente" CHECK(("estado" = 'anulada'
          and "motivo_anulacion" is not null and length(trim("motivo_anulacion")) > 0
          and "fecha_anulacion" is not null
          and "anulada_por_id" is not null)
        or ("estado" = 'emitida'
          and "motivo_anulacion" is null
          and "fecha_anulacion" is null
          and "anulada_por_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facturas_punto_venta_numero_unico` ON `facturas` (`punto_venta`,`numero`);--> statement-breakpoint
CREATE INDEX `facturas_fecha_idx` ON `facturas` (`fecha`);--> statement-breakpoint
CREATE INDEX `facturas_cliente_fecha_idx` ON `facturas` (`cliente_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `facturas_vendedor_fecha_idx` ON `facturas` (`vendedor_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `facturas_forma_pago_fecha_idx` ON `facturas` (`forma_pago`,`fecha`);--> statement-breakpoint
CREATE INDEX `facturas_estado_fecha_idx` ON `facturas` (`estado`,`fecha`);--> statement-breakpoint
CREATE TABLE `movimientos_cuenta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`importe` integer NOT NULL,
	`fecha` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`descripcion` text NOT NULL,
	`factura_id` integer,
	`pago_id` integer,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`factura_id`) REFERENCES `facturas`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pago_id`) REFERENCES `pagos`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "movimientos_cuenta_tipo_valido" CHECK("tipo" in ('debito', 'credito')),
	CONSTRAINT "movimientos_cuenta_importe_positivo" CHECK("importe" > 0),
	CONSTRAINT "movimientos_cuenta_descripcion_no_vacia" CHECK(length(trim("descripcion")) > 0),
	CONSTRAINT "movimientos_cuenta_origen_coherente" CHECK(("tipo" = 'debito' and "factura_id" is not null and "pago_id" is null)
        or ("tipo" = 'credito'
          and (("factura_id" is not null and "pago_id" is null)
            or ("factura_id" is null and "pago_id" is not null))))
);
--> statement-breakpoint
CREATE INDEX `movimientos_cuenta_cliente_fecha_idx` ON `movimientos_cuenta` (`cliente_id`,`fecha`);--> statement-breakpoint
CREATE UNIQUE INDEX `movimientos_cuenta_factura_tipo_unico` ON `movimientos_cuenta` (`factura_id`,`tipo`);--> statement-breakpoint
CREATE UNIQUE INDEX `movimientos_cuenta_pago_unico` ON `movimientos_cuenta` (`pago_id`);--> statement-breakpoint
CREATE TABLE `movimientos_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`cantidad` integer NOT NULL,
	`existencia_resultante` integer NOT NULL,
	`motivo` text NOT NULL,
	`observacion` text,
	`usuario_id` integer NOT NULL,
	`factura_id` integer,
	`fecha` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`factura_id`) REFERENCES `facturas`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "movimientos_stock_tipo_valido" CHECK("tipo" in ('venta', 'anulacion', 'ingreso', 'egreso')),
	CONSTRAINT "movimientos_stock_signo_coherente" CHECK(("tipo" in ('venta', 'egreso') and "cantidad" < 0)
        or ("tipo" in ('anulacion', 'ingreso') and "cantidad" > 0)),
	CONSTRAINT "movimientos_stock_existencia_no_negativa" CHECK("existencia_resultante" >= 0),
	CONSTRAINT "movimientos_stock_motivo_no_vacio" CHECK(length(trim("motivo")) > 0),
	CONSTRAINT "movimientos_stock_factura_coherente" CHECK(("tipo" in ('venta', 'anulacion') and "factura_id" is not null)
        or ("tipo" in ('ingreso', 'egreso') and "factura_id" is null))
);
--> statement-breakpoint
CREATE INDEX `movimientos_stock_producto_fecha_idx` ON `movimientos_stock` (`producto_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `movimientos_stock_tipo_fecha_idx` ON `movimientos_stock` (`tipo`,`fecha`);--> statement-breakpoint
CREATE INDEX `movimientos_stock_fecha_idx` ON `movimientos_stock` (`fecha`);--> statement-breakpoint
CREATE INDEX `movimientos_stock_factura_idx` ON `movimientos_stock` (`factura_id`);--> statement-breakpoint
CREATE INDEX `movimientos_stock_usuario_idx` ON `movimientos_stock` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `pagos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`punto_venta` integer NOT NULL,
	`numero` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`fecha` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`importe` integer NOT NULL,
	`medio` text NOT NULL,
	`observacion` text,
	`usuario_id` integer NOT NULL,
	`saldo_resultante` integer NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pagos_punto_venta_valido" CHECK("punto_venta" between 1 and 9999),
	CONSTRAINT "pagos_numero_valido" CHECK("numero" between 1 and 99999999),
	CONSTRAINT "pagos_importe_positivo" CHECK("importe" > 0),
	CONSTRAINT "pagos_medio_valido" CHECK("medio" in ('efectivo', 'transferencia', 'tarjeta_debito')),
	CONSTRAINT "pagos_saldo_resultante_no_negativo" CHECK("saldo_resultante" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pagos_punto_venta_numero_unico` ON `pagos` (`punto_venta`,`numero`);--> statement-breakpoint
CREATE INDEX `pagos_cliente_fecha_idx` ON `pagos` (`cliente_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `pagos_fecha_idx` ON `pagos` (`fecha`);--> statement-breakpoint
CREATE INDEX `pagos_usuario_idx` ON `pagos` (`usuario_id`);--> statement-breakpoint
CREATE TABLE `productos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`descripcion` text NOT NULL,
	`categoria_id` integer NOT NULL,
	`precio` integer NOT NULL,
	`existencia` integer DEFAULT 0 NOT NULL,
	`stock_minimo` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "productos_codigo_no_vacio" CHECK(length(trim("codigo")) > 0),
	CONSTRAINT "productos_descripcion_no_vacia" CHECK(length(trim("descripcion")) > 0),
	CONSTRAINT "productos_precio_no_negativo" CHECK("precio" >= 0),
	CONSTRAINT "productos_existencia_no_negativa" CHECK("existencia" >= 0),
	CONSTRAINT "productos_stock_minimo_no_negativo" CHECK("stock_minimo" >= 0),
	CONSTRAINT "productos_activo_booleano" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `productos_codigo_unico` ON `productos` (`codigo`);--> statement-breakpoint
CREATE INDEX `productos_categoria_idx` ON `productos` (`categoria_id`);--> statement-breakpoint
CREATE INDEX `productos_activo_idx` ON `productos` (`activo`);--> statement-breakpoint
CREATE TABLE `secuencias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clave` text NOT NULL,
	`punto_venta` integer NOT NULL,
	`ultimo_numero` integer DEFAULT 0 NOT NULL,
	`actualizado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "secuencias_clave_valida" CHECK("clave" in ('factura', 'recibo')),
	CONSTRAINT "secuencias_punto_venta_valido" CHECK("punto_venta" between 1 and 9999),
	CONSTRAINT "secuencias_ultimo_numero_valido" CHECK("ultimo_numero" between 0 and 99999999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secuencias_clave_punto_venta_unico` ON `secuencias` (`clave`,`punto_venta`);--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`nombre` text NOT NULL,
	`password_hash` text NOT NULL,
	`rol` text NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "usuarios_email_no_vacio" CHECK(length(trim("email")) > 0),
	CONSTRAINT "usuarios_nombre_no_vacio" CHECK(length(trim("nombre")) > 0),
	CONSTRAINT "usuarios_rol_valido" CHECK("rol" in ('admin', 'vendedor')),
	CONSTRAINT "usuarios_activo_booleano" CHECK("activo" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_email_unico` ON `usuarios` (`email`);