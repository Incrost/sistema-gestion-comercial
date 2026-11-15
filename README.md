# Sistema de Gestión Comercial

Sistema web full stack para un comercio minorista de un solo local: facturación de ventas, control de existencias del catálogo y cuenta corriente de clientes, con usuarios, roles y un tablero de indicadores.

> Proyecto académico. El comprobante que emite el sistema es interno y no tiene validez fiscal.

---

## Índice

1. [Descripción](#descripción)
2. [Objetivo académico](#objetivo-académico)
3. [Funcionalidades principales](#funcionalidades-principales)
4. [Tecnologías utilizadas](#tecnologías-utilizadas)
5. [Arquitectura por capas](#arquitectura-por-capas)
6. [Requisitos previos](#requisitos-previos)
7. [Instalación local](#instalación-local)
8. [Variables de entorno](#variables-de-entorno)
9. [SQLite local y Turso](#sqlite-local-y-turso)
10. [Migraciones](#migraciones)
11. [Seed académico](#seed-académico)
12. [Comandos disponibles](#comandos-disponibles)
13. [Usuarios de prueba](#usuarios-de-prueba)
14. [Roles y permisos](#roles-y-permisos)
15. [Estructura de carpetas](#estructura-de-carpetas)
16. [API REST](#api-rest)
17. [Reglas de negocio críticas](#reglas-de-negocio-críticas)
18. [Datos de prueba incluidos](#datos-de-prueba-incluidos)
19. [Pruebas](#pruebas)
20. [Publicación](#publicación)
21. [Integrantes](#integrantes)
22. [Uso de inteligencia artificial](#uso-de-inteligencia-artificial)
23. [Decisiones técnicas documentadas](#decisiones-técnicas-documentadas)
24. [Estado del proyecto](#estado-del-proyecto)
25. [Licencia y uso académico](#licencia-y-uso-académico)

---

## Descripción

El vendedor arma la venta en el mostrador, identifica al comprador (consumidor final o cliente registrado, con alta en el momento), elige la forma de pago y emite la factura. El servidor vuelve a verificar el stock, asigna el número correlativo, descuenta las existencias y, si la venta es en cuenta corriente, registra la deuda del cliente; todo en una única transacción. Los clientes cancelan su deuda con pagos que generan un recibo numerado.

## Objetivo académico

Segundo parcial de **Programación IV: Desarrollo Web**. El trabajo integra:

- modelado de un dominio real en tablas y relaciones, manteniendo la consistencia de stock y saldos;
- una aplicación full stack con autenticación y permisos por rol verificados en el servidor;
- operaciones compuestas resueltas en transacciones atómicas;
- una interfaz profesional, adaptable y operable con teclado;
- la publicación del sistema en la nube (Vercel y Turso).

Los requerimientos se citan con los códigos de la consigna (RF-V, RF-P, RF-C, RF-U, RF-T y reglas 1 a 12).

## Funcionalidades principales

| Módulo | Funcionalidades | Requerimientos |
| --- | --- | --- |
| Inicio | Ventas del día y del mes, total adeudado, productos bajo mínimo, gráfico de ventas diarias (30 días), ventas por forma de pago, 5 más vendidos, productos para reponer | RF-T1 a RF-T3 |
| Ventas | Nueva venta en una sola pantalla (comprador, ítems y pago), alta rápida de cliente sin perder la venta, control de existencia, contado con vuelto, tarjeta (solo tipo, marca y últimos 4 dígitos), cuenta corriente con límite de crédito, comprobante imprimible, listado con filtros y paginado, anulación con motivo | RF-V1 a RF-V9 |
| Productos | Catálogo paginado con búsqueda y filtros, marca de bajo mínimo, alta y edición, baja lógica, ingresos y egresos de stock con motivo, historial de movimientos, categorías | RF-P1 a RF-P7 |
| Clientes | Listado con saldo, alta y edición, ficha con últimas facturas, cuenta corriente con saldo acumulado, registro de pagos con recibo imprimible, saldos de deudores, baja lógica | RF-C1 a RF-C7 |
| Usuarios | Inicio y cierre de sesión, alta, edición, desactivación y asignación de rol, restablecimiento de contraseña, cambio de la propia contraseña | RF-U1 a RF-U5 |

Además: panel lateral fijo que se colapsa en un menú en pantallas chicas, estados de carga, vacío y error en cada listado, avisos de resultado, confirmación de acciones irreversibles y formatos locales (`$ 12.345,50`, `dd/mm/aaaa`, hora de Argentina).

## Tecnologías utilizadas

| Capa | Tecnología |
| --- | --- |
| Lenguaje | TypeScript |
| Framework | Next.js 16 (App Router, enrutamiento basado en archivos) |
| API | REST con Route Handlers de Next.js |
| Interfaz | React 19, shadcn/ui, Tailwind CSS 4, lucide-react, sonner |
| Gráficos | Chart.js con react-chartjs-2 |
| Base de datos | SQLite en desarrollo; libSQL remota (Turso) en producción |
| Acceso a datos | Drizzle ORM y migraciones con drizzle-kit |
| Validación | Zod, con esquemas compartidos entre cliente y servidor |
| Autenticación | Sesión propia en cookie firmada (JWT HS256 con `jose`); contraseñas con `bcryptjs` |
| Pruebas | Vitest |
| Hosting | Vercel (aplicación) y Turso (base de datos) |
| Control de versiones | Git y GitHub |

## Arquitectura por capas

El principio que ordena el código es uno solo: **cada regla de negocio vive en un único lugar, la capa de servicios**.

```text
Interfaz (src/app, src/components)       Muestra datos, adelanta validaciones y avisa resultados.
        │  Server Components llaman a los servicios; los componentes interactivos consumen la API REST.
        ▼
Adaptadores (src/app/api/**/route.ts)    Exigen sesión, leen parámetros y cuerpo, llaman a un servicio
        │  envoltorio común: src/lib/http/ruta.ts y traducen el resultado o el error al formato estándar.
        ▼
Servicios (src/servicios)                Validan con Zod, verifican el rol, aplican las reglas,
        │                                abren las transacciones y devuelven la forma pública.
        ▼
Acceso a datos (src/db)                  Esquema, migraciones, conexión y transacciones.
```

- **Sesión en tres barreras:** el proxy (`src/proxy.ts`) exige una cookie firmada; cada página y cada ruta vuelven a leer al usuario de la base (`src/lib/sesion.ts`); cada servicio verifica el rol con `exigirRol()` (`src/servicios/permisos.ts`).
- **Errores uniformes:** los servicios lanzan `ApiError` (`src/lib/api-error.ts`) con los códigos del catálogo `src/lib/codigos-error.ts`. Un error inesperado se registra en el servidor y se responde como `500 ERROR_INTERNO`, sin detalles.
- **Validación compartida:** los esquemas de `src/lib/validacion*.ts` los usan tanto los formularios como los servicios. Los esquemas de edición son estrictos: rechazan campos no previstos como `existencia`, `saldo` o el número completo de una tarjeta.
- **Formatos centralizados:** moneda, fechas, documentos y numeración se formatean solo en `src/lib/formatos.ts`.

## Requisitos previos

| Herramienta | Versión |
| --- | --- |
| [Node.js](https://nodejs.org/) | 20.12 o superior (se recomienda la LTS vigente; el proyecto se verificó con Node.js 24) |
| [pnpm](https://pnpm.io/) | 10 (el proyecto declara `pnpm@10.34.9` en `package.json`; puede habilitarse con `corepack enable`) |
| [Git](https://git-scm.com/) | Cualquier versión actual |

No se necesita instalar SQLite: la base local la crea el propio cliente libSQL.

## Instalación local

```bash
git clone https://github.com/Incrost/sistema-gestion-comercial.git
cd sistema-gestion-comercial
```

**Linux, macOS o Git Bash:**

```bash
pnpm install
cp .env.example .env
pnpm run db:migrate
pnpm run db:seed
pnpm run dev
```

**Windows (PowerShell):**

```powershell
pnpm install
Copy-Item .env.example .env
pnpm run db:migrate
pnpm run db:seed
pnpm run dev
```

Luego abrir <http://localhost:3000> e iniciar sesión con alguno de los [usuarios de prueba](#usuarios-de-prueba).

No hacen falta pasos manuales adicionales: `.env.example` trae valores válidos para desarrollo, `db:migrate` crea `local.db` con todas las tablas y `db:seed` carga los datos de prueba.

> Si `pnpm install` informa scripts de compilación ignorados (por ejemplo, de `esbuild`), no es necesario aprobarlos: el proyecto funciona igual.

## Variables de entorno

Se definen en `.env` (no versionado) a partir de `.env.example` (versionado, sin secretos). Ninguna lleva el prefijo `NEXT_PUBLIC_`, de modo que nunca llegan al navegador.

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | No en desarrollo; sí en producción | URL de la base. `file:local.db` (valor por defecto) para SQLite local; `libsql://<base>-<organizacion>.turso.io` para Turso. |
| `DATABASE_AUTH_TOKEN` | Solo con una URL remota | Token de acceso de Turso. Se deja vacío en desarrollo. |
| `SESSION_SECRET` | Sí | Secreto con el que se firma la cookie de sesión. Mínimo 32 caracteres. El valor de `.env.example` sirve solo para desarrollo y **se rechaza en producción**. |

Para generar un secreto aleatorio:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## SQLite local y Turso

La selección de la base se decide en un único lugar, `src/db/config.ts`, que usan tanto la aplicación (`src/db/index.ts`) como drizzle-kit (`drizzle.config.ts`):

| | SQLite local | Turso |
| --- | --- | --- |
| Uso | Desarrollo y pruebas | Producción (Vercel) |
| `DATABASE_URL` | `file:local.db` | `libsql://...turso.io` |
| `DATABASE_AUTH_TOKEN` | No se usa | Obligatorio |
| Archivo | `local.db` en la raíz (ignorado por Git) | Base remota administrada |

Salvaguardas: una URL remota sin token, o un protocolo desconocido, detiene el arranque con un mensaje claro; y en Vercel (`VERCEL_ENV` igual a `production` o `preview`) se rechaza una base `file:`, porque el disco de Vercel es efímero.

## Migraciones

- El esquema se define en `src/db/schema.ts` (tablas, restricciones `CHECK`, índices y claves foráneas `ON DELETE RESTRICT`).
- Las migraciones SQL generadas están en `drizzle/`.

Para agregar una tabla o un campo:

```bash
# 1. Modificar src/db/schema.ts
pnpm run db:generate   # genera la migración en drizzle/
pnpm run db:migrate    # la aplica sobre la base configurada en .env
```

`db:migrate` aplica las migraciones sobre la base que indique `DATABASE_URL`: la local por defecto o Turso si se configuran sus variables.

## Seed académico

`pnpm run db:seed` (archivo `scripts/seed.ts`) carga los datos de prueba **usando los mismos servicios que la aplicación** (`emitirFactura()`, `anularFactura()`, `registrarPago()`, `moverStock()`, etc.). Así el stock, los saldos y la numeración de los datos de prueba cumplen todas las reglas.

- **Idempotente:** puede ejecutarse varias veces sin duplicar datos ni consumir numeración.
- No modifica datos que no pertenezcan al conjunto académico.
- Las fechas de las ventas son relativas al día de ejecución, de modo que siempre caen dentro de los últimos 30 días y el tablero muestra información desde el primer arranque.
- No imprime contraseñas, hashes ni secretos.

## Comandos disponibles

| Comando | Descripción |
| --- | --- |
| `pnpm run dev` | Servidor de desarrollo en <http://localhost:3000> |
| `pnpm run build` | Compilación de producción |
| `pnpm run start` | Servidor de producción (requiere `build` previo) |
| `pnpm run lint` | Análisis estático con ESLint |
| `pnpm run db:generate` | Genera una migración a partir de `src/db/schema.ts` |
| `pnpm run db:migrate` | Aplica las migraciones pendientes |
| `pnpm run db:seed` | Carga los datos de prueba |
| `pnpm run test` | Pruebas en modo observación |
| `pnpm run test:run` | Ejecuta todas las pruebas una vez |
| `pnpm exec tsc --noEmit` | Verificación de tipos de TypeScript |

## Usuarios de prueba

Credenciales **académicas y ficticias** (dominio reservado `.test`), creadas por el seed. En la base solo se guarda el hash bcrypt.

| Rol | Nombre | Email | Contraseña |
| --- | --- | --- | --- |
| Administrador | Administrador de Prueba | `admin@comercio.test` | `Admin-Prueba-2026` |
| Vendedor | Vendedor de Prueba | `vendedor@comercio.test` | `Vendedor-Prueba-2026` |

El seed no cambia la contraseña de un usuario que ya existe. En la base publicada estas contraseñas deberían cambiarse después de la defensa.

## Roles y permisos

Los permisos se verifican en los **servicios**: ocultar un botón es solo una ayuda visual. Un vendedor que llama directamente a una ruta de administrador recibe `403 SIN_PERMISO`.

| Acción | Administrador | Vendedor |
| --- | :---: | :---: |
| Emitir facturas y consultarlas | Sí | Sí |
| Anular facturas | Sí | No |
| Consultar catálogo y existencias | Sí | Sí |
| Alta, edición y baja de productos y categorías | Sí | No |
| Ingresos y egresos manuales de stock | Sí | No |
| Alta y edición de clientes | Sí | Sí |
| Baja y reactivación de clientes | Sí | No |
| Registrar pagos en cuenta corriente | Sí | Sí |
| Ver el tablero de inicio | Sí | Sí |
| Gestionar usuarios | Sí | No |
| Cambiar la propia contraseña | Sí | Sí |

Al vendedor no se le muestran productos ni clientes inactivos.

## Estructura de carpetas

```text
├── consigna/                 Enunciado y requerimientos del parcial
├── drizzle/                  Migraciones SQL generadas por drizzle-kit
├── scripts/seed.ts           Carga de datos de prueba
├── src/
│   ├── app/
│   │   ├── (protegido)/      Páginas con sesión: layout con panel lateral y barra superior
│   │   │   ├── page.tsx      Inicio (tablero)
│   │   │   ├── ventas/       Nueva venta, facturas y detalle
│   │   │   ├── productos/    Catálogo, ficha y categorías
│   │   │   ├── clientes/     Listado, ficha, cuenta corriente, saldos y recibos
│   │   │   ├── usuarios/     Gestión de usuarios
│   │   │   └── perfil/       Cambio de contraseña
│   │   ├── login/            Única página pública
│   │   └── api/              API REST (Route Handlers)
│   ├── components/           Componentes de interfaz (ui de shadcn, layout, datos, estados, formularios, tablero)
│   ├── config/               Datos del comercio, identidad del sistema y motivos de stock
│   ├── db/                   Esquema, conexión, configuración, transacciones y semillas
│   ├── hooks/                Hook común de formularios
│   ├── lib/                  Validación (Zod), errores, sesión, formatos, fechas e importes
│   ├── servicios/            Reglas de negocio (un módulo por parte del dominio)
│   ├── test/                 Utilidades de prueba (base temporal, ayudantes de API)
│   └── proxy.ts              Primera barrera de sesión
├── .env.example              Plantilla de variables de entorno
└── drizzle.config.ts         Configuración de drizzle-kit
```

## API REST

Convenciones: JSON en camelCase; importes **siempre en centavos enteros** (`1250000` = $ 12.500,00); fechas en ISO 8601 UTC; filtros `desde`/`hasta` con formato `AAAA-MM-DD` interpretados en hora de Argentina; listados paginados con `page` y `pageSize` (20 por defecto, máximo 100) que responden `{ data, page, pageSize, total }`. Toda ruta exige sesión salvo el login. **No existe `DELETE`:** las bajas son lógicas mediante `PATCH` con `"activo": false`.

Formato uniforme de error:

```json
{ "error": { "code": "VALIDACION", "message": "Hay campos con errores.", "details": [{ "campo": "codigo", "mensaje": "Es obligatorio." }] } }
```

### Resumen de las 31 rutas

| # | Método | Ruta | Rol | Finalidad |
| --- | --- | --- | --- | --- |
| 1 | POST | `/api/auth/login` | Público | Iniciar sesión (RF-U1) |
| 2 | POST | `/api/auth/logout` | Ambos | Cerrar sesión (RF-U1) |
| 3 | GET | `/api/auth/me` | Ambos | Usuario conectado (RF-U2) |
| 4 | PUT | `/api/auth/password` | Ambos | Cambiar la propia contraseña (RF-U5) |
| 5 | GET | `/api/usuarios` | Admin | Listar usuarios (RF-U4) |
| 6 | POST | `/api/usuarios` | Admin | Crear usuario (RF-U4) |
| 7 | PATCH | `/api/usuarios/{id}` | Admin | Editar, desactivar o cambiar rol (RF-U4) |
| 8 | POST | `/api/usuarios/{id}/reset-password` | Admin | Restablecer contraseña (RF-U5) |
| 9 | GET | `/api/categorias` | Ambos | Listar categorías activas (RF-P7) |
| 10 | POST | `/api/categorias` | Admin | Crear categoría (RF-P7) |
| 11 | PATCH | `/api/categorias/{id}` | Admin | Editar o desactivar categoría (RF-P7) |
| 12 | GET | `/api/productos` | Ambos | Catálogo con búsqueda y filtros (RF-P1) |
| 13 | GET | `/api/productos/{id}` | Ambos | Consultar un producto (RF-P1) |
| 14 | POST | `/api/productos` | Admin | Crear producto con stock inicial opcional (RF-P2) |
| 15 | PATCH | `/api/productos/{id}` | Admin | Editar o dar de baja un producto (RF-P2, RF-P3) |
| 16 | GET | `/api/productos/{id}/movimientos` | Ambos | Historial de stock del producto (RF-P6) |
| 17 | POST | `/api/productos/{id}/movimientos` | Admin | Ingreso o egreso manual de stock (RF-P4, RF-P5) |
| 18 | GET | `/api/movimientos-stock` | Ambos | Movimientos de todos los productos (RF-P6) |
| 19 | GET | `/api/clientes` | Ambos | Listado con saldo y deudores (RF-C1, RF-C6) |
| 20 | GET | `/api/clientes/{id}` | Ambos | Ficha con últimas facturas (RF-C3) |
| 21 | POST | `/api/clientes` | Ambos | Alta de cliente, también desde Nueva venta (RF-C2, RF-V2) |
| 22 | PATCH | `/api/clientes/{id}` | Ambos (baja: admin) | Editar o dar de baja un cliente (RF-C2, RF-C7) |
| 23 | GET | `/api/clientes/{id}/cuenta` | Ambos | Cuenta corriente con saldo acumulado (RF-C4) |
| 24 | POST | `/api/clientes/{id}/pagos` | Ambos | Registrar pago y emitir recibo (RF-C5) |
| 25 | GET | `/api/pagos/{id}` | Ambos | Consultar un recibo (RF-C5) |
| 26 | GET | `/api/facturas` | Ambos | Listado de facturas con filtros (RF-V8) |
| 27 | GET | `/api/facturas/{id}` | Ambos | Factura completa para el comprobante (RF-V7) |
| 28 | GET | `/api/facturas/proximo-numero` | Ambos | Próximo número, solo informativo (RF-V1) |
| 29 | POST | `/api/facturas` | Ambos | Emitir factura (RF-V1 a RF-V6) |
| 30 | POST | `/api/facturas/{id}/anulacion` | Admin | Anular factura con motivo (RF-V9) |
| 31 | GET | `/api/tablero` | Ambos | Indicadores y gráficos del inicio (RF-T1 a RF-T3) |

### Códigos de error

| HTTP | Códigos |
| --- | --- |
| 400 | `JSON_INVALIDO` |
| 401 | `NO_AUTENTICADO`, `CREDENCIALES_INVALIDAS` |
| 403 | `SIN_PERMISO` |
| 404 | `NO_ENCONTRADO` |
| 409 | `CODIGO_DUPLICADO`, `DOCUMENTO_DUPLICADO`, `EMAIL_DUPLICADO`, `NOMBRE_DUPLICADO`, `CATEGORIA_EN_USO`, `STOCK_INSUFICIENTE`, `FACTURA_ANULADA` |
| 422 | `VALIDACION`, `PRODUCTO_INACTIVO`, `CUENTA_CORRIENTE_NO_HABILITADA`, `LIMITE_CREDITO_EXCEDIDO`, `MONTO_INSUFICIENTE`, `PAGO_SUPERA_DEUDA`, `SALDO_PENDIENTE`, `CONTRASENA_ACTUAL_INCORRECTA`, `OPERACION_SOBRE_SI_MISMO` |
| 500 | `ERROR_INTERNO` (el detalle solo se registra en el servidor) |

Los servicios validan primero el cuerpo y luego el rol: un pedido mal formado responde `422` y un pedido válido sin permiso, `403`.

## Reglas de negocio críticas

| Regla | Dónde vive |
| --- | --- |
| 1. La existencia nunca es negativa; ante dos ventas simultáneas de la última unidad, solo una se confirma | `moverStock()` en `src/servicios/stock.ts` (`UPDATE ... WHERE existencia >= ?`), transacciones encoladas en `src/db/transaccion.ts` y `CHECK` en la base |
| 2. Todo cambio de stock deja un movimiento en la misma transacción | `moverStock()` |
| 3. El precio se congela en la factura | `grabarFactura()` en `src/servicios/facturas.ts` |
| 4. Numeración correlativa y sin huecos (`0001-00000001`); recibos con numeración propia | `asignarNumero()` en `src/servicios/numeracion.ts` |
| 5. Una factura confirmada no se modifica; solo se anula | `anularFactura()`; no existen rutas de edición ni borrado |
| 6. Consumidor final no compra en cuenta corriente | `exigirCuentaCorriente()` en `src/servicios/facturas.ts` y `CHECK` en la base |
| 7. Saldo = débitos − créditos; límite de crédito | `src/servicios/cuenta-corriente.ts` y `resolverPago()` en `src/servicios/facturas.ts` |
| 8. Un pago no supera la deuda | `verificarPagoAdmisible()` en `src/servicios/pagos.ts` y `registrarMovimientoCuenta()` |
| 9. De la tarjeta solo se guardan tipo, marca y últimos 4 dígitos | `src/lib/validacion-facturas.ts` rechaza número completo, CVV y vencimiento; el esquema no tiene columnas para ellos |
| 10. Importes exactos en centavos enteros | Esquema, `src/lib/importes.ts` y `src/lib/formatos.ts` |
| 11. Trazabilidad con usuario y fecha y hora | Facturas, movimientos de stock y pagos; reloj único en `src/servicios/reloj.ts` |
| 12. Bajas lógicas | Columnas `activo`/`activa`; claves foráneas `ON DELETE RESTRICT` |

Confirmar una factura modifica, en una sola transacción: `secuencias`, `facturas`, `factura_items`, `productos`, `movimientos_stock` y, si es en cuenta corriente, `movimientos_cuenta`.

## Datos de prueba incluidos

| Dato | Cantidad |
| --- | --- |
| Usuarios | 2 (uno por rol) |
| Categorías | 6 (Herramientas, Electricidad, Plomería, Pinturería, Bulonería y Jardín) |
| Productos | 30, uno inactivo (`JA-005`) y varios bajo el stock mínimo |
| Clientes | 12 ficticios, uno dado de baja, con y sin cuenta corriente y límite de crédito |
| Facturas | 50 repartidas en los últimos 30 días, con las tres formas de pago, incluidas ventas del día |
| Anulaciones | 6 |
| Pagos de cuenta corriente | 6, con su recibo |

Todos los nombres, documentos, domicilios y emails son ficticios.

## Pruebas

```bash
pnpm run test:run        # 1025 pruebas en 51 archivos
pnpm run lint
pnpm exec tsc --noEmit
pnpm run build
```

Las pruebas usan una base SQLite temporal y no tocan `local.db`. Cubren, entre otros: las 31 rutas (sesión, permisos y códigos de error), transacciones que fallan a mitad de camino sin dejar datos parciales, ventas simultáneas de la última unidad, coincidencia de existencias con la suma de movimientos y de saldos con débitos menos créditos, numeración sin huecos, rechazo de datos completos de tarjeta, la idempotencia del seed y la estructura de la interfaz.

## Publicación

### Repositorio

- **URL:** https://github.com/Incrost/sistema-gestion-comercial

### Aplicación en Vercel

- **URL pública:** _pendiente de publicación_.
- Variables de entorno a cargar en el proyecto de Vercel: `DATABASE_URL`, `DATABASE_AUTH_TOKEN` y `SESSION_SECRET` (un valor aleatorio propio, distinto del de `.env.example`).

### Base de datos en Turso

- **Base:** _pendiente de creación_.
- Pasos previstos:
  1. Crear la base y un token con la CLI de Turso (`turso db create`, `turso db show --url`, `turso db tokens create`).
  2. En una terminal, definir `DATABASE_URL` y `DATABASE_AUTH_TOKEN` con los valores de Turso.
  3. Ejecutar `pnpm run db:migrate` para crear las tablas y `pnpm run db:seed` para cargar los datos de prueba.
- Para comprobar que el sitio publicado usa Turso: el servidor rechaza en Vercel una base `file:`, y los datos creados desde la URL pública se ven en la base de Turso (`turso db shell`).

## Integrantes

| Nombre y apellido | Legajo |
| --- | --- |
| Carrizo Silva, Yaqueline Ailen | 63326 |
| Cedrón, Agustina Julieta | 63324 |

El grupo está integrado por dos estudiantes con autorización expresa del profesor.

### Datos del comercio

Facturas y recibos muestran los datos definidos en `src/config/comercio.ts`:

| Dato | Valor |
| --- | --- |
| Nombre comercial | Nexo Comercial |
| Razón social | Nexo Comercial S.R.L. |
| CUIT | 30-71654321-4 |
| Domicilio | Av. Central 1234, San Miguel de Tucumán |
| Punto de venta | 0001 |
| Zona horaria | America/Argentina/Buenos_Aires |
| Locale | es-AR |
| Moneda | ARS |

El CUIT y el domicilio son datos académicos ficticios.

## Uso de inteligencia artificial

El desarrollo se realizó con la asistencia de **Claude Code** como agente de programación, conforme lo permite la consigna. El agente se utilizó para proponer y redactar código, pruebas y documentación a partir de decisiones de diseño tomadas por el grupo.

Todo el código fue revisado, probado y organizado por los integrantes en commits por etapa a lo largo del desarrollo. La autoría y la responsabilidad del trabajo corresponden al grupo: cada integrante está en condiciones de explicar y modificar cualquier parte del sistema.

## Decisiones técnicas documentadas

- **Importes en centavos.** Todos los importes son enteros en centavos, en la base, en los servicios y en la API; los cálculos de subtotales y totales usan `BigInt` para detectar desbordes. Solo la interfaz los convierte a pesos con formato argentino (`src/lib/formatos.ts`).
- **Existencia almacenada y modificada solo mediante `moverStock()`.** La existencia es una columna de `productos`, pero ningún servicio la escribe por su cuenta: ventas, anulaciones, ingresos, egresos y stock inicial pasan por `moverStock()`, que actualiza con una condición y graba el movimiento en la misma transacción. `existencia` no se acepta en `POST` ni en `PATCH`.
- **Saldo derivado de movimientos.** El saldo del cliente no se guarda: se calcula siempre como débitos menos créditos de `movimientos_cuenta`, con una única expresión reutilizada en listados, ficha, pagos, límites y tablero. Los únicos puntos de escritura son `registrarDebito()` y `registrarCredito()`.
- **Numeración mediante secuencias.** La tabla `secuencias` guarda el último número de cada talonario (facturas y recibos). El incremento es una sola sentencia atómica dentro de la transacción del comprobante: si la operación falla, el número no se consume. Un índice único `(punto_venta, numero)` es la última barrera.
- **Datos congelados en facturas.** La factura copia el nombre, documento y domicilio del comprador, y cada renglón copia código, descripción y precio del catálogo. Cambios posteriores en el cliente o en el producto no alteran comprobantes emitidos.
- **Tratamiento temporal de la decisión C1.** La consigna pide registrar un crédito por el total al anular una factura en cuenta corriente (RF-V9), pero la regla 8 prohíbe los saldos a favor. Mientras se aguarda la aclaración del profesor, si el cliente ya pagó parte de esa deuda la anulación se rechaza con `422 VALIDACION` y no se modifica nada. La regla está aislada en `exigirAnulacionSinSaldoAFavor()` (`src/servicios/facturas.ts`), de modo que el criterio puede cambiarse en un solo lugar.
- **Sesión propia con cookie firmada.** La cookie `sesion` contiene solo el id del usuario y su vencimiento (8 horas), firmados con HS256 y `SESSION_SECRET`. Es `httpOnly`, `SameSite=Lax` y `Secure` en producción. El usuario se vuelve a leer de la base en cada pedido, por lo que la desactivación o el cambio de rol tienen efecto inmediato.
- **Otras decisiones.** Medio de pago de cuenta corriente `tarjeta_debito`; un producto está bajo mínimo cuando `existencia < stockMinimo`; el recibo conserva el saldo resultante al momento del pago; las mutaciones de la interfaz consumen la API REST (no se usan Server Actions), y las páginas de lectura llaman directamente a los mismos servicios; los datos del comercio y el punto de venta se configuran en `src/config/comercio.ts`.

## Estado del proyecto

- Funcionalidad completa según los requerimientos RF-V, RF-P, RF-C, RF-U y RF-T, con las 31 rutas REST.
- Pruebas, análisis estático, verificación de tipos y compilación de producción sin errores.
- Datos definitivos del comercio, integrantes y repositorio incorporados.
- Pendiente: publicación en Vercel y Turso, y aclaración de la decisión C1.

## Licencia y uso académico

Trabajo práctico desarrollado exclusivamente con fines académicos para la materia Programación IV. No está destinado a uso comercial ni a la emisión de comprobantes con validez fiscal. Todos los datos de prueba son ficticios.
