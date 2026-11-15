/**
 * Pruebas de renderizado de los componentes de Nueva venta.
 *
 * Se usan con react-dom/server (ya incluido en el proyecto) para comprobar
 * el HTML inicial sin agregar bibliotecas de pruebas de componentes: los
 * comportamientos (agregar, sumar, validar, enviar, atajos) se prueban como
 * funciones puras en src/lib/borrador-venta.test.ts.
 */
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  actualizarPago,
  agregarProducto,
  borradorInicial,
  calcularRenglones,
  cambiarFormaPago,
  PAGO_INICIAL,
  type ClienteVenta,
  type EstadoBusqueda,
} from "@/lib/borrador-venta";

import { MensajeBusqueda } from "./estado-busqueda";
import { FormaPago } from "./forma-pago";
import { ItemsVenta } from "./items-venta";
import { SelectorCliente } from "./selector-cliente";

const nada = () => {};
const cliente: ClienteVenta = {
  id: 7, nombre: "Mariana López", tipoDoc: "DNI", nroDoc: "28456123", saldo: 1_000_000,
  cuentaCorriente: true, limiteCredito: 3_000_000, disponible: 2_000_000,
};

const selector = (c: ClienteVenta | null) =>
  renderToStaticMarkup(
    createElement(SelectorCliente, { cliente: c, onSeleccionar: nada, onQuitar: nada, onAltaRapida: nada, busquedaRef: createRef<HTMLInputElement>() }),
  );

const formaPago = (pago = PAGO_INICIAL, c: ClienteVenta | null = null, total = 0, errores = {}) =>
  renderToStaticMarkup(createElement(FormaPago, { pago, cliente: c, total, errores, onCambiarForma: nada, onActualizar: nada }));

describe("SelectorCliente", () => {
  it("inicia con consumidor final y ofrece búsqueda y alta rápida", () => {
    const html = selector(null);
    expect(html).toContain("Consumidor final");
    expect(html).toContain("Buscar cliente");
    expect(html).toContain("(F4)");
    expect(html).toContain("Alta rápida de cliente");
    expect(html).toContain("Escriba para buscar entre los clientes activos.");
  });

  it("muestra nombre, documento, saldo, cuenta corriente, límite y disponible del cliente", () => {
    const html = selector(cliente);
    for (const texto of ["Mariana López", "28.456.123", "$ 10.000,00", "Habilitada", "$ 30.000,00", "$ 20.000,00", "Quitar cliente"]) {
      expect(html).toContain(texto);
    }
  });
});

describe("FormaPago", () => {
  it("contado: monto opcional y vuelto estimado", () => {
    const html = formaPago(actualizarPago(borradorInicial(), { montoRecibido: "150" }).pago, null, 10_000);
    expect(html).toContain("Monto recibido");
    expect(html).toContain("Vuelto estimado: <strong>$ 50,00</strong>");
  });

  it("contado: un monto insuficiente muestra el error", () => {
    const html = formaPago({ ...PAGO_INICIAL, montoRecibido: "50" }, null, 10_000);
    expect(html).toContain("no cubre el total estimado");
    expect(html).not.toContain("Vuelto estimado");
  });

  it("tarjeta: solo tipo, marca y últimos 4; nunca número completo, CVV ni vencimiento", () => {
    const html = formaPago(cambiarFormaPago(borradorInicial(), "tarjeta").pago);
    expect(html).toContain("Tipo");
    expect(html).toContain("Marca");
    expect(html).toContain("Últimos 4 dígitos");
    expect(html).toContain('maxLength="4"');
    // Solo tres campos de tarjeta: un select y dos inputs de texto.
    const campos = html.match(/id="tarjeta-[a-z0-9]+"/g) ?? [];
    expect(campos.sort()).toEqual(['id="tarjeta-marca"', 'id="tarjeta-tipo"', 'id="tarjeta-ultimos4"']);
    expect(html).not.toMatch(/cc-number|cc-csc|cc-exp|name="(numero|cvv|vencimiento)"/i);
  });

  it("cuenta corriente deshabilitada sin cliente o sin habilitación", () => {
    expect(formaPago()).toMatch(/<input type="radio" disabled=""[^>]*value="cuenta_corriente"/);
    expect(formaPago()).toContain("Seleccione un cliente registrado");
    const sinCuenta = formaPago(PAGO_INICIAL, { ...cliente, cuentaCorriente: false });
    expect(sinCuenta).toMatch(/<input type="radio" disabled=""[^>]*value="cuenta_corriente"/);
    expect(sinCuenta).toContain("no tiene la cuenta corriente habilitada");
    expect(formaPago(PAGO_INICIAL, cliente)).not.toMatch(/<input type="radio" disabled=""[^>]*value="cuenta_corriente"/);
  });

  it("cuenta corriente: muestra saldo, límite, disponible y advierte el exceso", () => {
    const html = formaPago({ ...PAGO_INICIAL, forma: "cuenta_corriente" }, cliente, 2_500_000);
    expect(html).toContain("Crédito disponible");
    expect(html).toContain("supera el crédito disponible");
  });

  it("muestra los errores del servidor junto al campo", () => {
    const html = formaPago(cambiarFormaPago(borradorInicial(), "tarjeta").pago, null, 0, { "pago.tarjeta.marca": "Es obligatorio." });
    expect(html).toContain("Es obligatorio.");
  });
});

describe("ItemsVenta", () => {
  it("estado vacío", () => {
    const html = renderToStaticMarkup(
      createElement(ItemsVenta, { renglones: [], erroresServidor: {}, total: 0, onCambiarCantidad: nada, onQuitar: nada }),
    );
    expect(html).toContain("Todavía no hay productos en la venta");
    expect(html).toContain("Total estimado: <strong>$ 0,00</strong>");
    expect(html).toContain("el servidor los recalcula");
  });

  it("renglón con código, descripción, cantidad, precio, subtotal, existencia y error por producto", () => {
    const r = agregarProducto(borradorInicial(), { id: 1, codigo: "HE-001", descripcion: "Martillo", precio: 1_250_000, existencia: 5 }, "2");
    if (!r.ok) throw new Error(r.mensaje);
    const html = renderToStaticMarkup(
      createElement(ItemsVenta, {
        renglones: calcularRenglones(r.borrador),
        erroresServidor: { 1: "Existencia insuficiente: solicitado 2, disponible 1." },
        total: 2_500_000,
        onCambiarCantidad: nada,
        onQuitar: nada,
      }),
    );
    for (const texto of ["HE-001", "Martillo", 'value="2"', 'max="5"', "$ 12.500,00", "$ 25.000,00", "solicitado 2, disponible 1", "Quitar"]) {
      expect(html).toContain(texto);
    }
  });
});

describe("MensajeBusqueda", () => {
  const mensaje = (estado: EstadoBusqueda<unknown>) =>
    renderToStaticMarkup(createElement(MensajeBusqueda, { estado, inicial: "Escriba.", vacio: "Sin resultados.", onReintentar: nada }));

  it("estados inicial, carga, vacío, error y resultados", () => {
    expect(mensaje({ tipo: "inicial" })).toContain("Escriba.");
    expect(mensaje({ tipo: "cargando" })).toContain("Buscando…");
    expect(mensaje({ tipo: "vacio" })).toContain("Sin resultados.");
    const error = mensaje({ tipo: "error", mensaje: "No fue posible comunicarse con el servidor." });
    expect(error).toContain('role="alert"');
    expect(error).toContain("Reintentar");
    expect(mensaje({ tipo: "resultados", datos: [1] })).toBe("");
  });
});
