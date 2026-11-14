/**
 * Servicio de gestión de usuarios (RF-U4 y parte administrativa de RF-U5).
 *
 * No conoce HTTP, cookies ni componentes: lo usan los Route Handlers de
 * /api/usuarios y, más adelante, las Server Actions. TODAS las reglas del
 * módulo viven aquí; las rutas solo adaptan HTTP.
 *
 * Orden de cada función (sección 10.2):
 *   1. validar la entrada con el esquema compartido;
 *   2. verificar el rol (solo `admin`);
 *   3. aplicar las reglas de negocio;
 *   4. acceder a la base;
 *   5. devolver la representación pública (nunca el hash de la contraseña).
 *
 * Bajas lógicas (regla 12): no hay borrado; se desactiva con `activo: false`.
 */
import "server-only";

import { and, asc, count, eq, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { usuarios, type Rol, type Usuario } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import { generarContrasenaTemporal, hashearContrasena } from "@/lib/contrasenas";
import { esViolacionDeUnicidad } from "@/lib/errores-base";
import { desplazamiento, type ListaPaginada } from "@/lib/paginacion";
import {
  esquemaAltaUsuario,
  esquemaConsultaUsuarios,
  esquemaEdicionUsuario,
  esquemaParametrosUsuario,
} from "@/lib/validacion-usuarios";

import type { UsuarioAutenticado } from "./auth";
import { exigirRol } from "./permisos";

// ---------------------------------------------------------------------------
// Representación pública
// ---------------------------------------------------------------------------

/**
 * Usuario tal como lo ve el administrador en la gestión: datos públicos más
 * el estado y la fecha de alta. NUNCA incluye passwordHash.
 */
export type UsuarioGestion = {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  creadoEn: string; // ISO 8601 UTC
};

/**
 * Columnas que se leen de la base para la gestión. Es una lista blanca: el
 * hash no se selecciona nunca, así que no puede viajar hacia la API.
 */
const columnasGestion = {
  id: usuarios.id,
  nombre: usuarios.nombre,
  email: usuarios.email,
  rol: usuarios.rol,
  activo: usuarios.activo,
  creadoEn: usuarios.creadoEn,
};

type FilaGestion = Pick<Usuario, keyof typeof columnasGestion>;

/**
 * Única conversión de una fila de la base al usuario público de la gestión.
 * Copia campo por campo: aunque la fila trajera otras columnas, no pasan.
 */
export function aUsuarioGestion(fila: FilaGestion): UsuarioGestion {
  return {
    id: fila.id,
    nombre: fila.nombre,
    email: fila.email,
    rol: fila.rol,
    activo: fila.activo,
    creadoEn: fila.creadoEn.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Ayudantes internos
// ---------------------------------------------------------------------------

/** Escapa los comodines de LIKE para buscar el texto literal. */
function patronContiene(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Convierte el choque con el índice único del email en 409 EMAIL_DUPLICADO. */
function traducirDuplicado(error: unknown): never {
  if (esViolacionDeUnicidad(error, "usuarios.email")) {
    throw ApiError.desdeCodigo("EMAIL_DUPLICADO", undefined, [
      { campo: "email", mensaje: "Ya existe un usuario con ese email." },
    ]);
  }
  throw error; // Otro error de la base: sigue como 500 ERROR_INTERNO.
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * RF-U4: listado paginado de usuarios para el administrador.
 * Filtros: `q` (nombre o email, sin distinguir mayúsculas) y `activo`.
 * Orden: por nombre y, a igual nombre, por id.
 */
export async function listarUsuarios(
  usuario: UsuarioAutenticado,
  consulta: unknown,
): Promise<ListaPaginada<UsuarioGestion>> {
  // 1. Validar.
  const { q, activo, page, pageSize } = esquemaConsultaUsuarios.parse(consulta);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  // 3. Reglas: armar el filtro.
  const condiciones: SQL[] = [];
  if (q) {
    const patron = patronContiene(q.toLowerCase());
    condiciones.push(
      or(
        sql`lower(${usuarios.nombre}) like ${patron} escape '\\'`,
        sql`lower(${usuarios.email}) like ${patron} escape '\\'`,
      )!,
    );
  }
  if (activo !== undefined) condiciones.push(eq(usuarios.activo, activo));
  const filtro = condiciones.length > 0 ? and(...condiciones) : undefined;

  // 4. Base.
  const [filas, [{ total }]] = await Promise.all([
    db
      .select(columnasGestion)
      .from(usuarios)
      .where(filtro)
      .orderBy(asc(usuarios.nombre), asc(usuarios.id))
      .limit(pageSize)
      .offset(desplazamiento({ page, pageSize })),
    db.select({ total: count() }).from(usuarios).where(filtro),
  ]);

  // 5. Forma pública.
  return { data: filas.map(aUsuarioGestion), page, pageSize, total };
}

/**
 * RF-U4: alta de usuario por el administrador. El email se guarda normalizado,
 * el usuario nace siempre activo y de la contraseña temporal solo se guarda
 * el hash. Email repetido → 409 EMAIL_DUPLICADO.
 */
export async function crearUsuario(
  usuario: UsuarioAutenticado,
  datos: unknown,
): Promise<UsuarioGestion> {
  // 1. Validar (normaliza email y nombre).
  const { nombre, email, rol, password } = esquemaAltaUsuario.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  // 3. Reglas: siempre activo; solo el hash.
  const passwordHash = await hashearContrasena(password);

  // 4. Base. La unicidad la garantiza el índice único (sin carreras).
  const [fila] = await db
    .insert(usuarios)
    .values({ nombre, email, rol, passwordHash, activo: true })
    .returning(columnasGestion)
    .catch(traducirDuplicado);

  // 5. Forma pública.
  return aUsuarioGestion(fila);
}

/**
 * RF-U4: edición parcial (nombre, email, rol, activo). Es también la baja y
 * la reactivación lógicas. Un administrador no puede desactivarse ni quitarse
 * el rol (422 OPERACION_SOBRE_SI_MISMO); así siempre queda al menos un
 * administrador activo. Inexistente → 404; email repetido → 409.
 */
export async function actualizarUsuario(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<UsuarioGestion> {
  // 1. Validar.
  const { id } = esquemaParametrosUsuario.parse(parametros);
  const cambios = esquemaEdicionUsuario.parse(datos);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  // 3. Reglas sobre sí mismo.
  if (id === usuario.id) {
    if (cambios.activo === false) {
      throw ApiError.desdeCodigo("OPERACION_SOBRE_SI_MISMO", "No puede desactivar su propio usuario.");
    }
    if (cambios.rol !== undefined && cambios.rol !== "admin") {
      throw ApiError.desdeCodigo(
        "OPERACION_SOBRE_SI_MISMO",
        "No puede quitarse a sí mismo el rol de administrador.",
      );
    }
  }

  // 4. Base: solo los campos validados (nunca passwordHash).
  const [fila] = await db
    .update(usuarios)
    .set(cambios)
    .where(eq(usuarios.id, id))
    .returning(columnasGestion)
    .catch(traducirDuplicado);
  if (!fila) throw ApiError.desdeCodigo("NO_ENCONTRADO", "El usuario no existe.");

  // 5. Forma pública.
  return aUsuarioGestion(fila);
}

/**
 * RF-U5: el administrador restablece la contraseña de un usuario. Se genera
 * una contraseña temporal criptográficamente segura, se guarda solo su hash y
 * se devuelve en claro UNA sola vez (no se registra en el log ni se vuelve a
 * poder consultar). La contraseña anterior deja de funcionar.
 * Inexistente → 404 NO_ENCONTRADO.
 */
export async function restablecerContrasena(
  usuario: UsuarioAutenticado,
  parametros: unknown,
): Promise<{ passwordTemporal: string }> {
  // 1. Validar.
  const { id } = esquemaParametrosUsuario.parse(parametros);
  // 2. Permiso.
  exigirRol(usuario, "admin");

  // 3. Reglas: contraseña temporal segura; solo se guarda el hash.
  const passwordTemporal = generarContrasenaTemporal();
  const passwordHash = await hashearContrasena(passwordTemporal);

  // 4. Base.
  const [fila] = await db
    .update(usuarios)
    .set({ passwordHash })
    .where(eq(usuarios.id, id))
    .returning({ id: usuarios.id });
  if (!fila) throw ApiError.desdeCodigo("NO_ENCONTRADO", "El usuario no existe.");

  // 5. Respuesta: la única vez que se entrega en claro.
  return { passwordTemporal };
}
