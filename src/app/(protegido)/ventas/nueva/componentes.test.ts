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
import { ANCHO_MINIMO_TABLA, COLUMNAS_ITEMS, ItemsVenta, MARGEN_BARRA } from "./items-venta";
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

describe("ItemsVenta: distribución de columnas", () => {
  const LARGA = "Martillo carpintero 500 g con mango de fibra de vidrio antivibración";
  const r = agregarProducto(borradorInicial(), { id: 1, codigo: "HE-001", descripcion: LARGA, precio: 1_250_000, existencia: 26 }, "1");
  if (!r.ok) throw new Error(r.mensaje);
  const html = renderToStaticMarkup(
    createElement(ItemsVenta, { renglones: calcularRenglones(r.borrador), erroresServidor: {}, total: 1_250_000, onCambiarCantidad: nada, onQuitar: nada }),
  );
  /** Pistas de la grilla de escritorio: md:grid-cols-[a_b_c...]. */
  const pistas = COLUMNAS_ITEMS.match(/^md:grid-cols-\[(.+)\]$/)![1].split("_");
  const rem = (valor: string) => Number(valor.replace("rem", ""));

  it("la descripción larga se muestra completa, sin truncar", () => {
    expect(html).toContain(`>${LARGA}<`);
    expect(html).not.toMatch(/truncate|line-clamp/);
  });

  it("la descripción es la única columna flexible y tiene un ancho mínimo razonable (nunca minmax(0,1fr))", () => {
    expect(pistas).toHaveLength(7);
    expect(pistas.filter((p) => p.includes("fr"))).toEqual([pistas[1]]);
    const minimo = pistas[1].match(/^minmax\(([\d.]+)rem,1fr\)$/);
    expect(minimo).not.toBeNull();
    expect(Number(minimo![1])).toBeGreaterThanOrEqual(7);
    expect(COLUMNAS_ITEMS).not.toContain("minmax(0,");
  });

  it("los encabezados tienen anchos coherentes: código compacto, cantidad para el input e importes legibles, sin cortes de línea", () => {
    const [codigo, , cantidad, precio, subtotal, existencia, acciones] = pistas.map((p) => (p.endsWith("rem") ? rem(p) : NaN));
    expect(codigo).toBeGreaterThanOrEqual(4);
    expect(codigo).toBeLessThanOrEqual(6);
    expect(cantidad).toBeGreaterThanOrEqual(4.5);
    expect(precio).toBeGreaterThanOrEqual(6);
    expect(subtotal).toBeGreaterThanOrEqual(6.5);
    expect(existencia).toBeGreaterThanOrEqual(5);
    expect(acciones).toBeGreaterThanOrEqual(2);
    for (const encabezado of ["Código", "Descripción", "Cantidad", "Precio unit.", "Subtotal", "Existencia"]) {
      expect(html).toContain(`role="columnheader"${encabezado === "Código" || encabezado === "Descripción" || encabezado === "Cantidad" ? "" : ' class="text-right"'}>${encabezado}<`);
    }
    expect(html).toMatch(/role="row" class="[^"]*whitespace-nowrap[^"]*uppercase/);
  });

  it("el ancho mínimo de la tabla es la suma de columnas, espacios y relleno, y el marco se desplaza localmente", () => {
    const columnas = pistas.reduce((s, p) => s + (p.endsWith("rem") ? rem(p) : Number(p.match(/minmax\(([\d.]+)rem/)![1])), 0);
    const espacios = 6 * 0.5; // md:gap-x-2
    const relleno = 2 * 0.75; // px-3
    expect(ANCHO_MINIMO_TABLA).toBe(`md:min-w-[${columnas + espacios + relleno}rem]`);
    expect(html).toMatch(/data-slot="marco-items" class="[^"]*min-w-0[^"]*md:overflow-x-auto/);
    expect(html).toMatch(new RegExp(`role="table"[^>]*class="[^"]*${ANCHO_MINIMO_TABLA.replace(/[[\].]/g, "\\$&")}`));
    expect(html).toContain("md:gap-x-2");
  });

  it("en móvil sigue usando tarjetas: sin fila de encabezados y con etiquetas en cada dato", () => {
    expect(html).toMatch(/role="rowgroup" class="hidden md:block"/);
    expect(html).toContain("grid grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain('<span class="md:hidden">Precio unit.: </span>');
    expect(html).toContain('<span class="md:hidden">Existencia: </span>');
    expect(html).toContain("order-3 col-span-2 min-w-0");
  });

  it("los renglones y sus controles quedan por encima de la barra inferior al enfocarlos", () => {
    expect(MARGEN_BARRA).toBe("scroll-mb-56 min-[90rem]:scroll-mb-0");
    expect(html.split(MARGEN_BARRA).length - 1).toBe(3); // renglón, cantidad y quitar
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
