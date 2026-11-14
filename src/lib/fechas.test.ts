import { describe, expect, it } from "vitest";

import {
  diaEnArgentina,
  inicioDelDiaEnArgentina,
  inicioDelDiaSiguienteEnArgentina,
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
