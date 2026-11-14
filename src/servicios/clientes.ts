/**
 * Servicio de clientes (RF-C1, RF-C2, RF-C3, RF-C6, RF-C7; sección 11.5).
 *
 * No conoce HTTP ni cookies: lo usan los Route Handlers de /api/clientes, las
 * páginas de /clientes y el script de datos iniciales.
 *
 * Orden de cada función (sección 10.2): validar → verificar el rol → aplicar
 * las reglas → acceder a la base → devolver la forma pública.
 *
 * El saldo NUNCA se guarda ni se acepta: se calcula con saldoDelCliente /
 * obtenerSaldo() de ./cuenta-corriente.ts (débitos − créditos). Este servicio
 * no escribe movimientos de cuenta.
 *
 * Permisos (sección 3: «Alta y edición de clientes: ambos roles»):
 * - ambos roles listan, consultan, dan de alta y editan los datos ordinarios;
 * - la BAJA y la REACTIVACIÓN (`activo`) quedan reservadas al administrador:
 *   la matriz no se la da expresamente al vendedor, y es la interpretación
 *   más segura (igual que en productos, donde la baja es de administración);
 * - al vendedor nunca se le exponen clientes inactivos: no aparecen en sus
 *   listados (pedir `activo=false|todos` → 403) y su ficha responde 404.
 *
 * Bajas lógicas (regla 12): `activo: false`; el registro y su historial se
 * conservan. No existe borrado.
 */
import "server-only";

import { and, asc, count, desc, eq, gt, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  clientes,
  facturas,
  type EstadoFactura,
  type FormaPago,
  type TipoDocumento,
} from "@/db/schema";
import { enTransaccion, type Conexion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { COLUMNAS_DOCUMENTO_CLIENTE, traducirUnicidad } from "@/lib/errores-base";
import { formatearNumeroFactura } from "@/lib/formatos";
import { normalizarDocumento } from "@/lib/normalizacion";
import { desplazamiento, type ListaPaginada } from "@/lib/paginacion";
import { esquemaParametrosId } from "@/lib/validacion";
import {
  esquemaAltaCliente,
  esquemaConsultaClientes,
  esquemaEdicionCliente,
  resolverDocumento,
} from "@/lib/validacion-clientes";

import type { UsuarioAutenticado } from "./auth";
import { calcularDisponible, obtenerSaldo, saldoDelCliente } from "./cuenta-corriente";
import { exigirRol, tieneRol } from "./permisos";

// ---------------------------------------------------------------------------
// Representación pública (sección 11.5)
// ---------------------------------------------------------------------------

export type ClientePublico = {
  id: number;
  tipoDoc: TipoDocumento;
  nroDoc: string;
  nombre: string;
  domicilio: string | null;
  telefono: string | null;
  email: string | null;
  cuentaCorriente: boolean;
  limiteCredito: number | null; // centavos; null = sin límite
  saldo: number; // centavos, calculado (débitos − créditos)
  disponible: number | null; // límite − saldo; null = sin límite
  activo: boolean;
};

/** Resumen de una factura para la ficha del cliente (RF-C3). */
export type FacturaResumen = {
  id: number;
  numero: string; // "0001-00000001"
  fecha: string; // ISO 8601 UTC
  total: number; // centavos
  formaPago: FormaPago;
  estado: EstadoFactura;
};

export type FichaCliente = ClientePublico & { ultimasFacturas: FacturaResumen[] };

/** Listado de clientes; con `conDeuda=true` agrega el total adeudado (RF-C6). */
export type ListaClientes = ListaPaginada<ClientePublico> & { totalAdeudado?: number };

/** Cantidad de facturas que muestra la ficha (sección 11.5). */
export const CANTIDAD_ULTIMAS_FACTURAS = 6;

const columnasCliente = {
  id: clientes.id,
  tipoDoc: clientes.tipoDoc,
  nroDoc: clientes.nroDoc,
  nombre: clientes.nombre,
  domicilio: clientes.domicilio,
  telefono: clientes.telefono,
  email: clientes.email,
  cuentaCorriente: clientes.cuentaCorriente,
  limiteCredito: clientes.limiteCredito,
  activo: clientes.activo,
  saldo: saldoDelCliente,
};

type FilaCliente = Omit<ClientePublico, "disponible">;

/** Única conversión de una fila al cliente público (lista blanca de campos). */
export function aClientePublico(fila: FilaCliente): ClientePublico {
  return {
    id: fila.id,
    tipoDoc: fila.tipoDoc,
    nroDoc: fila.nroDoc,
    nombre: fila.nombre,
    domicilio: fila.domicilio,
    telefono: fila.telefono,
    email: fila.email,
    cuentaCorriente: fila.cuentaCorriente,
    limiteCredito: fila.limiteCredito,
    saldo: fila.saldo,
    disponible: calcularDisponible(fila.limiteCredito, fila.saldo),
    activo: fila.activo,
  };
}

async function buscarCliente(conexion: Conexion, id: number): Promise<ClientePublico | null> {
  const [fila] = await conexion
    .select(columnasCliente)
    .from(clientes)
    .where(eq(clientes.id, id))
    .limit(1);
  return fila ? aClientePublico(fila) : null;
}

// ---------------------------------------------------------------------------
// Ayudantes internos
// ---------------------------------------------------------------------------

/** Escapa los comodines de LIKE para buscar el texto literal. */
function patronContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Índice único del documento → 409 DOCUMENTO_DUPLICADO. Otro error sigue como 500. */
function traducirDuplicado(error: unknown): never {
  traducirUnicidad(error, {
    [COLUMNAS_DOCUMENTO_CLIENTE]: { code: "DOCUMENTO_DUPLICADO", campo: "nroDoc" },
  });
}

/**
 * Documento libre para ese tipo (opcionalmente, salvo el propio cliente).
 * Da un 409 claro antes de escribir; el índice único sigue siendo la
 * garantía final ante pedidos simultáneos (traducirDuplicado).
 */
async function exigirDocumentoLibre(
  conexion: Conexion,
  tipoDoc: TipoDocumento,
  nroDocNormalizado: string,
  excluirId?: number,
) {
  const [existente] = await conexion
    .select({ id: clientes.id })
    .from(clientes)
    .where(and(eq(clientes.tipoDoc, tipoDoc), eq(clientes.nroDocNormalizado, nroDocNormalizado)))
    .limit(1);
  if (existente && existente.id !== excluirId) {
    throw ApiError.desdeCodigo("DOCUMENTO_DUPLICADO", undefined, [
      { campo: "nroDoc", mensaje: "Ya existe un cliente con ese documento." },
    ]);
  }
}

function errorCampo(campo: string, mensaje: string): ApiError {
  return ApiError.desdeCodigo("VALIDACION", undefined, [{ campo, mensaje }]);
}

const noEncontrado = () => ApiError.desdeCodigo("NO_ENCONTRADO", "El cliente no existe.");

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * RF-C1 (listado y búsqueda) y RF-C6 (saldos). Ambos roles.
 * - `q`: nombre (sin distinguir mayúsculas) o número de documento, sin
 *   importar puntos, espacios ni guiones. Limitación conocida: `lower()` de
 *   SQLite solo convierte letras ASCII, así que «Ú» y «ú» se consideran
 *   distintas (las vocales sin tilde y la «ñ» minúscula funcionan normal).
 * - `conDeuda=true`: solo saldo > 0 y agrega `totalAdeudado` (suma de los
 *   saldos de TODOS los clientes filtrados, no solo de la página).
 * - `orden`: `nombre` (A→Z) o `saldo` (de mayor a menor).
 * - `activo`: `true` por defecto; `false` y `todos` solo para el administrador.
 */
export async function listarClientes(
  usuario: UsuarioAutenticado,
  consulta: unknown,
): Promise<ListaClientes> {
  // 1. Validar.
  const { q, conDeuda, orden, activo, page, pageSize } = esquemaConsultaClientes.parse(consulta);
  // 2. Permiso: al vendedor nunca se le listan clientes inactivos.
  exigirRol(usuario, "admin", "vendedor");
  if (activo !== "true") exigirRol(usuario, "admin");

  // 3. Reglas: armar el filtro.
  const condiciones: SQL[] = [];
  if (q) {
    const porNombre = sql`lower(${clientes.nombre}) like ${patronContiene(q.toLowerCase())} escape '\\'`;
    const digitos = normalizarDocumento(q);
    condiciones.push(
      /^\d+$/.test(digitos)
        ? or(porNombre, sql`${clientes.nroDocNormalizado} like ${patronContiene(digitos)} escape '\\'`)!
        : porNombre,
    );
  }
  if (activo !== "todos") condiciones.push(eq(clientes.activo, activo === "true"));
  // RF-C6: la misma expresión de saldo que se muestra (regla 7).
  if (conDeuda) condiciones.push(gt(saldoDelCliente, 0));
  const filtro = condiciones.length > 0 ? and(...condiciones) : undefined;

  const ordenSql =
    orden === "saldo"
      ? [desc(saldoDelCliente), asc(clientes.nombre), asc(clientes.id)]
      : [asc(clientes.nombre), asc(clientes.id)];

  // 4. Base: página y totales con el mismo filtro.
  const [filas, [totales]] = await Promise.all([
    db
      .select(columnasCliente)
      .from(clientes)
      .where(filtro)
      .orderBy(...ordenSql)
      .limit(pageSize)
      .offset(desplazamiento({ page, pageSize })),
    db
      .select({
        total: count(),
        totalAdeudado: sql<number>`coalesce(sum(${saldoDelCliente}), 0)`.mapWith(Number),
      })
      .from(clientes)
      .where(filtro),
  ]);

  // 5. Forma pública.
  const lista: ListaClientes = { data: filas.map(aClientePublico), page, pageSize, total: totales.total };
  if (conDeuda) lista.totalAdeudado = totales.totalAdeudado;
  return lista;
}

/**
 * RF-C3: ficha del cliente con saldo, disponible y sus últimas facturas
 * (como máximo 6, de la más reciente a la más vieja). Ambos roles.
 * Inexistente → 404; al vendedor, un cliente inactivo también → 404.
 */
export async function obtenerCliente(
  usuario: UsuarioAutenticado,
  parametros: unknown,
): Promise<FichaCliente> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");

  // 3-4. Reglas y base.
  const cliente = await buscarCliente(db, id);
  if (!cliente || (!cliente.activo && !tieneRol(usuario, "admin"))) throw noEncontrado();

  const facturasCliente = await db
    .select({
      id: facturas.id,
      puntoVenta: facturas.puntoVenta,
      numero: facturas.numero,
      fecha: facturas.fecha,
      total: facturas.total,
      formaPago: facturas.formaPago,
      estado: facturas.estado,
    })
    .from(facturas)
    .where(eq(facturas.clienteId, id))
    .orderBy(desc(facturas.fecha), desc(facturas.id))
    .limit(CANTIDAD_ULTIMAS_FACTURAS);

  // 5. Forma pública.
  return {
    ...cliente,
    ultimasFacturas: facturasCliente.map((f) => ({
      id: f.id,
      numero: formatearNumeroFactura(f.puntoVenta, f.numero),
      fecha: f.fecha.toISOString(),
      total: f.total,
      formaPago: f.formaPago,
      estado: f.estado,
    })),
  };
}

/**
 * RF-C2: alta de cliente (ambos roles; también la usa el alta rápida de
 * Nueva venta). Nace siempre activo y con saldo 0 (sin movimientos). Guarda
 * el número visible con formato y el normalizado (solo dígitos).
 * Documento repetido para el mismo tipo → 409 DOCUMENTO_DUPLICADO.
 */
export async function crearCliente(
  usuario: UsuarioAutenticado,
  datos: unknown,
): Promise<ClientePublico> {
  // 1. Validar (rechaza saldo, disponible, activo, nroDocNormalizado y extras).
  const entrada = esquemaAltaCliente.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");

  // 3. Reglas: documento resuelto por el servidor; límite solo con cuenta corriente.
  const resultado = resolverDocumento(entrada.tipoDoc, entrada.nroDoc);
  if (!resultado.ok) throw errorCampo("nroDoc", resultado.mensaje);
  const { tipoDoc, nroDoc, nroDocNormalizado } = resultado.documento;
  await exigirDocumentoLibre(db, tipoDoc, nroDocNormalizado);

  // 4. Base: lista blanca de columnas (nunca un saldo).
  const [{ id }] = await db
    .insert(clientes)
    .values({
      tipoDoc,
      nroDoc,
      nroDocNormalizado,
      nombre: entrada.nombre,
      domicilio: entrada.domicilio ?? null,
      telefono: entrada.telefono ?? null,
      email: entrada.email ?? null,
      cuentaCorriente: entrada.cuentaCorriente,
      limiteCredito: entrada.cuentaCorriente ? (entrada.limiteCredito ?? null) : null,
      activo: true,
    })
    .returning({ id: clientes.id })
    .catch(traducirDuplicado);

  // 5. Forma pública.
  return (await buscarCliente(db, id))!;
}

/**
 * RF-C2 (edición parcial) y RF-C7 (baja y reactivación lógicas).
 * - Ambos roles editan los datos ordinarios; `activo` solo el administrador
 *   (403 SIN_PERMISO al vendedor).
 * - Al vendedor, un cliente inactivo → 404 (no se le expone).
 * - Con saldo distinto de cero no se puede desactivar ni quitar la cuenta
 *   corriente → 422 SALDO_PENDIENTE (el saldo sale de obtenerSaldo()).
 * - Al quitar la cuenta corriente sin indicar límite, el límite pasa a null;
 *   un límite sin cuenta corriente → 422 VALIDACION.
 * - Los campos no enviados no cambian. Inexistente → 404; documento de otro
 *   cliente → 409 DOCUMENTO_DUPLICADO.
 */
export async function actualizarCliente(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<ClientePublico> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  const cambios = esquemaEdicionCliente.parse(datos);
  // 2. Permiso: la baja y la reactivación son de administración.
  exigirRol(usuario, "admin", "vendedor");
  if (cambios.activo !== undefined) exigirRol(usuario, "admin");

  return enTransaccion(async (tx) => {
    const [actual] = await tx
      .select({
        tipoDoc: clientes.tipoDoc,
        nroDoc: clientes.nroDoc,
        cuentaCorriente: clientes.cuentaCorriente,
        limiteCredito: clientes.limiteCredito,
        activo: clientes.activo,
      })
      .from(clientes)
      .where(eq(clientes.id, id))
      .limit(1);
    if (!actual || (!actual.activo && !tieneRol(usuario, "admin"))) throw noEncontrado();

    // 3. Reglas.
    // Documento: si cambia el tipo o el número, se resuelve el par completo.
    let documento: { tipoDoc: TipoDocumento; nroDoc: string; nroDocNormalizado: string } | undefined;
    if (cambios.tipoDoc !== undefined || cambios.nroDoc !== undefined) {
      const resultado = resolverDocumento(
        cambios.tipoDoc ?? actual.tipoDoc,
        cambios.nroDoc ?? actual.nroDoc,
      );
      if (!resultado.ok) throw errorCampo("nroDoc", resultado.mensaje);
      documento = resultado.documento;
      await exigirDocumentoLibre(tx, documento.tipoDoc, documento.nroDocNormalizado, id);
    }

    // Cuenta corriente y límite de crédito.
    const quedaConCuenta = cambios.cuentaCorriente ?? actual.cuentaCorriente;
    let limiteCredito = cambios.limiteCredito;
    if (!quedaConCuenta) {
      if (limiteCredito != null) {
        throw errorCampo(
          "limiteCredito",
          "Solo puede indicarse un límite de crédito si el cliente tiene cuenta corriente.",
        );
      }
      if (actual.limiteCredito !== null) limiteCredito = null;
    }

    // RF-C7 y sección 11.5: con saldo pendiente no se da de baja ni se quita la cuenta.
    const seDesactiva = cambios.activo === false && actual.activo;
    const pierdeCuenta = cambios.cuentaCorriente === false && actual.cuentaCorriente;
    if (seDesactiva || pierdeCuenta) {
      const saldo = await obtenerSaldo(tx, id);
      if (saldo !== 0) {
        throw ApiError.desdeCodigo(
          "SALDO_PENDIENTE",
          seDesactiva
            ? "El cliente tiene saldo pendiente en su cuenta corriente y no puede darse de baja."
            : "El cliente tiene saldo pendiente: no se le puede quitar la cuenta corriente.",
          { saldo },
        );
      }
    }

    // 4. Base: lista blanca de columnas editables (nunca un saldo).
    await tx
      .update(clientes)
      .set({
        ...documento,
        nombre: cambios.nombre,
        domicilio: cambios.domicilio,
        telefono: cambios.telefono,
        email: cambios.email,
        cuentaCorriente: cambios.cuentaCorriente,
        limiteCredito,
        activo: cambios.activo,
      })
      .where(eq(clientes.id, id))
      .catch(traducirDuplicado);

    // 5. Forma pública.
    return (await buscarCliente(tx, id))!;
  });
}

/**
 * Preparación para Nueva venta y pagos (regla 6, sección 11.6, paso 2): un
 * cliente inexistente o dado de baja no puede usarse en una operación nueva.
 * Recibe la conexión para poder ejecutarse dentro de la transacción de la venta.
 * Inexistente → 404; inactivo → 422 VALIDACION sobre `clienteId`.
 */
export async function exigirClienteActivo(conexion: Conexion, clienteId: number): Promise<ClientePublico> {
  const cliente = await buscarCliente(conexion, clienteId);
  if (!cliente) throw noEncontrado();
  if (!cliente.activo) throw errorCampo("clienteId", "El cliente está dado de baja.");
  return cliente;
}
