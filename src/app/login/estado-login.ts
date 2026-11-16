/**
 * Estado del formulario de inicio de sesión, como reductor puro (se prueba
 * sin navegador).
 *
 * Con Cache Components, Next.js no desmonta /login al entrar al área
 * protegida: lo oculta con <Activity> y conserva su estado. Tras un ingreso
 * correcto `enviando` queda en true a propósito (el botón sigue bloqueado
 * mientras se navega), así que al cerrar sesión el formulario reaparecía en
 * «Ingresando…» y deshabilitado. La acción `reiniciar`, que el formulario
 * despacha cuando Activity lo oculta, deja todo como recién montado.
 *
 * Cada envío recibe un número de `intento`. Una respuesta solo puede
 * modificar el estado si pertenece al intento vigente: `reiniciar` avanza el
 * número, de modo que la respuesta tardía de un intento anterior se descarta.
 */

export type EstadoLogin = {
  email: string;
  password: string;
  error: string | null;
  enviando: boolean;
  /** Número del envío vigente (0 = ninguno todavía). */
  intento: number;
  /** Cambia en cada reinicio: monta de nuevo el campo de contraseña, que vuelve a quedar oculta. */
  generacion: number;
};

export type AccionLogin =
  | { tipo: "email"; valor: string }
  | { tipo: "password"; valor: string }
  | { tipo: "enviar" }
  | { tipo: "fallo"; intento: number; mensaje: string }
  | { tipo: "reiniciar" };

export const ESTADO_INICIAL_LOGIN: EstadoLogin = { email: "", password: "", error: null, enviando: false, intento: 0, generacion: 0 };

export function reducirLogin(estado: EstadoLogin, accion: AccionLogin): EstadoLogin {
  switch (accion.tipo) {
    case "email":
      return { ...estado, email: accion.valor };
    case "password":
      return { ...estado, password: accion.valor };
    case "enviar":
      // Doble envío: mientras hay uno en curso no se inicia otro.
      if (estado.enviando) return estado;
      return { ...estado, enviando: true, error: null, intento: estado.intento + 1 };
    case "fallo":
      // Respuesta de un intento que ya no es el vigente: se ignora.
      if (accion.intento !== estado.intento || !estado.enviando) return estado;
      return { ...estado, enviando: false, error: accion.mensaje };
    case "reiniciar":
      // Se limpian correo y contraseña: quien ingrese después (otra persona en
      // el mismo equipo) no debe ver datos de la sesión anterior.
      return { ...ESTADO_INICIAL_LOGIN, intento: estado.intento + 1, generacion: estado.generacion + 1 };
  }
}
