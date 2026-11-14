import { describe, expect, it } from "vitest";

import { centavosATextoEditable, pesosACentavos } from "./importes";

describe("pesosACentavos", () => {
  it.each([
    ["12500", 1250000],
    ["12500,5", 1250050],
    ["12500,50", 1250050],
    ["12.500,50", 1250050],
    ["1.234.567", 123456700],
    ["$ 100", 10000],
    [" 0,99 ", 99],
  ])("%s → %i", (texto, esperado) => {
    expect(pesosACentavos(texto)).toBe(esperado);
  });

  it.each(["", "abc", "12.5", "12,505", "-5", "1,2,3", "12.50,00", "1e5"])("rechaza %j", (texto) => {
    expect(pesosACentavos(texto)).toBeNull();
  });
});

describe("centavosATextoEditable", () => {
  it("vuelve al texto editable", () => {
    expect(centavosATextoEditable(1250050)).toBe("12500,50");
    expect(centavosATextoEditable(5)).toBe("0,05");
    expect(pesosACentavos(centavosATextoEditable(98765))).toBe(98765);
  });
});
