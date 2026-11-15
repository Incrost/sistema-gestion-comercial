/**
 * Pruebas del sistema de notificaciones (src/lib/avisos.ts).
 *
 * - El núcleo se prueba con un adaptador falso (duración, ids, grupos).
 * - La integración se prueba con el almacén REAL de sonner, sin navegador:
 *   así se comprueba que no hay duplicados y que limpiar un grupo cierra los
 *   avisos de la venta descartada.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { toast, type ToastT, type ToastToDismiss } from "sonner";

import { AVISO_AGREGADO, GRUPO_AVISOS_VENTA } from "@/app/(protegido)/ventas/nueva/buscador-productos";

import { avisos, crearAvisos, DURACION_AVISO, duracionAviso, idAviso, type AdaptadorAvisos } from "./avisos";

function adaptadorFalso() {
  const mostrados: Parameters<AdaptadorAvisos["mostrar"]>[0][] = [];
  const descartados: string[] = [];
  const adaptador: AdaptadorAvisos = { mostrar: (a) => mostrados.push(a), descartar: (id) => descartados.push(id) };
  return { adaptador, mostrados, descartados };
}

describe("duración de los avisos", () => {
  it("éxito e información desaparecen solos en 4 a 5 segundos", () => {
    expect(DURACION_AVISO.exito).toBeGreaterThanOrEqual(4000);
    expect(DURACION_AVISO.exito).toBeLessThanOrEqual(5000);
    expect(DURACION_AVISO.info).toBeLessThanOrEqual(5000);
  });

  it("advertencias y errores duran más; un error persistente queda hasta cerrarlo", () => {
    expect(DURACION_AVISO.advertencia).toBeGreaterThan(DURACION_AVISO.exito);
    expect(DURACION_AVISO.error).toBeGreaterThan(DURACION_AVISO.advertencia);
    expect(duracionAviso("error", true)).toBe(Infinity);
    expect(duracionAviso("exito", true)).toBe(DURACION_AVISO.exito); // solo los errores pueden ser persistentes
  });

  it("el adaptador recibe la duración de cada tipo", () => {
    const { adaptador, mostrados } = adaptadorFalso();
    const a = crearAvisos(adaptador);
    a.exito("Guardado.");
    a.error("Falló.", { persistente: true });
    expect(mostrados.map((m) => [m.tipo, m.duracion])).toEqual([
      ["exito", DURACION_AVISO.exito],
      ["error", Infinity],
    ]);
  });
});

describe("identificadores y grupos", () => {
  it("el mismo mensaje del mismo tipo usa el mismo id (no se duplica)", () => {
    expect(idAviso("exito", "Guardado.")).toBe(idAviso("exito", "Guardado."));
    expect(idAviso("exito", "Guardado.")).not.toBe(idAviso("error", "Guardado."));
    expect(idAviso("exito", "Otro texto", "fijo")).toBe("fijo");
  });

  it("cerrar con la X equivale a descartar por id", () => {
    const { adaptador, descartados } = adaptadorFalso();
    const a = crearAvisos(adaptador);
    const id = a.info("Hola.");
    a.descartar(id);
    expect(descartados).toEqual([id]);
  });

  it("limpiar un grupo descarta todos sus avisos y solo los suyos", () => {
    const { adaptador, descartados } = adaptadorFalso();
    const a = crearAvisos(adaptador);
    a.exito("Se agregó 1 × Martillo.", { id: "agregado", grupo: "venta" });
    a.info("Cliente seleccionado.", { id: "cliente", grupo: "venta" });
    a.exito("Producto actualizado.", { id: "otro" });
    a.limpiarGrupo("venta");
    expect(descartados.sort()).toEqual(["agregado", "cliente"]);
    a.limpiarGrupo("venta"); // el grupo ya quedó vacío
    expect(descartados).toHaveLength(2);
  });
});

describe("integración con sonner (almacén real)", () => {
  beforeAll(() => {
    // sonner difiere el cierre al próximo cuadro; en Node se simula con setTimeout.
    // El identificador público es un number propio; el Map lo relaciona con el
    // temporizador de Node para que cancelAnimationFrame pueda cancelarlo.
    const cuadros = new Map<number, ReturnType<typeof setTimeout>>();
    let ultimoCuadro = 0;
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback): number => {
      const id = ++ultimoCuadro;
      cuadros.set(
        id,
        setTimeout(() => {
          cuadros.delete(id);
          cb(0);
        }, 0),
      );
      return id;
    };
    globalThis.cancelAnimationFrame ??= (id: number): void => {
      clearTimeout(cuadros.get(id));
      cuadros.delete(id);
    };
  });

  afterEach(() => {
    toast.dismiss();
  });

  const activos = () => toast.getToasts().map((t) => String(t.id));

  /** Distingue un aviso visible (ToastT) de una orden de cierre (ToastToDismiss). */
  function esAviso(t: ToastT | ToastToDismiss): t is ToastT {
    return !("dismiss" in t);
  }

  /** Devuelve el aviso visible con ese id o hace fallar la prueba con un mensaje claro. */
  function avisoActivo(id: string | number): ToastT {
    const t = toast.getToasts().find((x) => x.id === id);
    if (!t) throw new Error(`No hay ningún aviso activo con id «${id}».`);
    if (!esAviso(t)) throw new Error(`El elemento con id «${id}» es una orden de cierre, no un aviso visible.`);
    return t;
  }

  it("un aviso de éxito queda activo, con su duración temporal", () => {
    const id = avisos.exito("Factura 0001-00000010 emitida.", { id: "prueba-exito" });
    const t = avisoActivo(id);
    expect(t.duration).toBe(DURACION_AVISO.exito);
    expect(t.type).toBe("success");
  });

  it("repetir «Se agregó…» no apila avisos: el nuevo reemplaza al anterior", () => {
    avisos.exito("Se agregó 1 × Martillo.", { id: AVISO_AGREGADO, grupo: GRUPO_AVISOS_VENTA });
    avisos.exito("Se agregó 2 × Pincel.", { id: AVISO_AGREGADO, grupo: GRUPO_AVISOS_VENTA });
    const agregados = toast.getToasts().filter((t) => t.id === AVISO_AGREGADO);
    expect(agregados).toHaveLength(1);
    expect(avisoActivo(AVISO_AGREGADO).title).toBe("Se agregó 2 × Pincel.");
  });

  it("el mismo error dos veces se muestra una sola vez", () => {
    avisos.error("No fue posible comunicarse con el servidor.");
    avisos.error("No fue posible comunicarse con el servidor.");
    expect(activos().filter((id) => id.startsWith("error:"))).toHaveLength(1);
  });

  it("al descartar la venta se limpian los avisos de sus ítems", () => {
    avisos.exito("Se agregó 1 × Martillo.", { id: AVISO_AGREGADO, grupo: GRUPO_AVISOS_VENTA });
    avisos.info("Cliente seleccionado: Mariana López.", { id: "venta-cliente", grupo: GRUPO_AVISOS_VENTA });
    avisos.exito("Producto actualizado.", { id: "fuera-de-la-venta" });
    avisos.limpiarGrupo(GRUPO_AVISOS_VENTA);
    expect(activos()).not.toContain(AVISO_AGREGADO);
    expect(activos()).not.toContain("venta-cliente");
    expect(activos()).toContain("fuera-de-la-venta");
  });

  it("quitar el producto cierra el aviso «Se agregó…»", () => {
    avisos.exito("Se agregó 1 × Martillo.", { id: AVISO_AGREGADO, grupo: GRUPO_AVISOS_VENTA });
    avisos.descartar(AVISO_AGREGADO);
    expect(activos()).not.toContain(AVISO_AGREGADO);
  });
});
