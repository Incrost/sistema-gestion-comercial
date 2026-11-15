import { describe, expect, it } from "vitest";

import {
  diaEnArgentina,
  diasHasta,
  inicioDelDiaEnArgentina,
  inicioDelDiaSiguienteEnArgentina,
  primerDiaDelMes,
  primerDiaDelMesSiguiente,
  sumarDias,
} from "./fechas";

describe("días en hora de Argentina", () => {
  it("asigna cada instante al día de Argentina, no al de UTC", () => {
    expect(diaEnArgentina("2026-10-30T02:59:59Z")).toBe("2026-10-29");
    expect(diaEnArgentina("2026-10-30T03:00:00Z")).toBe("2026-10-30");
  });

  it("convierte un filtro AAAA-MM-DD en el rango de instantes de ese día", () => {
    expect(inicioDelDiaEnArgentina("2026-10-29").toISOString()).toBe("2026-10-29T03:00:00.000Z");
    expect(inicioDelDiaSiguienteEnArgentina("2026-10-29").toISOString()).toBe(
      "2026-10-30T03:00:00.000Z",
    );
  });

  it("el último día del mes pasa correctamente al mes siguiente", () => {
    expect(inicioDelDiaSiguienteEnArgentina("2026-12-31").toISOString()).toBe(
      "2027-01-01T03:00:00.000Z",
    );
  });
});

describe("aritmética de días de calendario", () => {
  it("suma y resta días cruzando meses y años", () => {
    expect(sumarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(sumarDias("2026-11-01", -1)).toBe("2026-10-31");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29"); // bisiesto
    expect(sumarDias("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("primer día del mes y del mes siguiente", () => {
    expect(primerDiaDelMes("2026-11-15")).toBe("2026-11-01");
    expect(primerDiaDelMesSiguiente("2026-11-15")).toBe("2026-12-01");
    expect(primerDiaDelMesSiguiente("2026-12-31")).toBe("2027-01-01");
  });

  it("lista de días consecutivos que termina en el indicado", () => {
    expect(diasHasta("2026-11-02", 3)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(diasHasta("2026-11-15", 30)).toHaveLength(30);
  });

  it("rechaza días inválidos", () => {
    expect(() => sumarDias("2026-02-30", 1)).toThrow(RangeError);
    expect(() => primerDiaDelMes("15/11/2026")).toThrow(RangeError);
  });
});
