import { describe, expect, it } from "vitest";

import {
  formatearDia,
  formatearDiaCorto,
  formatearDocumento,
  formatearFecha,
  formatearFechaHora,
  formatearMesAnio,
  formatearMoneda,
  formatearNumeroFactura,
  formatearNumeroRecibo,
} from "./formatos";

describe("formatearMoneda", () => {
  it("muestra centavos como pesos con formato argentino", () => {
    expect(formatearMoneda(1234550)).toBe("$ 12.345,50");
    expect(formatearMoneda(1250000)).toBe("$ 12.500,00");
    expect(formatearMoneda(0)).toBe("$ 0,00");
    expect(formatearMoneda(5)).toBe("$ 0,05");
    expect(formatearMoneda(123456789012)).toBe("$ 1.234.567.890,12");
    expect(formatearMoneda(-1234550)).toBe("-$ 12.345,50");
  });

  it("rechaza importes que no son centavos enteros", () => {
    expect(() => formatearMoneda(12.5)).toThrow(RangeError);
    expect(() => formatearMoneda(Number.NaN)).toThrow(RangeError);
  });
});

describe("numeración de comprobantes", () => {
  it("formatea el número de factura", () => {
    expect(formatearNumeroFactura(1, 1)).toBe("0001-00000001");
    expect(formatearNumeroFactura(1, 1233)).toBe("0001-00001233");
  });

  it("formatea el número de recibo con su prefijo", () => {
    expect(formatearNumeroRecibo(1, 1)).toBe("R 0001-00000001");
    expect(formatearNumeroRecibo(1, 341)).toBe("R 0001-00000341");
  });
});

describe("formatearDocumento", () => {
  it("formatea DNI y CUIT", () => {
    expect(formatearDocumento("DNI", "28456123")).toBe("28.456.123");
    expect(formatearDocumento("DNI", "1234567")).toBe("1.234.567");
    expect(formatearDocumento("CUIT", "20284561234")).toBe("20-28456123-4");
    expect(formatearDocumento("CUIT", "20-28.456.123-4")).toBe("20-28456123-4");
  });

  it("devuelve sin cambios un número con longitud inesperada", () => {
    expect(formatearDocumento("CUIT", "123")).toBe("123");
  });
});

describe("fechas en hora de Argentina", () => {
  it("formatea fecha y hora en la zona de Argentina (UTC−3)", () => {
    expect(formatearFecha("2026-10-29T18:24:00Z")).toBe("29/10/2026");
    expect(formatearFechaHora("2026-10-29T18:24:00Z")).toBe("29/10/2026 15:24");
  });

  it("una venta de las 23:30 de Argentina pertenece a ese día aunque en UTC ya sea el siguiente", () => {
    const instante = new Date("2026-10-30T02:30:00Z"); // 29/10 23:30 en Argentina
    expect(formatearFecha(instante)).toBe("29/10/2026");
    expect(formatearFechaHora(instante)).toBe("29/10/2026 23:30");
  });

  it("la medianoche de Argentina ya es el día nuevo", () => {
    expect(formatearFechaHora("2026-10-30T03:00:00Z")).toBe("30/10/2026 00:00");
  });

  it("acepta milisegundos y rechaza fechas inválidas", () => {
    expect(formatearFecha(Date.UTC(2026, 0, 1, 12))).toBe("01/01/2026");
    expect(() => formatearFecha("no es una fecha")).toThrow(RangeError);
  });
});

describe("días de calendario (tablero)", () => {
  it("formatea un día AAAA-MM-DD sin conversiones de zona horaria", () => {
    expect(formatearDiaCorto("2026-10-17")).toBe("17/10");
    expect(formatearDia("2026-10-17")).toBe("17/10/2026");
  });

  it("nombra el mes en español", () => {
    expect(formatearMesAnio("2026-11-15")).toBe("noviembre de 2026");
    expect(formatearMesAnio("2027-01-01")).toBe("enero de 2027");
    expect(formatearMesAnio("2026-12-31")).toBe("diciembre de 2026");
  });
});
