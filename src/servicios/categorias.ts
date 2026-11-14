/**
 * Servicio de categorías (RF-P7; sección 11.4).
 *
 * No conoce HTTP: lo usan los Route Handlers de /api/categorias, las páginas
 * de /productos y el script de datos iniciales.
 *
 * Orden de cada función (sección 10.2): validar → verificar el rol → aplicar
 * las reglas → acceder a la base → devolver la forma pública.
 *
 * Bajas lógicas (regla 12): no hay borrado; se desactiva con `activa: false`.
 * Una categoría con productos activos no puede desactivarse (409 CATEGORIA_EN_USO).
 */
import "server-only";

import { and, asc, count, eq, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { categorias, productos, type Categoria } from "@/db/schema";
import { enTransaccion, type Conexion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { traducirUnicidad } from "@/lib/errores-base";
import { esquemaParametrosId } from "@/lib/validacion";
import {
  esquemaAltaCategoria,
  esquemaConsultaCategorias,
  esquemaEdicionCategoria,
} from "@/lib/validacion-productos";

import type { UsuarioAutenticado } from "./auth";
import { exigirRol } from "./permisos";

// ---------------------------------------------------------------------------
// Representación pública
// ---------------------------------------------------------------------------

export type CategoriaPublica = { id: number; nombre: string; activa: boolean };

/** Única conversión de una fila a la categoría pública (lista blanca de campos). */
export function aCategoriaPublica(fila: Pick<Categoria, "id" | "nombre" | "activa">): CategoriaPublica {
  return { id: fila.id, nombre: fila.nombre, activa: fila.activa };
}

const columnasPublicas = {
  id: categorias.id,
  nombre: categorias.nombre,
  activa: categorias.activa,
};

// ---------------------------------------------------------------------------
// Ayudantes internos
// ---------------------------------------------------------------------------

/** Índice único del nombre → 409 NOMBRE_DUPLICADO. Otro error sigue como 500. */
function traducirDuplicado(error: unknown): never {
  traducirUnicidad(error, {
    "categorias.nombre": { code: "NOMBRE_DUPLICADO", campo: "nombre" },
  });
}

/**
 * El índice único distingue mayúsculas («Pintura» ≠ «pintura»). Para evitar
 * categorías que solo difieren en eso, se busca antes sin distinguirlas.
 * El índice sigue siendo la garantía final ante pedidos simultáneos.
 */
async function exigirNombreLibre(conexion: Conexion, nombre: string, excluirId?: number) {
  const condiciones: SQL[] = [sql`lower(${categorias.nombre}) = lower(${nombre})`];
  if (excluirId !== undefined) condiciones.push(ne(categorias.id, excluirId));
  const [existente] = await conexion
    .select({ id: categorias.id })
    .from(categorias)
    .where(and(...condiciones))
    .limit(1);
  if (existente) {
    throw ApiError.desdeCodigo("NOMBRE_DUPLICADO", undefined, [
      { campo: "nombre", mensaje: "Ya existe una categoría con ese nombre." },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * RF-P7: categorías activas ordenadas por nombre, sin paginar (sección 11.4).
 * Ambos roles. `incluirInactivas=true` solo para el administrador.
 */
export async function listarCategorias(
  usuario: UsuarioAutenticado,
  consulta: unknown = {},
): Promise<CategoriaPublica[]> {
  // 1. Validar.
  const { incluirInactivas } = esquemaConsultaCategorias.parse(consulta);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  if (incluirInactivas) exigirRol(usuario, "admin");

  // 3-4. Base.
  const filas = await db
    .select(columnasPublicas)
    .from(categorias)
    .where(incluirInactivas ? undefined : eq(categorias.activa, true))
    .orderBy(asc(categorias.nombre), asc(categorias.id));

  // 5. Forma pública.
  return filas.map(aCategoriaPublica);
}

/** RF-P7: alta de categoría (solo admin). Nace activa. Nombre repetido → 409. */
export async function crearCategoria(
  usuario: UsuarioAutenticado,
  datos: unknown,
): Promise<CategoriaPublica> {
  // 1. Validar (normaliza espacios).
  const { nombre } = esquemaAltaCategoria.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  return enTransaccion(async (tx) => {
    // 3. Reglas: nombre único sin distinguir mayúsculas.
    await exigirNombreLibre(tx, nombre);
    // 4. Base.
    const [fila] = await tx
      .insert(categorias)
      .values({ nombre, activa: true })
      .returning(columnasPublicas)
      .catch(traducirDuplicado);
    // 5. Forma pública.
    return aCategoriaPublica(fila);
  });
}

/**
 * RF-P7: edición de `nombre` y/o `activa` (solo admin). Es también la baja y
 * la reactivación lógicas. Inexistente → 404; nombre repetido → 409
 * NOMBRE_DUPLICADO; desactivar con productos activos → 409 CATEGORIA_EN_USO.
 */
export async function actualizarCategoria(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<CategoriaPublica> {
  // 1. Validar.
  const { id } = esquemaParametrosId.parse(parametros);
  const cambios = esquemaEdicionCategoria.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  // La verificación y la actualización van en la misma transacción de
  // escritura: nadie puede activar un producto de la categoría entre medio.
  return enTransaccion(async (tx) => {
    const [actual] = await tx
      .select(columnasPublicas)
      .from(categorias)
      .where(eq(categorias.id, id))
      .limit(1);
    if (!actual) throw ApiError.desdeCodigo("NO_ENCONTRADO", "La categoría no existe.");

    // 3. Reglas.
    if (cambios.nombre !== undefined) await exigirNombreLibre(tx, cambios.nombre, id);
    if (cambios.activa === false && actual.activa) {
      const [{ activos }] = await tx
        .select({ activos: count() })
        .from(productos)
        .where(and(eq(productos.categoriaId, id), eq(productos.activo, true)));
      if (activos > 0) {
        throw ApiError.desdeCodigo(
          "CATEGORIA_EN_USO",
          `La categoría tiene ${activos} producto(s) activo(s) y no puede desactivarse.`,
          { productosActivos: activos },
        );
      }
    }

    // 4. Base: solo los campos validados.
    const [fila] = await tx
      .update(categorias)
      .set(cambios)
      .where(eq(categorias.id, id))
      .returning(columnasPublicas)
      .catch(traducirDuplicado);

    // 5. Forma pública.
    return aCategoriaPublica(fila);
  });
}
