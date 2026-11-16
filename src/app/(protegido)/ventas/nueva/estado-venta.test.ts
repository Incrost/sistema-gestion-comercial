/**
 * Pruebas del estado de Nueva venta conservado por <Activity> (Cache
 * Components): emisión, error, descarte y vuelta a la pantalla.
 *
 * Como el resto del proyecto (sin DOM ni bibliotecas de componentes), el
 * ciclo se prueba con el reductor puro que usa la pantalla y con el envío
 * único real de src/lib/borrador-venta.ts; en la fuente se verifica que la
 * limpieza de useLayoutEffect, las claves de los buscadores y los avisos
 * estén conectados.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  actualizarPago,
  agregarProducto,
  cambiarFormaPago,
  construirCuerpoEmision,
  crearEnvioUnico,
  interpretarErrorEmision,
  PAGO_INICIAL,
  resolverAtajo,
  seleccionarCliente,
  type BorradorVenta,
  type ClienteVenta,
} from "@/lib/borrador-venta";
import { ErrorDeApi } from "@/lib/cliente-api";

import { reducirVenta, ventaInicial, type AccionVenta, type EstadoVenta } from "./estado-venta";

const DIR = join(process.cwd(), "src", "app", "(protegido)", "ventas", "nueva");
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const fuente = sinComentarios(readFileSync(join(DIR, "nueva-venta.tsx"), "utf8"));
const busqueda = sinComentarios(readFileSync(join(DIR, "usar-busqueda.ts"), "utf8"));

const aplicar = (estado: EstadoVenta, ...acciones: AccionVenta[]) => acciones.reduce(reducirVenta, estado);

const cliente: ClienteVenta = {
  id: 7, nombre: "Mariana López", tipoDoc: "DNI", nroDoc: "28456123", saldo: 0,
  cuentaCorriente: true, limiteCredito: 3_000_000, disponible: 3_000_000,
};
const martillo = { id: 1, codigo: "HE-001", descripcion: "Martillo", precio: 1_250_000, existencia: 5 };

/** Borrador completo: cliente con cuenta corriente, ítems, tarjeta y monto escritos en algún momento. */
function ventaCompleta(estado = ventaInicial()): EstadoVenta {
  const conItem = (b: BorradorVenta) => {
    const r = agregarProducto(b, martillo, "2");
    if (!r.ok) throw new Error(r.mensaje);
    return r.borrador;
  };
  return aplicar(
    estado,
    { tipo: "actualizar", cambio: (b) => seleccionarCliente(b, cliente) },
    { tipo: "actualizar", cambio: conItem },
    { tipo: "actualizar", cambio: (b) => actualizarPago(b, { montoRecibido: "5000" }) },
    { tipo: "actualizar", cambio: (b) => cambiarFormaPago(b, "tarjeta") },
    { tipo: "actualizar", cambio: (b) => actualizarPago(b, { tarjetaTipo: "debito", tarjetaMarca: "Visa", tarjetaUltimos4: "1234" }) },
    { tipo: "actualizar", cambio: (b) => cambiarFormaPago(b, "cuenta_corriente") },
  );
}

/** Lo que se ve al volver a Nueva venta: venta limpia y habilitada. */
function esperarLimpia(estado: EstadoVenta) {
  expect(estado.enviando).toBe(false);
  expect(estado.borrador.cliente).toBeNull(); // Consumidor final
  expect(estado.borrador.renglones).toEqual([]);
  expect(estado.borrador.pago).toEqual(PAGO_INICIAL); // Contado, sin monto ni tarjeta
  expect(estado.borrador.pago.forma).not.toBe("cuenta_corriente");
  expect(estado.errores).toEqual({ general: null, campos: {}, productos: {} });
  expect(estado.sesionVencida).toBe(false);
  expect(estado.altaAbierta).toBe(false);
  expect(estado.confirmandoDescarte).toBe(false);
}

const errorStock = (b: BorradorVenta) =>
  interpretarErrorEmision(new ErrorDeApi("La existencia no alcanza.", 409, "STOCK_INSUFICIENTE", {}, [{ productoId: 1, solicitado: 2, disponible: 1 }]), b);

describe("Nueva venta: estado inicial y emisión", () => {
  it("el estado inicial es una venta limpia y habilitada", () => {
    esperarLimpia(ventaInicial());
    expect(ventaInicial().pendienteReinicio).toBe(false);
  });

  it("al confirmar pasa a «Confirmando…» y bloquea cambios y confirmaciones dobles", () => {
    const enviando = aplicar(ventaCompleta(), { tipo: "enviar" });
    expect(enviando.enviando).toBe(true);
    expect(aplicar(enviando, { tipo: "enviar" })).toBe(enviando);
    expect(aplicar(enviando, { tipo: "actualizar", cambio: () => ventaInicial().borrador })).toBe(enviando);
    expect(aplicar(enviando, { tipo: "descartar" })).toBe(enviando);
    expect(fuente).toContain('{enviando ? "Confirmando…" : "Confirmar venta (F9)"}');
  });

  it("una emisión correcta deja la venta limpia, con envío liberado y el reinicio al ocultarse preparado", () => {
    const inicial = ventaCompleta();
    const emitida = aplicar(inicial, { tipo: "enviar" }, { tipo: "emitida", generacion: inicial.generacion });
    esperarLimpia(emitida);
    expect(emitida.pendienteReinicio).toBe(true);
    expect(emitida.generacion).toBe(inicial.generacion + 1);
  });

  it("al volver a Nueva venta (pantalla oculta y mostrada otra vez) aparece limpia y habilitada", () => {
    const inicial = ventaCompleta();
    const emitida = aplicar(inicial, { tipo: "enviar" }, { tipo: "emitida", generacion: inicial.generacion });
    // Algo escrito durante la transición al comprobante también se descarta.
    const tocada = aplicar(emitida, { tipo: "validacion", errores: { general: "Agregue al menos un producto.", campos: {}, productos: {} } });
    const vuelta = aplicar(tocada, { tipo: "ocultar" });
    esperarLimpia(vuelta);
    expect(vuelta.pendienteReinicio).toBe(false);
  });

  it("ocultar sin emisión conserva la venta a medio completar", () => {
    const enCurso = ventaCompleta();
    expect(aplicar(enCurso, { tipo: "ocultar" })).toBe(enCurso);
  });

  it("la limpieza de useLayoutEffect despacha «ocultar» y marca la pantalla como no visible", () => {
    expect(fuente).toMatch(
      /useLayoutEffect\(\(\) => \{\s*visible\.current = true;\s*return \(\) => \{\s*visible\.current = false;\s*despachar\(\{ tipo: "ocultar" \}\);\s*\};\s*\}, \[\]\);/,
    );
  });

  it("tras emitir navega al comprobante con replace solo si la pantalla sigue visible", () => {
    expect(fuente).toMatch(/despachar\(\{ tipo: "emitida", generacion: generacionEnvio \}\);/);
    expect(fuente).toMatch(/if \(visible\.current\) router\.replace\(rutaComprobante\(resultado\.resultado\.id\)\);/);
    expect(fuente).not.toMatch(/location\.(reload|href)|Math\.random|randomUUID/);
  });
});

describe("Nueva venta: búsquedas, avisos y respuestas tardías", () => {
  it("los buscadores y el alta rápida se montan de nuevo en cada reinicio (key = generación)", () => {
    expect(fuente).toMatch(/<SelectorCliente\s+key=\{generacion\}/);
    expect(fuente).toMatch(/<BuscadorProductos\s+key=\{generacion\}/);
    expect(fuente).toMatch(/<AltaRapidaCliente\s+key=\{generacion\}/);
    // Al desmontarse (o al ocultarse), la búsqueda pendiente se cancela y su respuesta se ignora.
    expect(busqueda).toMatch(/return \(\) => \{\s*clearTimeout\(temporizador\);\s*control\.abort\(\);\s*\};/);
    expect(busqueda.match(/if \(!control\.signal\.aborted\)/g)).toHaveLength(2);
  });

  it("los avisos de la venta se cierran al emitir, al descartar y al salir de la pantalla", () => {
    expect(fuente).toMatch(/despachar\(\{ tipo: "emitida"[^\n]*\n\s*avisos\.limpiarGrupo\(GRUPO_AVISOS_VENTA\);/);
    expect(fuente).toMatch(/despachar\(\{ tipo: "descartar" \}\);\s*avisos\.limpiarGrupo\(GRUPO_AVISOS_VENTA\);/);
    expect(fuente).toContain("useEffect(() => () => avisos.limpiarGrupo(GRUPO_AVISOS_VENTA), []);");
  });

  it("una respuesta tardía de otro borrador no modifica el borrador nuevo", () => {
    const anterior = aplicar(ventaCompleta(), { tipo: "enviar" });
    const nuevo = ventaCompleta(aplicar(anterior, { tipo: "emitida", generacion: anterior.generacion }));
    const enviandoNuevo = aplicar(nuevo, { tipo: "enviar" });
    // Respuestas con la generación anterior: se ignoran.
    expect(aplicar(enviandoNuevo, { tipo: "emitida", generacion: anterior.generacion })).toBe(enviandoNuevo);
    expect(aplicar(enviandoNuevo, { tipo: "fallo", generacion: anterior.generacion, error: errorStock(nuevo.borrador) })).toBe(enviandoNuevo);
    expect(fuente).toContain("const generacionEnvio = generacion;");
  });
});

describe("Nueva venta: reenvíos", () => {
  it("no hay reenvío automático: el único POST sale de confirmar(), por botón o F9", () => {
    expect(fuente.match(/envio\.ejecutar\(/g)).toHaveLength(1);
    expect(fuente).toContain('onClick={() => void confirmar()}');
    expect(fuente).toContain('if (accion === "confirmar") void confirmar();');
    const efecto = fuente.match(/useLayoutEffect\([\s\S]*?\}, \[\]\);/)?.[0] ?? "";
    expect(efecto).not.toMatch(/confirmar|ejecutar|fetch/);
  });

  it("la venta emitida no puede reenviarse: su envío único queda bloqueado y el borrador limpio no se puede confirmar", async () => {
    const enviar = vi.fn(async () => ({ id: 1 }));
    const envio = crearEnvioUnico(enviar);
    expect((await envio.ejecutar("venta-1")).estado).toBe("ok");
    expect(await envio.ejecutar("venta-1")).toEqual({ estado: "ignorado" });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(construirCuerpoEmision(ventaInicial().borrador).ok).toBe(false);
  });

  it("una segunda venta genera un POST independiente: cada generación usa un envío único nuevo", async () => {
    const enviar = vi.fn(async (cuerpo: string) => ({ id: cuerpo === "venta-1" ? 1 : 2 }));
    const porGeneracion = new Map<number, ReturnType<typeof crearEnvioUnico<string, { id: number }>>>();
    const vigente = (g: number) => porGeneracion.get(g) ?? porGeneracion.set(g, crearEnvioUnico(enviar)).get(g)!;

    let estado = aplicar(ventaCompleta(), { tipo: "enviar" });
    const r1 = await vigente(estado.generacion).ejecutar("venta-1");
    estado = aplicar(estado, { tipo: "emitida", generacion: 0 }, { tipo: "ocultar" });
    estado = aplicar(ventaCompleta(estado), { tipo: "enviar" });
    const r2 = await vigente(estado.generacion).ejecutar("venta-2");
    expect([r1, r2]).toEqual([{ estado: "ok", resultado: { id: 1 } }, { estado: "ok", resultado: { id: 2 } }]);
    expect(enviar.mock.calls).toEqual([["venta-1"], ["venta-2"]]);
    expect(fuente).toMatch(/if \(envioRef\.current\?\.generacion !== generacion\) envioRef\.current = \{ generacion, envio: crearEnvioVenta\(\) \};/);
  });
});

describe("Nueva venta: emisión fallida y descarte", () => {
  it("una emisión fallida conserva el borrador (cliente e ítems), muestra los errores y reactiva el botón", () => {
    const completa = ventaCompleta();
    const fallida = aplicar(completa, { tipo: "enviar" }, { tipo: "fallo", generacion: completa.generacion, error: errorStock(completa.borrador) });
    expect(fallida.enviando).toBe(false);
    expect(fallida.borrador.cliente).toEqual(cliente);
    expect(fallida.borrador.renglones).toHaveLength(1);
    expect(fallida.errores.productos[1]).toContain("Existencia insuficiente");
    expect(fallida.generacion).toBe(completa.generacion);
    // Se puede corregir y reenviar.
    const corregida = aplicar(fallida, { tipo: "actualizar", cambio: (b) => b }, { tipo: "enviar" });
    expect(corregida.enviando).toBe(true);
    expect(corregida.errores.general).toBeNull();
  });

  it("una sesión vencida queda indicada y se limpia en el próximo intento", () => {
    const completa = ventaCompleta();
    const error = interpretarErrorEmision(new ErrorDeApi("Sesión vencida.", 401, "NO_AUTENTICADO"), completa.borrador);
    const vencida = aplicar(completa, { tipo: "enviar" }, { tipo: "fallo", generacion: completa.generacion, error });
    expect(vencida.sesionVencida).toBe(true);
    expect(aplicar(vencida, { tipo: "enviar" }).sesionVencida).toBe(false);
  });

  it("Descartar deja el mismo estado inicial limpio, sin solicitudes ni cambio de URL", () => {
    const conError = aplicar(ventaCompleta(), { tipo: "validacion", errores: { general: "x", campos: { "pago.montoRecibido": "y" }, productos: { 1: "z" } } }, { tipo: "confirmarDescarte", abierto: true });
    const descartada = aplicar(conError, { tipo: "descartar" });
    esperarLimpia(descartada);
    expect(descartada.generacion).toBe(conError.generacion + 1); // buscadores montados de nuevo
    expect(descartada.pendienteReinicio).toBe(false);
    const funcion = fuente.match(/function descartar\(\) \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(funcion).not.toMatch(/fetch|ejecutar|router\.|confirmar\(/);
  });
});

describe("Nueva venta: atajos y correcciones existentes", () => {
  it("F2, F4, F8 y F9 siguen resueltos y conectados; Enter y Escape quedan para la lista y la ventana", () => {
    const sinModal = { modalAbierto: false };
    expect(["F2", "F4", "F8", "F9"].map((key) => resolverAtajo({ key }, sinModal))).toEqual(["producto", "cliente", "pago", "confirmar"]);
    expect(resolverAtajo({ key: "Enter" }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "Escape" }, sinModal)).toBeNull();
    expect(fuente).toContain("resolverAtajo(e, { modalAbierto: altaAbierta || confirmandoDescarte })");
    expect(fuente).toContain('window.addEventListener("keydown", manejar);');
    const buscador = readFileSync(join(DIR, "buscador-productos.tsx"), "utf8");
    expect(buscador).toMatch(/"Enter"/);
    expect(buscador).toMatch(/"Escape"/);
  });

  it("la tabla de ítems conserva sus correcciones visuales", () => {
    const items = readFileSync(join(DIR, "items-venta.tsx"), "utf8");
    expect(items).toContain("export const COLUMNAS_ITEMS");
    expect(items).toContain("export const ANCHO_MINIMO_TABLA");
    expect(fuente).toContain("min-[90rem]:grid-cols-[minmax(0,1fr)_22rem]");
  });

  it("cacheComponents sigue activado", () => {
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).toMatch(/cacheComponents: true/);
  });
});
