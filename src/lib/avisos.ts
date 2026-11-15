/**
 * Sistema ÚNICO de notificaciones temporales (sección 8: «cada operación
 * confirma su resultado con un aviso»).
 *
 * Reglas:
 * - Éxito e información desaparecen solos (≈ 4,5 s); advertencias duran más;
 *   los errores quedan 10 s, o hasta cerrarlos si se piden `persistente`.
 * - Todos tienen una X para cerrarlos antes (botón del <Toaster>).
 * - Sin duplicados: cada aviso tiene un identificador (por defecto, su tipo y
 *   su texto); emitir otro con el mismo id REEMPLAZA al anterior.
 * - Grupos: los avisos de un mismo contexto (p. ej. «venta») se pueden
 *   limpiar juntos, como al descartar una venta.
 * - Los errores de validación NO pasan por aquí: se muestran junto al campo.
 *
 * El núcleo (crearAvisos) no depende de ninguna biblioteca y se prueba con un
 * adaptador falso; `avisos` lo conecta con sonner, que aporta la región
 * aria-live y el botón de cierre.
 */
import { toast } from "sonner";

export type TipoAviso = "exito" | "error" | "advertencia" | "info";

/** Duración en milisegundos de cada tipo (Infinity = hasta que se cierre). */
export const DURACION_AVISO: Record<TipoAviso, number> = {
  exito: 4500,
  info: 4500,
  advertencia: 7000,
  error: 10000,
};

export type AccionAviso = { etiqueta: string; alHacer: () => void };

export type OpcionesAviso = {
  /** Identificador estable: un aviso nuevo con el mismo id reemplaza al anterior. */
  id?: string;
  /** Contexto al que pertenece (permite limpiar todos sus avisos juntos). */
  grupo?: string;
  descripcion?: string;
  accion?: AccionAviso;
  /** Solo errores: queda visible hasta que la persona lo cierre. */
  persistente?: boolean;
};

/** Lo que el núcleo necesita de la biblioteca de notificaciones. */
export type AdaptadorAvisos = {
  mostrar: (aviso: { tipo: TipoAviso; texto: string; id: string; duracion: number; descripcion?: string; accion?: AccionAviso }) => void;
  descartar: (id: string) => void;
};

/** Id por defecto: el mismo mensaje del mismo tipo nunca se muestra dos veces a la vez. */
export function idAviso(tipo: TipoAviso, texto: string, id?: string): string {
  return id ?? `${tipo}:${texto}`;
}

export function duracionAviso(tipo: TipoAviso, persistente = false): number {
  return tipo === "error" && persistente ? Infinity : DURACION_AVISO[tipo];
}

export function crearAvisos(adaptador: AdaptadorAvisos) {
  const grupos = new Map<string, Set<string>>();

  function mostrar(tipo: TipoAviso, texto: string, opciones: OpcionesAviso = {}): string {
    const id = idAviso(tipo, texto, opciones.id);
    if (opciones.grupo) {
      const ids = grupos.get(opciones.grupo) ?? new Set<string>();
      ids.add(id);
      grupos.set(opciones.grupo, ids);
    }
    adaptador.mostrar({
      tipo,
      texto,
      id,
      duracion: duracionAviso(tipo, opciones.persistente),
      descripcion: opciones.descripcion,
      accion: opciones.accion,
    });
    return id;
  }

  return {
    exito: (texto: string, opciones?: OpcionesAviso) => mostrar("exito", texto, opciones),
    error: (texto: string, opciones?: OpcionesAviso) => mostrar("error", texto, opciones),
    advertencia: (texto: string, opciones?: OpcionesAviso) => mostrar("advertencia", texto, opciones),
    info: (texto: string, opciones?: OpcionesAviso) => mostrar("info", texto, opciones),
    /** Cierra un aviso por su id (si ya no está visible, no hace nada). */
    descartar(id: string) {
      adaptador.descartar(id);
      for (const ids of grupos.values()) ids.delete(id);
    },
    /** Cierra todos los avisos de un grupo. */
    limpiarGrupo(grupo: string) {
      for (const id of grupos.get(grupo) ?? []) adaptador.descartar(id);
      grupos.delete(grupo);
    },
  };
}

export type Avisos = ReturnType<typeof crearAvisos>;

const FUNCION_SONNER = {
  exito: toast.success,
  error: toast.error,
  advertencia: toast.warning,
  info: toast.info,
} as const;

/** Avisos de la aplicación (sonner). Solo se usan desde componentes cliente. */
export const avisos = crearAvisos({
  mostrar: ({ tipo, texto, id, duracion, descripcion, accion }) =>
    FUNCION_SONNER[tipo](texto, {
      id,
      duration: duracion,
      description: descripcion,
      action: accion ? { label: accion.etiqueta, onClick: accion.alHacer } : undefined,
    }),
  descartar: (id) => toast.dismiss(id),
});
