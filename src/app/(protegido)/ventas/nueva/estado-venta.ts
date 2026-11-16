/**
 * Estado de la pantalla de Nueva venta, como reductor puro (se prueba sin
 * navegador). Las transformaciones del borrador siguen siendo las funciones
 * puras de src/lib/borrador-venta.ts; aquí solo se coordinan el envío, los
 * errores, los diálogos y el reinicio.
 *
 * Con Cache Components, Next.js no desmonta /ventas/nueva al ir al
 * comprobante: la oculta con <Activity> y conserva su estado. Antes, tras una
 * emisión correcta `enviando` quedaba en true y el envío único quedaba
 * bloqueado, así que al volver la venta aparecía en «Confirmando…».
 *
 * Un único reinicio (`ventaInicial`) se usa al emitir, al descartar y al
 * ocultarse la pantalla después de una emisión. Cada reinicio avanza la
 * `generacion`: identifica el borrador vigente (una respuesta de otro
 * borrador se ignora), da un envío único nuevo y monta de nuevo los
 * buscadores (sus textos y búsquedas pendientes se descartan).
 */
import { actualizarExistencias, borradorInicial, SIN_ERRORES, type BorradorVenta, type ErrorEmisionInterpretado, type ErroresVenta } from "@/lib/borrador-venta";

export type EstadoVenta = {
  borrador: BorradorVenta;
  errores: ErroresVenta;
  enviando: boolean;
  sesionVencida: boolean;
  altaAbierta: boolean;
  confirmandoDescarte: boolean;
  /** Borrador vigente: cambia en cada reinicio. */
  generacion: number;
  /** Hubo una emisión correcta: al ocultarse la pantalla se reinicia otra vez. */
  pendienteReinicio: boolean;
};

export type AccionVenta =
  | { tipo: "actualizar"; cambio: (b: BorradorVenta) => BorradorVenta }
  | { tipo: "validacion"; errores: ErroresVenta }
  | { tipo: "enviar" }
  | { tipo: "emitida"; generacion: number }
  | { tipo: "fallo"; generacion: number; error: ErrorEmisionInterpretado }
  | { tipo: "alta"; abierta: boolean }
  | { tipo: "confirmarDescarte"; abierto: boolean }
  | { tipo: "descartar" }
  | { tipo: "ocultar" };

/** Estado limpio: Consumidor final, sin ítems, Contado, sin errores ni envío. */
export function ventaInicial(generacionAnterior = -1): EstadoVenta {
  return {
    borrador: borradorInicial(),
    errores: SIN_ERRORES,
    enviando: false,
    sesionVencida: false,
    altaAbierta: false,
    confirmandoDescarte: false,
    generacion: generacionAnterior + 1,
    pendienteReinicio: false,
  };
}

export function reducirVenta(estado: EstadoVenta, accion: AccionVenta): EstadoVenta {
  switch (accion.tipo) {
    case "actualizar":
      // Mientras se envía, el borrador no cambia; los errores del último intento dejan de valer.
      if (estado.enviando) return estado;
      return { ...estado, borrador: accion.cambio(estado.borrador), errores: SIN_ERRORES };
    case "validacion":
      if (estado.enviando) return estado;
      return { ...estado, errores: accion.errores };
    case "enviar":
      if (estado.enviando) return estado; // confirmación doble
      return { ...estado, enviando: true, errores: SIN_ERRORES, sesionVencida: false };
    case "emitida":
      // Respuesta de otro borrador: no toca el vigente.
      if (accion.generacion !== estado.generacion) return estado;
      return { ...ventaInicial(estado.generacion), pendienteReinicio: true };
    case "fallo": {
      if (accion.generacion !== estado.generacion || !estado.enviando) return estado;
      // La venta se conserva para corregirla; solo se actualizan las existencias informadas.
      const { error } = accion;
      const borrador = error.faltantes.length > 0 ? actualizarExistencias(estado.borrador, error.faltantes) : estado.borrador;
      return { ...estado, borrador, errores: error, sesionVencida: error.sesionVencida, enviando: false };
    }
    case "alta":
      return { ...estado, altaAbierta: accion.abierta };
    case "confirmarDescarte":
      return { ...estado, confirmandoDescarte: accion.abierto };
    case "descartar":
      if (estado.enviando) return estado;
      return ventaInicial(estado.generacion);
    case "ocultar":
      // Una venta a medio completar se conserva; solo se limpia después de una emisión.
      return estado.pendienteReinicio ? ventaInicial(estado.generacion) : estado;
  }
}
