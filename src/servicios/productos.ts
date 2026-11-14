/**
 * Servicio de productos (RF-P1, RF-P2, RF-P3; sección 11.4).
 *
 * No conoce HTTP: lo usan los Route Handlers de /api/productos, las páginas
 * de /productos y el script de datos iniciales.
 *
 * Orden de cada función (sección 10.2): validar → verificar el rol → aplicar
 * las reglas → acceder a la base → devolver la forma pública.
 *
 * Este servicio NUNCA escribe `productos.existencia`: el producto nace con
 * existencia 0 y el stock inicial se registra con moverStock() (regla 2).
 * Bajas lógicas (regla 12): `activo: false`; el historial se conserva.
 */
import "server-only";

import { and, asc, count, eq, lt, ne, or, sql, type SQL } from "drizzle-orm";

import { MOTIVO_STOCK_INICIAL } from "@/config/motivos-stock";
import { db } from "@/db";
import { categorias, productos } from "@/db/schema";
import { enTransaccion, type Conexion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { traducirUnicidad } from "@/lib/errores-base";
import { desplazamiento, type ListaPaginada } from "@/lib/paginacion";
import { esquemaParametrosId } from "@/lib/validacion";
import {
  esquemaAltaProducto,
  esquemaConsultaProductos,
  esquemaEdicionProducto,
} from "@/lib/validacion-productos";

import type { UsuarioAutenticado } from "./auth";
import { exigirRol, tieneRol } from "./permisos";
import { moverStock } from "./stock";

// ---------------------------------------------------------------------------
// Representación pública (sección 11.4)
// ---------------------------------------------------------------------------

export type ProductoPublico = {
  id: number;
  codigo: string;
  descripcion: string;
  categoria: { id: number; nombre: string };
  precio: number; // centavos
  existencia: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  activo: boolean;
};

/**
 * Decisión D2: un producto está bajo el mínimo solo si existencia < stockMinimo
 * (con existencia igual al mínimo NO lo está). El filtro SQL `bajoMinimo`
 * usa la misma comparación (ver listarProductos).
 */
export function estaBajoMinimo(existencia: number, stockMinimo: number): boolean {
  return existencia < stockMinimo;
}

const columnasProducto = {
  id: productos.id,
  codigo: productos.codigo,
  descripcion: productos.descripcion,
  categoriaId: categorias.id,
  categoriaNombre: categorias.nombre,
  precio: productos.precio,
  existencia: productos.existencia,
  stockMinimo: productos.stockMinimo,
  activo: productos.activo,
};

type FilaProducto = {
  id: number;
  codigo: string;
  descripcion: string;
  categoriaId: number;
  categoriaNombre: string;
  precio: number;
  existencia: number;
  stockMinimo: number;
  activo: boolean;
};

/** Única conversión de una fila al producto público (lista blanca de campos). */
export function aProductoPublico(fila: FilaProducto): ProductoPublico {
  return {
    id: fila.id,
    codigo: fila.codigo,
    descripcion: fila.descripcion,
    categoria: { id: fila.categoriaId, nombre: fila.categoriaNombre },
    precio: fila.precio,
    existencia: fila.existencia,
    stockMinimo: fila.stockMinimo,
    bajoMinimo: estaBajoMinimo(fila.existencia, fila.stockMinimo),
    activo: fila.activo,
  };
}

function seleccionarProductos(conexion: Conexion) {
  return conexion
    .select(columnasProducto)
    .from(productos)
    .innerJoin(categorias, eq(productos.categoriaId, categorias.id));
}

async function buscarProducto(conexion: Conexion, id: number): Promise<ProductoPublico | null> {
  const [fila] = await seleccionarProductos(conexion).where(eq(productos.id, id)).limit(1);
  return fila ? aProductoPublico(fila) : null;
}

// ---------------------------------------------------------------------------
// Ayudantes internos
// ---------------------------------------------------------------------------

/** Escapa los comodines de LIKE para buscar el texto literal. */
function patronContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Índice único del código → 409 CODIGO_DUPLICADO. Otro error sigue como 500. */
function traducirDuplicado(error: unknown): never {
  traducirUnicidad(error, {
    "productos.codigo": { code: "CODIGO_DUPLICADO", campo: "codigo" },
  });
}

/**
 * Código único sin distinguir mayúsculas («HE-001» = «he-001»). El índice
 * único de la base sigue siendo la garantía final.
 */
async function exigirCodigoLibre(conexion: Conexion, codigo: string, excluirId?: number) {
  const condiciones: SQL[] = [sql`lower(${productos.codigo}) = lower(${codigo})`];
  if (excluirId !== undefined) condiciones.push(ne(productos.id, excluirId));
  const [existente] = await conexion
    .select({ id: productos.id })
    .from(productos)
    .where(and(...condiciones))
    .limit(1);
  if (existente) {
    throw ApiError.desdeCodigo("CODIGO_DUPLICADO", undefined, [
      { campo: "codigo", mensaje: "Ya existe un producto con ese código." },
    ]);
  }
}

/**
 * La categoría debe existir y, si el producto queda activo, estar activa.
 * Si no, 422 VALIDACION sobre el campo `categoriaId` (el pedido está bien
 * formado pero el dato no sirve).
 */
async function exigirCategoria(conexion: Conexion, categoriaId: number, debeEstarActiva: boolean) {
  const [categoria] = await conexion
    .select({ activa: categorias.activa })
    .from(categorias)
    .where(eq(categorias.id, categoriaId))
    .limit(1);
  if (!categoria || (debeEstarActiva && !categoria.activa)) {
    throw ApiError.desdeCodigo("VALIDACION", undefined, [
      {
        campo: "categoriaId",
        mensaje: categoria ? "La categoría está inactiva." : "La categoría no existe.",
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * RF-P1: catálogo paginado. Ambos roles.
 * Filtros: `q` (código o descripción), `categoriaId`, `bajoMinimo` y `activo`
 * (`true` por defecto; `false` y `todos` solo para el administrador: al
 * vendedor nunca se le exponen productos inactivos → 403 si los pide).
 * Orden: por código.
 */
export async function listarProductos(
  usuario: UsuarioAutenticado,
  consulta: unknown,
): Promise<ListaPaginada<ProductoPublico>> {
  // 1. Validar.
  const { q, categoriaId, bajoMinimo, activo, page, pageSize } =
    esquemaConsultaProductos.parse(consulta);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  if (activo !== "true") exigirRol(usuario, "admin");

  // 3. Reglas: armar el filtro.
  const condiciones: SQL[] = [];
  if (q) {
    const patron = patronContiene(q.toLowerCase());
    condiciones.push(
      or(
        sql`lower(${productos.codigo}) like ${patron} escape '\\'`,
        sql`lower(${productos.descripcion}) like ${patron} escape '\\'`,
      )!,
    );
  }
  if (categoriaId !== undefined) condiciones.push(eq(productos.categoriaId, categoriaId));
  // Decisión D2: bajo mínimo ⇔ existencia < stockMinimo (estricto).
  if (bajoMinimo === true) condiciones.push(lt(productos.existencia, productos.stockMinimo));
  if (bajoMinimo === false) {
    condiciones.push(sql`${productos.existencia} >= ${productos.stockMinimo}`);
  }
  if (activo !== "todos") condiciones.push(eq(productos.activo, activo === "true"));
  const filtro = condiciones.length > 0 ? and(...condiciones) : undefined;

  // 4. Base.
  const [filas, [{ total }]] = await Promise.all([
    seleccionarProductos(db)
      .where(filtro)
      .orderBy(asc(productos.codigo), asc(productos.id))
      .limit(pageSize)
      .offset(desplazamiento({ page, pageSize })),
    db.select({ total: count() }).from(productos).where(filtro),
  ]);

  // 5. Forma pública.
  return { data: filas.map(aProductoPublico), page, pageSize, total };
}

/** RF-P1: un producto. Inexistente → 404. Al vendedor, un inactivo → 404. */
export async function obtenerProducto(
  usuario: UsuarioAutenticado,
  parametros: unknown,
): Promise<ProductoPublico> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  // 3-4. Reglas y base.
  const producto = await buscarProducto(db, id);
  if (!producto || (!producto.activo && !tieneRol(usuario, "admin"))) {
    throw ApiError.desdeCodigo("NO_ENCONTRADO", "El producto no existe.");
  }
  // 5. Forma pública.
  return producto;
}

/**
 * RF-P2: alta de producto (solo admin). Nace activo y con existencia 0.
 * Si `stockInicial` > 0, el stock se carga con moverStock() como un ingreso
 * con motivo «Stock inicial», DENTRO de la misma transacción: o se graban el
 * producto y su movimiento, o no se graba nada (reglas 2 y sección 10.2).
 * Código repetido → 409 CODIGO_DUPLICADO; categoría inexistente o inactiva
 * → 422 VALIDACION.
 */
export async function crearProducto(
  usuario: UsuarioAutenticado,
  datos: unknown,
): Promise<ProductoPublico> {
  // 1. Validar (rechaza `existencia`).
  const { codigo, descripcion, categoriaId, precio, stockMinimo, stockInicial } =
    esquemaAltaProducto.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  return enTransaccion(async (tx) => {
    // 3. Reglas.
    await exigirCategoria(tx, categoriaId, true);
    await exigirCodigoLibre(tx, codigo);

    // 4. Base. `existencia` no se indica: toma el valor por defecto 0.
    const [{ id }] = await tx
      .insert(productos)
      .values({ codigo, descripcion, categoriaId, precio, stockMinimo, activo: true })
      .returning({ id: productos.id })
      .catch(traducirDuplicado);

    if (stockInicial && stockInicial > 0) {
      await moverStock(
        usuario,
        { productoId: id, tipo: "ingreso", cantidad: stockInicial, motivo: MOTIVO_STOCK_INICIAL },
        tx,
      );
    }

    // 5. Forma pública.
    return (await buscarProducto(tx, id))!;
  });
}

/**
 * RF-P2, RF-P3: edición parcial (solo admin) de código, descripción,
 * categoría, precio, stock mínimo y `activo` (baja o reactivación lógica).
 * No acepta `existencia` ni `stockInicial`: no toca la existencia ni el
 * historial de movimientos. Inexistente → 404; código de otro producto → 409.
 */
export async function actualizarProducto(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<ProductoPublico> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  const { codigo, descripcion, categoriaId, precio, stockMinimo, activo } =
    esquemaEdicionProducto.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  return enTransaccion(async (tx) => {
    const [actual] = await tx
      .select({ categoriaId: productos.categoriaId, activo: productos.activo })
      .from(productos)
      .where(eq(productos.id, id))
      .limit(1);
    if (!actual) throw ApiError.desdeCodigo("NO_ENCONTRADO", "El producto no existe.");

    // 3. Reglas.
    if (codigo !== undefined) await exigirCodigoLibre(tx, codigo, id);
    // Un producto activo debe pertenecer a una categoría activa: se controla
    // al cambiar de categoría o al reactivarlo.
    const quedaActivo = activo ?? actual.activo;
    if (categoriaId !== undefined || activo === true) {
      await exigirCategoria(tx, categoriaId ?? actual.categoriaId, quedaActivo);
    }

    // 4. Base: lista blanca de campos editables (nunca `existencia`).
    await tx
      .update(productos)
      .set({ codigo, descripcion, categoriaId, precio, stockMinimo, activo })
      .where(eq(productos.id, id))
      .catch(traducirDuplicado);

    // 5. Forma pública.
    return (await buscarProducto(tx, id))!;
  });
}
