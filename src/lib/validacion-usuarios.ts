/**
 * Esquemas de validación de la gestión de usuarios (RF-U4, RF-U5; sección 11.3).
 *
 * Los usa el servicio src/servicios/usuarios.ts para validar en el servidor y
 * la pantalla /usuarios para adelantar los mensajes en el formulario: ambos
 * aplican exactamente las mismas reglas (sección 10.8, punto 6).
 *
 * Todos son estrictos: un campo no previsto (por ejemplo `passwordHash`)
 * produce 422 VALIDACION con el detalle «Campo no permitido.».
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import { z } from "zod";

import { ROLES } from "@/db/schema";

import {
  esquemaContrasena,
  esquemaEmail,
  esquemaIdTexto,
  esquemaPaginacion,
  textoObligatorio,
} from "./validacion";

/** Longitud máxima del nombre de un usuario. */
export const NOMBRE_USUARIO_MAXIMO = 100;

/** Longitud máxima del texto de búsqueda `q`. */
export const BUSQUEDA_MAXIMA = 100;

/** Nombre y apellido: obligatorio, sin espacios extremos. */
export const esquemaNombreUsuario = textoObligatorio(NOMBRE_USUARIO_MAXIMO);

/** Rol: `admin` o `vendedor` (sección 3). */
export const esquemaRol = z.enum(ROLES, { error: "Debe ser «admin» o «vendedor»." });

/** Estado del usuario (baja lógica, regla 12). */
export const esquemaActivo = z.boolean({ error: "Debe ser verdadero o falso." });

// ---------------------------------------------------------------------------
// GET /api/usuarios — consulta del listado
// ---------------------------------------------------------------------------

/** Convierte "" en undefined para que un filtro vacío equivalga a no filtrar. */
function vacioComoAusente(valor: unknown): unknown {
  return valor === "" ? undefined : valor;
}

/**
 * Parámetros de la URL del listado. Llegan como texto:
 * - `q`: busca en nombre o email (sin distinguir mayúsculas);
 * - `activo`: `true` o `false`; si falta, lista todos;
 * - `page`, `pageSize`: paginación de la sección 11.1.
 */
export const esquemaConsultaUsuarios = z.strictObject({
  ...esquemaPaginacion.shape,
  q: z.preprocess(
    vacioComoAusente,
    z
      .string()
      .trim()
      .max(BUSQUEDA_MAXIMA, `No puede superar los ${BUSQUEDA_MAXIMA} caracteres.`)
      .optional(),
  ),
  activo: z.preprocess(
    vacioComoAusente,
    z
      .enum(["true", "false"], { error: "Debe ser «true» o «false»." })
      .transform((valor) => valor === "true")
      .optional(),
  ),
});
export type ConsultaUsuarios = z.infer<typeof esquemaConsultaUsuarios>;

// ---------------------------------------------------------------------------
// POST /api/usuarios — alta
// ---------------------------------------------------------------------------

/**
 * Alta de usuario. `password` es la contraseña temporal que el administrador
 * le comunica al usuario (8 a 72 caracteres). El usuario se crea siempre
 * activo: `activo` no se acepta en el alta.
 */
export const esquemaAltaUsuario = z.strictObject({
  nombre: esquemaNombreUsuario,
  email: esquemaEmail,
  rol: esquemaRol,
  password: esquemaContrasena,
});
export type DatosAltaUsuario = z.infer<typeof esquemaAltaUsuario>;

// ---------------------------------------------------------------------------
// PATCH /api/usuarios/{id} — edición parcial
// ---------------------------------------------------------------------------

/**
 * Edición parcial: cualquiera de `nombre`, `email`, `rol` y `activo`, al menos
 * uno. La contraseña NO se edita aquí (se restablece con su propia ruta).
 */
export const esquemaEdicionUsuario = z
  .strictObject({
    nombre: esquemaNombreUsuario.optional(),
    email: esquemaEmail.optional(),
    rol: esquemaRol.optional(),
    activo: esquemaActivo.optional(),
  })
  .refine((datos) => Object.values(datos).some((valor) => valor !== undefined), {
    message: "Debe indicar al menos un campo para modificar.",
    // Solo si no hubo otros errores: con un campo no permitido basta ese aviso.
    when: (payload) => payload.issues.length === 0,
  });
export type DatosEdicionUsuario = z.infer<typeof esquemaEdicionUsuario>;

// ---------------------------------------------------------------------------
// Parámetros de la URL: /api/usuarios/{id}
// ---------------------------------------------------------------------------

/** Parámetros de ruta `{ id }`: identificador entero positivo. */
export const esquemaParametrosUsuario = z.strictObject({ id: esquemaIdTexto });
export type ParametrosUsuario = z.infer<typeof esquemaParametrosUsuario>;
