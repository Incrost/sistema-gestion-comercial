/**
 * Datos iniciales: usuarios académicos (RF-U3 y sección 8, «Datos de prueba»).
 *
 * Crea un administrador y un vendedor de PRUEBA para desarrollo y para la
 * corrección del parcial. Sus credenciales son ficticias, públicas y están
 * documentadas en el README: no son credenciales personales.
 *
 * Idempotente: el email es único, así que si el usuario ya existe NO se
 * duplica ni se modifica (tampoco se le pisa la contraseña). Se puede
 * ejecutar todas las veces que se quiera.
 *
 * Los datos pasan por el MISMO esquema que el alta de usuarios
 * (src/lib/validacion-usuarios.ts) y solo se guarda el hash de la contraseña.
 *
 * Solo servidor (lo usa scripts/seed.ts).
 */
import "server-only";

import type { BaseDeDatos } from "@/db";
import { usuarios } from "@/db/schema";
import { hashearContrasena } from "@/lib/contrasenas";
import { esquemaAltaUsuario, type DatosAltaUsuario } from "@/lib/validacion-usuarios";

/** Usuarios académicos (uno por rol). Contraseñas de demostración, documentadas en el README. */
export const USUARIOS_ACADEMICOS: readonly DatosAltaUsuario[] = [
  {
    nombre: "Administrador de Prueba",
    email: "admin@comercio.test",
    rol: "admin",
    password: "Admin-Prueba-2026",
  },
  {
    nombre: "Vendedor de Prueba",
    email: "vendedor@comercio.test",
    rol: "vendedor",
    password: "Vendedor-Prueba-2026",
  },
];

export type ResultadoSemillaUsuario = { email: string; estado: "creado" | "existente" };

/**
 * RF-U3: crea los usuarios académicos que falten. Devuelve, por cada uno, si
 * se creó o si ya existía. Nunca devuelve contraseñas ni hashes.
 */
export async function sembrarUsuarios(
  db: Pick<BaseDeDatos, "insert">,
  lista: readonly unknown[] = USUARIOS_ACADEMICOS,
): Promise<ResultadoSemillaUsuario[]> {
  const resultados: ResultadoSemillaUsuario[] = [];

  for (const datos of lista) {
    const { nombre, email, rol, password } = esquemaAltaUsuario.parse(datos);
    const insertados = await db
      .insert(usuarios)
      .values({ nombre, email, rol, passwordHash: await hashearContrasena(password), activo: true })
      .onConflictDoNothing({ target: usuarios.email })
      .returning({ id: usuarios.id });
    resultados.push({ email, estado: insertados.length > 0 ? "creado" : "existente" });
  }

  return resultados;
}
