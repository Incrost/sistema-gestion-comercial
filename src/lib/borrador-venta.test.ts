/**
 * Pruebas del borrador de Nueva venta (src/lib/borrador-venta.ts).
 *
 * Son funciones puras: no hay base de datos ni navegador. La única llamada
 * de red (enviarVenta) se prueba reemplazando `fetch`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientePublico } from "@/servicios/clientes";
import type { ProductoPublico } from "@/servicios/productos";

import {
  ALTA_RAPIDA_INICIAL,
  ATAJOS,
  actualizarExistencias,
  actualizarPago,
  agregarProducto,
  borradorInicial,
  calcularRenglones,
  cambiarCantidad,
  cambiarFormaPago,
  cantidadMaxima,
  clientesSeleccionables,
  construirCuerpoEmision,
  crearEnvioUnico,
  descartarVenta,
  enviarVenta,
  estadoDeResultados,
  evaluarContado,
  evaluarCuentaCorriente,
  interpretarErrorEmision,
  MENSAJE_DESCARTE,
  moverIndice,
  PAGO_INICIAL,
  prepararAltaRapida,
  productosVendibles,
  quitarCliente,
  quitarRenglon,
  resolverAtajo,
  rutaComprobante,
  seleccionarCliente,
  subtotalEstimado,
  tieneDatos,
  totalEstimado,
  urlBusquedaClientes,
  urlBusquedaProductos,
  validarCantidad,
  validarTarjeta,
  type BorradorVenta,
  type ClienteVenta,
  type ProductoVenta,
} from "./borrador-venta";
import { ErrorDeApi } from "./cliente-api";
import { CANTIDAD_MAXIMA_POR_RENGLON, esquemaEmisionFactura, RENGLONES_MAXIMOS } from "./validacion-facturas";

// ---------------------------------------------------------------------------
// Datos de ejemplo
// ---------------------------------------------------------------------------

const martillo: ProductoVenta = { id: 1, codigo: "HE-001", descripcion: "Martillo carpintero 500 g", precio: 1_250_000, existencia: 5 };
const cinta: ProductoVenta = { id: 4, codigo: "EL-001", descripcion: "Cinta aisladora 20 m", precio: 190_050, existencia: 10 };
const agotado: ProductoVenta = { id: 9, codigo: "PI-009", descripcion: "Pincel 2 pulgadas", precio: 50_000, existencia: 0 };

const conCuenta: ClienteVenta = {
  id: 7,
  nombre: "Mariana López",
  tipoDoc: "DNI",
  nroDoc: "28.456.123",
  saldo: 1_000_000,
  cuentaCorriente: true,
  limiteCredito: 3_000_000,
  disponible: 2_000_000,
};
const sinCuenta: ClienteVenta = { ...conCuenta, id: 8, nombre: "Pedro Gómez", cuentaCorriente: false, limiteCredito: null, disponible: null };

/** Agrega productos y falla la prueba si alguno no se puede agregar. */
function conItems(b: BorradorVenta, ...items: [ProductoVenta, string][]): BorradorVenta {
  return items.reduce((actual, [producto, cantidad]) => {
    const r = agregarProducto(actual, producto, cantidad);
    if (!r.ok) throw new Error(r.mensaje);
    return r.borrador;
  }, b);
}

const conTarjeta = (b: BorradorVenta, campos: Partial<BorradorVenta["pago"]>) =>
  actualizarPago(cambiarFormaPago(b, "tarjeta"), campos);

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Comprador
// ---------------------------------------------------------------------------

describe("comprador (RF-V2)", () => {
  it("inicia con consumidor final, sin ítems y de contado", () => {
    const b = borradorInicial();
    expect(b.cliente).toBeNull();
    expect(b.renglones).toEqual([]);
    expect(b.pago).toEqual(PAGO_INICIAL);
    expect(b.pago.forma).toBe("contado");
    expect(tieneDatos(b)).toBe(false);
  });

  it("selecciona y quita un cliente sin perder los ítems", () => {
    const b = conItems(borradorInicial(), [martillo, "2"]);
    const conCliente = seleccionarCliente(b, conCuenta);
    expect(conCliente.cliente).toEqual(conCuenta);
    expect(conCliente.renglones).toEqual(b.renglones);
    const sinCliente = quitarCliente(conCliente);
    expect(sinCliente.cliente).toBeNull();
    expect(sinCliente.renglones).toEqual(b.renglones);
  });

  it("alta rápida: el cliente creado se selecciona y los ítems se conservan", () => {
    const b = conItems(borradorInicial(), [martillo, "1"], [cinta, "3"]);
    const creado: ClientePublico = {
      id: 99, tipoDoc: "CUIT", nroDoc: "20-28456123-4", nombre: "Ferretería Sur", domicilio: null, telefono: null,
      email: null, cuentaCorriente: true, limiteCredito: null, saldo: 0, disponible: null, activo: true,
    };
    const [seleccionable] = clientesSeleccionables([creado]);
    const despues = seleccionarCliente(b, seleccionable);
    expect(despues.cliente?.id).toBe(99);
    expect(despues.renglones).toEqual(b.renglones);
    expect(despues.pago).toEqual(b.pago);
  });

  it("quitar el cliente o elegir uno sin cuenta corriente vuelve el pago a contado", () => {
    const b = cambiarFormaPago(seleccionarCliente(conItems(borradorInicial(), [martillo, "1"]), conCuenta), "cuenta_corriente");
    expect(quitarCliente(b).pago.forma).toBe("contado");
    expect(seleccionarCliente(b, sinCuenta).pago.forma).toBe("contado");
    expect(seleccionarCliente(b, conCuenta).pago.forma).toBe("cuenta_corriente");
  });

  it("búsqueda de clientes por nombre o documento con GET /api/clientes, sin inactivos", () => {
    expect(urlBusquedaClientes("  López ")).toBe("/api/clientes?q=L%C3%B3pez&pageSize=10");
    expect(urlBusquedaClientes("28.456.123")).toBe("/api/clientes?q=28.456.123&pageSize=10");
    expect(urlBusquedaClientes("   ")).toBeNull();
    expect(urlBusquedaClientes("x")).not.toContain("activo");
    const base = { tipoDoc: "DNI", nroDoc: "1", domicilio: null, telefono: null, email: null, cuentaCorriente: false, limiteCredito: null, saldo: 0, disponible: null } as const;
    const lista: ClientePublico[] = [
      { ...base, id: 1, nombre: "Activo", activo: true },
      { ...base, id: 2, nombre: "Inactivo", activo: false },
    ];
    expect(clientesSeleccionables(lista).map((c) => c.id)).toEqual([1]);
  });

  it("alta rápida admite todos los campos de RF-C2 y el límite con cuenta corriente", () => {
    const r = prepararAltaRapida({
      tipoDoc: "DNI", nroDoc: "30.111.222", nombre: "Ana Ruiz", domicilio: "Mitre 10", telefono: "381 555-0000",
      email: "ana@ejemplo.test", cuentaCorriente: true, limiteCredito: "150.000,50",
    });
    expect(r).toEqual({
      ok: true,
      cuerpo: {
        tipoDoc: "DNI", nroDoc: "30.111.222", nombre: "Ana Ruiz", domicilio: "Mitre 10", telefono: "381 555-0000",
        email: "ana@ejemplo.test", cuentaCorriente: true, limiteCredito: 15_000_050,
      },
    });
    // Sin cuenta corriente el límite no se envía.
    const sin = prepararAltaRapida({ ...ALTA_RAPIDA_INICIAL, nroDoc: "30111222", nombre: "Ana", limiteCredito: "100" });
    expect(sin.ok && sin.cuerpo.limiteCredito).toBeNull();
  });

  it("alta rápida muestra los errores junto a cada campo", () => {
    const r = prepararAltaRapida({ ...ALTA_RAPIDA_INICIAL, nroDoc: "12", email: "no-es-email" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores.nroDoc).toBeDefined();
    expect(r.errores.nombre).toBe("Es obligatorio.");
    expect(r.errores.email).toBeDefined();
    const limite = prepararAltaRapida({ ...ALTA_RAPIDA_INICIAL, nroDoc: "30111222", nombre: "Ana", cuentaCorriente: true, limiteCredito: "12.5" });
    expect(limite).toEqual({ ok: false, errores: { limiteCredito: expect.any(String) } });
  });
});

// ---------------------------------------------------------------------------
// Productos e ítems
// ---------------------------------------------------------------------------

describe("productos e ítems (RF-V3, RF-V4)", () => {
  it("búsqueda por código o descripción con GET /api/productos (activos por defecto)", () => {
    expect(urlBusquedaProductos("HE-001")).toBe("/api/productos?q=HE-001&pageSize=10");
    expect(urlBusquedaProductos("martillo carpintero")).toBe("/api/productos?q=martillo+carpintero&pageSize=10");
    expect(urlBusquedaProductos("")).toBeNull();
    const base = { categoria: { id: 1, nombre: "H" }, precio: 100, existencia: 1, stockMinimo: 0, bajoMinimo: false };
    const lista: ProductoPublico[] = [
      { ...base, id: 1, codigo: "A", descripcion: "Activo", activo: true },
      { ...base, id: 2, codigo: "B", descripcion: "Inactivo", activo: false },
    ];
    expect(productosVendibles(lista)).toEqual([{ id: 1, codigo: "A", descripcion: "Activo", precio: 100, existencia: 1 }]);
  });

  it("agrega un producto con la cantidad indicada", () => {
    const b = conItems(borradorInicial(), [martillo, "2"]);
    expect(b.renglones).toEqual([{ producto: martillo, cantidad: "2" }]);
  });

  it("un producto repetido suma la cantidad en el mismo renglón", () => {
    const b = conItems(borradorInicial(), [martillo, "2"], [cinta, "1"], [martillo, "3"]);
    expect(b.renglones).toHaveLength(2);
    expect(b.renglones[0]).toEqual({ producto: martillo, cantidad: "5" });
    // El cuerpo nunca lleva productos repetidos (el servidor los rechaza).
    const r = construirCuerpoEmision(b);
    expect(r.ok && r.cuerpo.items).toEqual([{ productoId: 1, cantidad: 5 }, { productoId: 4, cantidad: 1 }]);
  });

  it("la suma de un repetido no puede superar la existencia", () => {
    const b = conItems(borradorInicial(), [martillo, "4"]);
    const r = agregarProducto(b, martillo, "2");
    expect(r).toEqual({ ok: false, mensaje: "Ya hay 4 en la venta. Supera la existencia disponible (5)." });
  });

  it("modifica la cantidad de un renglón", () => {
    const b = cambiarCantidad(conItems(borradorInicial(), [martillo, "1"]), martillo.id, "3");
    expect(b.renglones[0].cantidad).toBe("3");
    expect(calcularRenglones(b)[0]).toMatchObject({ cantidad: 3, error: null, subtotal: 3_750_000 });
  });

  it("quita un renglón", () => {
    const b = quitarRenglon(conItems(borradorInicial(), [martillo, "1"], [cinta, "1"]), martillo.id);
    expect(b.renglones.map((r) => r.producto.id)).toEqual([cinta.id]);
  });

  it.each([
    ["", "Indique la cantidad."],
    ["0", "Debe ser mayor que 0."],
    ["-2", "Debe ser mayor que 0."],
    ["1.5", "Debe ser un número entero."],
    ["2,5", "Debe ser un número entero."],
    ["abc", "Debe ser un número entero."],
    ["1e2", "Debe ser un número entero."],
  ])("impide la cantidad inválida %j", (texto, mensaje) => {
    expect(validarCantidad(texto, cinta)).toEqual({ ok: false, mensaje });
    expect(agregarProducto(borradorInicial(), cinta, texto).ok).toBe(false);
    const b = cambiarCantidad(conItems(borradorInicial(), [cinta, "1"]), cinta.id, texto);
    expect(calcularRenglones(b)[0]).toMatchObject({ cantidad: null, error: mensaje, subtotal: null });
    expect(construirCuerpoEmision(b)).toMatchObject({ ok: false, errores: { productos: { [cinta.id]: mensaje } } });
  });

  it("impide superar la existencia consultada", () => {
    expect(validarCantidad("6", martillo)).toEqual({ ok: false, mensaje: "Supera la existencia disponible (5)." });
    expect(validarCantidad("5", martillo)).toEqual({ ok: true, cantidad: 5 });
    expect(agregarProducto(borradorInicial(), agotado, "1")).toEqual({ ok: false, mensaje: "El producto no tiene existencia disponible." });
    const b = cambiarCantidad(conItems(borradorInicial(), [martillo, "1"]), martillo.id, "6");
    expect(construirCuerpoEmision(b).ok).toBe(false);
    expect(cantidadMaxima(martillo)).toBe(5);
  });

  it("la cantidad máxima es la misma que la de validacion-facturas.ts", () => {
    const enorme: ProductoVenta = { ...cinta, precio: 1, existencia: CANTIDAD_MAXIMA_POR_RENGLON + 50 };
    expect(cantidadMaxima(enorme)).toBe(CANTIDAD_MAXIMA_POR_RENGLON);
    expect(validarCantidad(String(CANTIDAD_MAXIMA_POR_RENGLON), enorme).ok).toBe(true);
    expect(validarCantidad(String(CANTIDAD_MAXIMA_POR_RENGLON + 1), enorme)).toEqual({
      ok: false,
      mensaje: `No puede superar ${CANTIDAD_MAXIMA_POR_RENGLON} unidades.`,
    });
  });

  it("no admite más renglones que RENGLONES_MAXIMOS", () => {
    let b = borradorInicial();
    for (let i = 1; i <= RENGLONES_MAXIMOS; i++) b = conItems(b, [{ ...cinta, id: i, codigo: `C-${i}` }, "1"]);
    expect(agregarProducto(b, { ...cinta, id: 1000 }, "1").ok).toBe(false);
  });

  it("subtotal y total estimados en centavos enteros", () => {
    const b = conItems(borradorInicial(), [martillo, "2"], [cinta, "3"]);
    const r = calcularRenglones(b);
    expect(r.map((x) => x.subtotal)).toEqual([2_500_000, 570_150]);
    expect(totalEstimado(b)).toBe(3_070_150);
    expect(Number.isInteger(totalEstimado(b))).toBe(true);
    expect(subtotalEstimado(Number.MAX_SAFE_INTEGER, 2)).toBeNull();
  });

  it("actualiza la existencia informada por el servidor y marca el exceso", () => {
    const b = actualizarExistencias(conItems(borradorInicial(), [martillo, "4"], [cinta, "1"]), [{ productoId: martillo.id, disponible: 2 }]);
    expect(b.renglones[0].producto.existencia).toBe(2);
    expect(b.renglones[0].cantidad).toBe("4"); // la venta se conserva
    expect(calcularRenglones(b)[0].error).toBe("Supera la existencia disponible (2).");
    expect(b.renglones[1].producto.existencia).toBe(10);
  });

  it("estados de una búsqueda: vacío y resultados", () => {
    expect(estadoDeResultados([])).toEqual({ tipo: "vacio" });
    expect(estadoDeResultados([martillo])).toEqual({ tipo: "resultados", datos: [martillo] });
  });

  it("recorre los resultados con las flechas de forma circular", () => {
    expect(moverIndice(0, 1, 3)).toBe(1);
    expect(moverIndice(2, 1, 3)).toBe(0);
    expect(moverIndice(0, -1, 3)).toBe(2);
    expect(moverIndice(0, 1, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Forma de pago
// ---------------------------------------------------------------------------

describe("forma de pago (RF-V5)", () => {
  const venta = () => conItems(borradorInicial(), [martillo, "1"]); // total 1.250.000

  it("contado sin monto envía solo la forma (el servidor toma el total)", () => {
    const r = construirCuerpoEmision(venta());
    expect(r).toEqual({ ok: true, cuerpo: { clienteId: null, items: [{ productoId: 1, cantidad: 1 }], pago: { forma: "contado" } } });
  });

  it("calcula el vuelto estimado y envía el monto en centavos", () => {
    expect(evaluarContado("15.000,50", 1_250_000)).toEqual({ ok: true, montoRecibido: 1_500_050, vuelto: 250_050 });
    expect(evaluarContado("", 1_250_000)).toEqual({ ok: true, montoRecibido: null, vuelto: 0 });
    const r = construirCuerpoEmision(actualizarPago(venta(), { montoRecibido: "20000" }));
    expect(r.ok && r.cuerpo.pago).toEqual({ forma: "contado", montoRecibido: 2_000_000 });
  });

  it("un monto insuficiente o inválido bloquea la confirmación con un mensaje", () => {
    expect(evaluarContado("10000", 1_250_000)).toEqual({
      ok: false,
      mensaje: "El monto recibido no cubre el total estimado: faltan $ 2.500,00.",
    });
    expect(evaluarContado("12.5", 100).ok).toBe(false);
    expect(evaluarContado("0", 100)).toEqual({ ok: false, mensaje: "Debe ser mayor que 0." });
    const r = construirCuerpoEmision(actualizarPago(venta(), { montoRecibido: "10000" }));
    expect(r).toMatchObject({ ok: false, errores: { campos: { "pago.montoRecibido": expect.stringContaining("faltan") } } });
  });

  it("tarjeta exige tipo, marca y últimos cuatro dígitos", () => {
    const vacia = construirCuerpoEmision(conTarjeta(venta(), {}));
    expect(vacia.ok).toBe(false);
    if (!vacia.ok) {
      expect(Object.keys(vacia.errores.campos).sort()).toEqual(["pago.tarjeta.marca", "pago.tarjeta.tipo", "pago.tarjeta.ultimos4"]);
      expect(vacia.errores.campos["pago.tarjeta.tipo"]).toBe("Seleccione débito o crédito.");
    }
    expect(validarTarjeta({ ...PAGO_INICIAL, forma: "tarjeta", tarjetaTipo: "debito", tarjetaMarca: "Visa", tarjetaUltimos4: "123" })).toEqual({
      "pago.tarjeta.ultimos4": "Debe tener exactamente 4 dígitos.",
    });
    const ok = construirCuerpoEmision(conTarjeta(venta(), { tarjetaTipo: "credito", tarjetaMarca: "Visa", tarjetaUltimos4: "4242" }));
    expect(ok.ok && ok.cuerpo.pago).toEqual({ forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Visa", ultimos4: "4242" } });
  });

  it("nunca solicita ni envía el número completo de la tarjeta", () => {
    // El borrador no tiene campo para el número completo, el CVV ni el vencimiento.
    expect(Object.keys(PAGO_INICIAL).sort()).toEqual(["forma", "montoRecibido", "tarjetaMarca", "tarjetaTipo", "tarjetaUltimos4"]);
    const ok = construirCuerpoEmision(conTarjeta(venta(), { tarjetaTipo: "debito", tarjetaMarca: "Cabal", tarjetaUltimos4: "0001" }));
    expect(ok.ok).toBe(true);
    if (!ok.ok || ok.cuerpo.pago.forma !== "tarjeta") return;
    expect(Object.keys(ok.cuerpo.pago.tarjeta).sort()).toEqual(["marca", "tipo", "ultimos4"]);
    expect(JSON.stringify(ok.cuerpo)).not.toMatch(/numero|cvv|vencimiento|codigoSeguridad/i);
    // Una marca con un número de tarjeta se rechaza.
    expect(validarTarjeta({ ...PAGO_INICIAL, forma: "tarjeta", tarjetaTipo: "debito", tarjetaMarca: "4242 4242", tarjetaUltimos4: "4242" })).toHaveProperty(
      "pago.tarjeta.marca",
    );
  });

  it("al cambiar de forma de pago se descartan los datos de la tarjeta", () => {
    const b = cambiarFormaPago(conTarjeta(venta(), { tarjetaTipo: "debito", tarjetaMarca: "Visa", tarjetaUltimos4: "4242" }), "contado");
    expect(b.pago).toEqual(PAGO_INICIAL);
  });

  it("cuenta corriente requiere un cliente registrado", () => {
    expect(evaluarCuentaCorriente(null, 100)).toMatchObject({ habilitada: false, motivo: expect.stringContaining("cliente registrado") });
    const r = construirCuerpoEmision(cambiarFormaPago(venta(), "cuenta_corriente"));
    expect(r).toMatchObject({ ok: false, errores: { campos: { "pago.forma": expect.any(String) } } });
  });

  it("cuenta corriente requiere la cuenta habilitada", () => {
    expect(evaluarCuentaCorriente(sinCuenta, 100)).toEqual({
      habilitada: false,
      motivo: "El cliente no tiene la cuenta corriente habilitada.",
      advertencia: null,
    });
    const r = construirCuerpoEmision(cambiarFormaPago(seleccionarCliente(venta(), sinCuenta), "cuenta_corriente"));
    expect(r.ok).toBe(false);
    const ok = construirCuerpoEmision(cambiarFormaPago(seleccionarCliente(venta(), conCuenta), "cuenta_corriente"));
    expect(ok).toEqual({ ok: true, cuerpo: { clienteId: 7, items: [{ productoId: 1, cantidad: 1 }], pago: { forma: "cuenta_corriente" } } });
  });

  it("advierte (sin bloquear) si el total estimado supera el crédito disponible", () => {
    expect(evaluarCuentaCorriente(conCuenta, 2_000_000).advertencia).toBeNull();
    expect(evaluarCuentaCorriente(conCuenta, 2_000_001).advertencia).toContain("supera el crédito disponible ($ 20.000,00)");
    expect(evaluarCuentaCorriente({ ...conCuenta, limiteCredito: null, disponible: null }, 999_999_999).advertencia).toBeNull();
    // El servidor decide: el cuerpo se arma igual.
    const b = cambiarFormaPago(seleccionarCliente(conItems(borradorInicial(), [martillo, "2"]), conCuenta), "cuenta_corriente");
    expect(construirCuerpoEmision(b).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Confirmación
// ---------------------------------------------------------------------------

describe("confirmación (RF-V6)", () => {
  it("el cuerpo no incluye precios, subtotales, total ni datos del catálogo", () => {
    const b = conTarjeta(seleccionarCliente(conItems(borradorInicial(), [martillo, "2"], [cinta, "1"]), conCuenta), {
      tarjetaTipo: "debito", tarjetaMarca: "Visa", tarjetaUltimos4: "1234",
    });
    const r = construirCuerpoEmision(b);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.cuerpo).sort()).toEqual(["clienteId", "items", "pago"]);
    for (const item of r.cuerpo.items) expect(Object.keys(item).sort()).toEqual(["cantidad", "productoId"]);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/precio|subtotal|total|codigo|descripcion|existencia|saldo/i);
    // Y es aceptado por el MISMO esquema del servidor.
    expect(esquemaEmisionFactura.safeParse(r.cuerpo).success).toBe(true);
  });

  it("exige al menos un ítem", () => {
    expect(construirCuerpoEmision(borradorInicial())).toMatchObject({
      ok: false,
      errores: { general: expect.any(String), campos: { items: "Debe agregar al menos un producto." } },
    });
  });

  it("evita la confirmación doble", async () => {
    let resolver!: (valor: { id: number }) => void;
    const enviar = vi.fn(() => new Promise<{ id: number }>((r) => (resolver = r)));
    const envio = crearEnvioUnico(enviar);
    const primero = envio.ejecutar("venta");
    expect(envio.ocupado).toBe(true);
    expect(await envio.ejecutar("venta")).toEqual({ estado: "ignorado" });
    resolver({ id: 5 });
    expect(await primero).toEqual({ estado: "ok", resultado: { id: 5 } });
    // Tras el éxito sigue bloqueado: la venta no puede reenviarse.
    expect(await envio.ejecutar("venta")).toEqual({ estado: "ignorado" });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("después de un error se libera para corregir y reintentar", async () => {
    const enviar = vi.fn().mockRejectedValueOnce(new Error("falla")).mockResolvedValueOnce({ id: 1 });
    const envio = crearEnvioUnico(enviar);
    expect((await envio.ejecutar(1)).estado).toBe("error");
    expect(envio.ocupado).toBe(false);
    expect((await envio.ejecutar(1)).estado).toBe("ok");
  });

  it("POST /api/facturas es la única confirmación y el éxito lleva al comprobante", async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ id: 1233, numeroFormateado: "0001-00001233" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchFalso);
    const r = construirCuerpoEmision(conItems(borradorInicial(), [martillo, "1"]));
    if (!r.ok) throw new Error("cuerpo inválido");
    const factura = await enviarVenta(r.cuerpo);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/facturas");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ clienteId: null, items: [{ productoId: 1, cantidad: 1 }], pago: { forma: "contado" } });
    expect(rutaComprobante(factura.id)).toBe("/ventas/1233");
  });

  it("un error de la API se traduce sin modificar la venta", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { code: "MONTO_INSUFICIENTE", message: "El monto recibido no cubre el total.", details: { campo: "pago.montoRecibido", total: 1_250_000, montoRecibido: 1_000_000, faltante: 250_000 } } }), { status: 422 }),
    );
    const b = actualizarPago(conItems(borradorInicial(), [martillo, "1"]), { montoRecibido: "12500" });
    const copia = structuredClone(b);
    const error = await enviarVenta({ clienteId: null, items: [{ productoId: 1, cantidad: 1 }], pago: { forma: "contado", montoRecibido: 1_000_000 } }).catch((e) => e);
    const i = interpretarErrorEmision(error, b);
    expect(i.code).toBe("MONTO_INSUFICIENTE");
    expect(i.campos["pago.montoRecibido"]).toBe("El monto recibido no cubre el total de $ 12.500,00: faltan $ 2.500,00.");
    expect(b).toEqual(copia);
  });

  it("STOCK_INSUFICIENTE se muestra por producto con lo solicitado y lo disponible", () => {
    const b = conItems(borradorInicial(), [martillo, "4"], [cinta, "2"]);
    const error = new ErrorDeApi("La existencia no alcanza para varios productos.", 409, "STOCK_INSUFICIENTE", {}, [
      { productoId: 1, solicitado: 4, disponible: 1 },
      { productoId: 4, solicitado: 2, disponible: 0 },
    ]);
    const i = interpretarErrorEmision(error, b);
    expect(i.productos).toEqual({
      1: "Existencia insuficiente: solicitado 4, disponible 1.",
      4: "Existencia insuficiente: solicitado 2, disponible 0.",
    });
    expect(i.faltantes).toHaveLength(2);
    expect(i.general).toContain("ajuste las cantidades");
  });

  it("las validaciones del servidor se muestran por campo y por renglón", () => {
    const b = conItems(borradorInicial(), [martillo, "1"], [cinta, "1"]);
    const validacion = new ErrorDeApi("Hay campos inválidos.", 422, "VALIDACION", {
      "items.1.cantidad": "Debe ser un número entero.",
      "pago.tarjeta.marca": "Es obligatorio.",
    });
    const i = interpretarErrorEmision(validacion, b);
    expect(i.productos).toEqual({ 4: "Debe ser un número entero." });
    expect(i.campos).toEqual({ "pago.tarjeta.marca": "Es obligatorio." });
    expect(i.general).toBe("Hay campos inválidos.");

    const inactivo = new ErrorDeApi("El producto está dado de baja.", 422, "PRODUCTO_INACTIVO", {}, [
      { campo: "items.0.productoId", productoId: 1, mensaje: "El producto está dado de baja." },
    ]);
    expect(interpretarErrorEmision(inactivo, b).productos).toEqual({ 1: "El producto está dado de baja." });

    const cuenta = new ErrorDeApi("Cuenta corriente no habilitada.", 422, "CUENTA_CORRIENTE_NO_HABILITADA", {
      clienteId: "Para vender a cuenta corriente debe seleccionar un cliente.",
    });
    expect(interpretarErrorEmision(cuenta, b).campos).toEqual({ clienteId: "Para vender a cuenta corriente debe seleccionar un cliente." });

    const limite = new ErrorDeApi("La venta supera el límite de crédito del cliente.", 422, "LIMITE_CREDITO_EXCEDIDO", {}, {
      saldoActual: 1_000_000, limite: 3_000_000, total: 2_500_000, excedente: 500_000,
    });
    expect(interpretarErrorEmision(limite, b).general).toBe(
      "La venta supera el límite de crédito del cliente. Saldo actual: $ 10.000,00 · Límite: $ 30.000,00 · Excedente: $ 5.000,00.",
    );

    const sesion = interpretarErrorEmision(new ErrorDeApi("La sesión no existe o ha vencido.", 401, "NO_AUTENTICADO"), b);
    expect(sesion).toMatchObject({ sesionVencida: true, general: "La sesión no existe o ha vencido." });

    expect(interpretarErrorEmision(new TypeError("x"), b).general).toContain("no se registró");
  });
});

// ---------------------------------------------------------------------------
// Descartar y atajos
// ---------------------------------------------------------------------------

describe("descartar venta", () => {
  it("exige confirmación cuando hay datos cargados", () => {
    const b = conItems(borradorInicial(), [martillo, "1"]);
    const confirmar = vi.fn(() => false);
    expect(descartarVenta(b, confirmar)).toBeNull();
    expect(confirmar).toHaveBeenCalledWith(MENSAJE_DESCARTE);
    expect(descartarVenta(b, () => true)).toEqual(borradorInicial());
  });

  it("no pregunta si la venta está vacía", () => {
    const confirmar = vi.fn(() => true);
    expect(descartarVenta(borradorInicial(), confirmar)).toEqual(borradorInicial());
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("considera datos cargados el cliente, los ítems y la forma de pago", () => {
    expect(tieneDatos(seleccionarCliente(borradorInicial(), conCuenta))).toBe(true);
    expect(tieneDatos(cambiarFormaPago(borradorInicial(), "tarjeta"))).toBe(true);
    expect(tieneDatos(actualizarPago(borradorInicial(), { montoRecibido: "100" }))).toBe(true);
  });
});

describe("atajos de teclado", () => {
  it("F2, F4, F8 y F9", () => {
    const sinModal = { modalAbierto: false };
    expect(resolverAtajo({ key: "F2" }, sinModal)).toBe("producto");
    expect(resolverAtajo({ key: "F4" }, sinModal)).toBe("cliente");
    expect(resolverAtajo({ key: "F8" }, sinModal)).toBe("pago");
    expect(resolverAtajo({ key: "F9" }, sinModal)).toBe("confirmar");
    expect(ATAJOS.map((a) => a.tecla)).toEqual(["F2", "F4", "F8", "F9"]);
  });

  it("no interfiere con el texto, con combinaciones ni con la ventana modal", () => {
    const sinModal = { modalAbierto: false };
    expect(resolverAtajo({ key: "a" }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "Enter" }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "Escape" }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "F5" }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "F4", altKey: true }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "F2", ctrlKey: true }, sinModal)).toBeNull();
    expect(resolverAtajo({ key: "F9" }, { modalAbierto: true })).toBeNull();
  });
});
