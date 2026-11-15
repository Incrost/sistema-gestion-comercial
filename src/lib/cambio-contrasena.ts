/**
 * Lógica del formulario «Cambiar contraseña» de /perfil (RF-U5), separada del
 * componente para poder probarla sin navegador.
 *
 * - Valida con el MISMO esquema que el servidor (esquemaCambioContrasena):
 *   actual obligatoria, nueva de 8 a 72 caracteres y distinta de la actual.
 *   La confirmación es solo del cliente y NUNCA se envía.
 * - Arma el cuerpo de PUT /api/auth/password con únicamente { actual, nueva }.
 * - Traduce la respuesta a lo que la pantalla debe hacer.
 *
 * Ninguna función registra ni guarda las contraseñas: solo viven en el estado
 * del formulario mientras se completa.
 *
 * Módulo compartido: puede importarse desde el cliente.
 */
import { ErrorDeApi, erroresDeZod, llamarApi, type ErroresCampo } from "./cliente-api";
import { esquemaCambioContrasena, type DatosCambioContrasena } from "./validacion";

export type CamposContrasena = { actual: string; nueva: string; confirmacion: string };

export const CAMPOS_VACIOS: CamposContrasena = { actual: "", nueva: "", confirmacion: "" };

export const RUTA_CAMBIO_CONTRASENA = "/api/auth/password";

export const MENSAJE_ERROR_SEGURO = "No fue posible actualizar la contraseña. Intente nuevamente más tarde.";
export const MENSAJE_EXITO = "Contraseña actualizada";
export const DESCRIPCION_EXITO = "La próxima vez que inicie sesión, utilice la nueva contraseña.";

const OBLIGATORIO = "Es obligatorio.";

export type ResultadoValidacion =
  | { ok: true; cuerpo: DatosCambioContrasena }
  | { ok: false; errores: ErroresCampo };

/** Valida los tres campos; si están bien, devuelve el cuerpo a enviar (sin la confirmación). */
export function validarCambioContrasena(campos: CamposContrasena): ResultadoValidacion {
  const errores: ErroresCampo = {};
  const resultado = esquemaCambioContrasena.safeParse({ actual: campos.actual, nueva: campos.nueva });
  if (!resultado.success) Object.assign(errores, erroresDeZod(resultado.error));

  // Un campo vacío se informa como obligatorio, no como «muy corto».
  if (campos.nueva === "") errores.nueva = OBLIGATORIO;
  if (campos.confirmacion === "") errores.confirmacion = OBLIGATORIO;
  else if (campos.confirmacion !== campos.nueva) errores.confirmacion = "No coincide con la contraseña nueva.";

  if (Object.keys(errores).length > 0 || !resultado.success) return { ok: false, errores };
  // Lista blanca: solo actual y nueva viajan al servidor.
  return { ok: true, cuerpo: { actual: resultado.data.actual, nueva: resultado.data.nueva } };
}

/** Lo que la pantalla debe hacer con el resultado del envío. */
export type ResultadoEnvio =
  | { tipo: "exito" }
  /** Errores junto a cada campo (validación local o de la API). */
  | { tipo: "campos"; errores: ErroresCampo }
  /** La sesión ya no es válida: volver al login. */
  | { tipo: "sesion" }
  /** Error general, con un mensaje apto para mostrar. */
  | { tipo: "error"; mensaje: string };

/** Traduce un error de PUT /api/auth/password a la acción de la pantalla. */
export function interpretarErrorCambio(error: unknown): ResultadoEnvio {
  if (!(error instanceof ErrorDeApi)) return { tipo: "error", mensaje: MENSAJE_ERROR_SEGURO };
  if (error.status === 401 || error.code === "NO_AUTENTICADO") return { tipo: "sesion" };
  if (error.code === "CONTRASENA_ACTUAL_INCORRECTA") {
    return { tipo: "campos", errores: { actual: error.campos.actual ?? "La contraseña actual es incorrecta." } };
  }
  if (error.code === "VALIDACION" && Object.keys(error.campos).length > 0) {
    return { tipo: "campos", errores: error.campos };
  }
  // Falla del servidor: nunca se muestran detalles técnicos.
  if (error.status >= 500 || error.code === "ERROR_INTERNO") return { tipo: "error", mensaje: MENSAJE_ERROR_SEGURO };
  return { tipo: "error", mensaje: error.message || MENSAJE_ERROR_SEGURO };
}

type Llamar = (url: string, init: RequestInit) => Promise<unknown>;

/**
 * Valida y, si corresponde, envía el cambio. `llamar` se puede reemplazar en
 * las pruebas; por defecto es llamarApi (respuesta de error estándar).
 */
export async function enviarCambioContrasena(campos: CamposContrasena, llamar: Llamar = llamarApi): Promise<ResultadoEnvio> {
  const validacion = validarCambioContrasena(campos);
  if (!validacion.ok) return { tipo: "campos", errores: validacion.errores };
  try {
    await llamar(RUTA_CAMBIO_CONTRASENA, { method: "PUT", body: JSON.stringify(validacion.cuerpo) });
    return { tipo: "exito" };
  } catch (error) {
    return interpretarErrorCambio(error);
  }
}

/**
 * Campos que quedan después de un envío: el éxito limpia todo; ante un error
 * (por ejemplo, la actual incorrecta) se conservan, para corregir solo lo
 * necesario sin volver a escribir la nueva ni su confirmación.
 */
export function camposTrasEnvio(campos: CamposContrasena, resultado: ResultadoEnvio): CamposContrasena {
  return resultado.tipo === "exito" ? CAMPOS_VACIOS : campos;
}

/**
 * Evita envíos dobles: mientras una operación está en curso, las llamadas
 * siguientes se ignoran (devuelven undefined). Complementa al botón
 * deshabilitado, que por sí solo no impide un doble Enter muy rápido.
 */
export function crearEnvioUnico() {
  let enCurso = false;
  return {
    get enCurso() {
      return enCurso;
    },
    async ejecutar<T>(operacion: () => Promise<T>): Promise<T | undefined> {
      if (enCurso) return undefined;
      enCurso = true;
      try {
        return await operacion();
      } finally {
        enCurso = false;
      }
    },
  };
}
