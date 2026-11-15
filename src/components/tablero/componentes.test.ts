/**
 * Pruebas de los componentes del tablero: estados vacíos y formato de los
 * importes de los gráficos. Se renderiza con react-dom/server (HTML inicial),
 * igual que en las pruebas de Nueva venta; Chart.js dibuja recién en el
 * navegador, así que aquí se prueban los datos y opciones que recibe.
 */
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProductoPublico } from "@/servicios/productos";
import type { VentaDiaria, VentaPorForma } from "@/servicios/tablero";

import { GraficoFormasPago } from "./grafico-formas-pago";
import { GraficoVentasDiarias } from "./grafico-ventas-diarias";
import { Indicadores } from "./indicadores";
import { MasVendidos } from "./mas-vendidos";
import {
  COLORES_FORMA_PAGO,
  datosFormasPago,
  datosVentasDiarias,
  formatearCentavos,
  formatearEjeImporte,
  porcentaje,
  tituloDiaVentas,
  todosEnCero,
} from "./opciones-graficos";
import { ParaReponer } from "./para-reponer";

const html = <P extends object>(componente: FunctionComponent<P>, props: P) =>
  renderToStaticMarkup(createElement(componente, props));

const dias = (importes: number[]): VentaDiaria[] =>
  importes.map((importe, i) => ({ fecha: `2026-10-${String(i + 1).padStart(2, "0")}`, importe }));

const FORMAS_EN_CERO: VentaPorForma[] = [
  { forma: "contado", importe: 0 },
  { forma: "tarjeta", importe: 0 },
  { forma: "cuenta_corriente", importe: 0 },
];

describe("Indicadores", () => {
  it("con todo en cero muestra $ 0,00 y textos de ausencia de ventas", () => {
    const h = html(Indicadores, {
      hoy: { cantidad: 0, importe: 0 },
      mes: { cantidad: 0, importe: 0, ticketPromedio: 0 },
      cuentasCorrientes: { totalAdeudado: 0, clientesConSaldo: 0 },
      bajoMinimo: { cantidad: 0 },
    });
    expect(h).toContain("Ventas de hoy");
    expect(h).toContain("Sin ventas registradas hoy");
    expect(h).toContain("Sin ventas en el mes");
    expect(h).toContain("Ticket promedio: $ 0,00");
    expect(h).toContain("Ningún cliente con saldo");
    expect(h).toContain("Existencias al día");
  });

  it("formatea los importes en centavos como pesos", () => {
    const h = html(Indicadores, {
      hoy: { cantidad: 3, importe: 7_500_000 },
      mes: { cantidad: 49, importe: 223_590_000, ticketPromedio: 4_563_061 },
      cuentasCorrientes: { totalAdeudado: 6_465_000, clientesConSaldo: 1 },
      bajoMinimo: { cantidad: 4 },
    });
    expect(h).toContain("$ 75.000,00");
    expect(h).toContain("3 facturas emitidas");
    expect(h).toContain("$ 2.235.900,00");
    expect(h).toContain("Ticket promedio: $ 45.630,61");
    expect(h).toContain("$ 64.650,00");
    expect(h).toContain("1 cliente con saldo");
    expect(h).toContain('href="/productos?bajoMinimo=true"');
  });
});

describe("MasVendidos", () => {
  it("sin productos muestra un mensaje", () => {
    expect(html(MasVendidos, { productos: [] })).toContain("Todavía no se vendieron productos este mes.");
  });

  it("muestra posición, código, descripción, unidades e importe", () => {
    const h = html(MasVendidos, {
      productos: [{ productoId: 5, codigo: "EL-002", descripcion: "Lámpara LED 12 W", unidades: 31, importe: 9_920_000 }],
    });
    for (const texto of ["<td", ">1<", "EL-002", "Lámpara LED 12 W", ">31<", "$ 99.200,00", 'href="/productos/5"']) {
      expect(h).toContain(texto);
    }
  });
});

describe("ParaReponer", () => {
  const producto: ProductoPublico = {
    id: 9, codigo: "PI-003", descripcion: "Rodillo", categoria: { id: 1, nombre: "Pinturería" },
    precio: 100, existencia: 2, stockMinimo: 5, bajoMinimo: true, activo: true,
  };

  it("sin productos muestra un mensaje", () => {
    expect(html(ParaReponer, { productos: [], total: 0 })).toContain("No hay productos activos bajo el stock mínimo.");
  });

  it("muestra código, descripción, existencia, mínimo y enlace a la ficha", () => {
    const h = html(ParaReponer, { productos: [producto], total: 1 });
    for (const texto of ["PI-003", "Rodillo", ">2<", ">5<", 'href="/productos/9"']) expect(h).toContain(texto);
    expect(h).not.toContain("Ver los");
  });

  it("si hay más de los mostrados ofrece ver todos", () => {
    expect(html(ParaReponer, { productos: [producto], total: 12 })).toContain("Ver los 12 productos bajo el mínimo");
  });
});

describe("GraficoVentasDiarias", () => {
  it("sin ventas muestra un mensaje en lugar del gráfico", () => {
    const h = html(GraficoVentasDiarias, { ventas: dias(Array(30).fill(0)) });
    expect(h).toContain("No se registraron ventas en los últimos 30 días.");
    expect(h).not.toContain("<canvas");
  });

  it("con ventas dibuja el lienzo accesible", () => {
    const h = html(GraficoVentasDiarias, { ventas: dias([0, 100_000, 0]) });
    expect(h).toContain("<canvas");
    expect(h).toContain('aria-label="Ventas diarias de los últimos 3 días"');
  });
});

describe("GraficoFormasPago", () => {
  it("con todas las formas en cero lo indica y lista las tres en $ 0,00", () => {
    const h = html(GraficoFormasPago, { formas: FORMAS_EN_CERO });
    expect(h).toContain("No se registraron ventas en el mes");
    expect(h).not.toContain("<canvas");
    for (const etiqueta of ["Contado", "Tarjeta", "Cuenta corriente"]) expect(h).toContain(etiqueta);
    expect(h.match(/\$ 0,00/g)!.length).toBeGreaterThanOrEqual(3);
    expect(h).toContain("0,0 %");
  });

  it("con ventas dibuja la dona y muestra importes y porcentajes", () => {
    const h = html(GraficoFormasPago, {
      formas: [
        { forma: "contado", importe: 127_435_000 },
        { forma: "tarjeta", importe: 79_890_000 },
        { forma: "cuenta_corriente", importe: 16_265_000 },
      ],
    });
    expect(h).toContain("<canvas");
    expect(h).toContain("$ 1.274.350,00");
    expect(h).toContain("$ 162.650,00");
    expect(h).toContain("57,0 %");
  });
});

describe("datos y formato de los gráficos", () => {
  it("los importes llegan en centavos y se formatean como pesos", () => {
    expect(formatearCentavos(1_234_550)).toBe("$ 12.345,50");
    expect(formatearCentavos(0)).toBe("$ 0,00");
    expect(formatearCentavos(null)).toBe("$ 0,00");
    expect(formatearCentavos(10.4)).toBe("$ 0,10"); // valores intermedios de Chart.js
  });

  it("el eje muestra pesos enteros", () => {
    expect(formatearEjeImporte(2_500_000)).toBe("$ 25.000");
    expect(formatearEjeImporte(0)).toBe("$ 0");
    expect(formatearEjeImporte(12_345_678)).toBe("$ 123.457");
  });

  it("ventas diarias: los datos son los centavos sin transformar y los rótulos dd/mm", () => {
    const ventas: VentaDiaria[] = [
      { fecha: "2026-10-17", importe: 10_900_000 },
      { fecha: "2026-10-18", importe: 0 },
    ];
    const datos = datosVentasDiarias(ventas);
    expect(datos.labels).toEqual(["17/10", "18/10"]);
    expect(datos.datasets[0].data).toEqual([10_900_000, 0]);
    expect(tituloDiaVentas(ventas, 0)).toBe("17/10/2026");
    expect(tituloDiaVentas(ventas, 9)).toBe("");
  });

  it("formas de pago: etiquetas en español y colores distintos", () => {
    const datos = datosFormasPago(FORMAS_EN_CERO);
    expect(datos.labels).toEqual(["Contado", "Tarjeta", "Cuenta corriente"]);
    expect(new Set(datos.datasets[0].backgroundColor).size).toBe(3);
    expect(new Set(Object.values(COLORES_FORMA_PAGO)).size).toBe(3);
  });

  it("todosEnCero() y porcentaje()", () => {
    expect(todosEnCero(FORMAS_EN_CERO)).toBe(true);
    expect(todosEnCero([])).toBe(true);
    expect(todosEnCero([{ importe: 1 }])).toBe(false);
    expect(porcentaje(1, 3)).toBe("33,3 %");
    expect(porcentaje(5, 0)).toBe("0,0 %");
  });
});
