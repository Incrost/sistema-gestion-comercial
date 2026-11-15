/**
 * Pruebas de los esquemas compartidos de cuenta corriente y pagos (RF-C4, RF-C5).
 */
import { describe, expect, it } from "vitest";

import {
  esquemaAltaPago,
  esquemaConsultaCuenta,
  esquemaParametrosCliente,
  esquemaParametrosPago,
  ETIQUETAS_MEDIO_PAGO,
  MEDIOS_PAGO,
} from "./validacion-pagos";

describe("esquemaAltaPago", () => {
  it("acepta los tres medios y normaliza la observación", () => {
    for (const medio of MEDIOS_PAGO) {
      expect(esquemaAltaPago.parse({ importe: 1, medio })).toEqual({ importe: 1, medio });
    }
    expect(esquemaAltaPago.parse({ importe: 500000, medio: "efectivo", observacion: "  Pago   parcial  " }).observacion).toBe(
      "Pago parcial",
    );
    expect(esquemaAltaPago.parse({ importe: 1, medio: "efectivo", observacion: "   " }).observacion).toBeNull();
    expect(esquemaAltaPago.parse({ importe: 1, medio: "efectivo", observacion: null }).observacion).toBeNull();
  });

  it("rechaza importes que no son enteros positivos en centavos", () => {
    for (const importe of [0, -1, 1.5, "100", null, Number.NaN, 100_000_000_000]) {
      expect(esquemaAltaPago.safeParse({ importe, medio: "efectivo" }).success, String(importe)).toBe(false);
    }
  });

  it("rechaza medios desconocidos, campos del servidor y campos extra", () => {
    expect(esquemaAltaPago.safeParse({ importe: 1, medio: "cheque" }).success).toBe(false);
    for (const campo of ["saldo", "saldoCliente", "numero", "numeroRecibo", "usuarioId", "clienteId", "fecha", "tipo", "otro"]) {
      const r = esquemaAltaPago.safeParse({ importe: 1, medio: "efectivo", [campo]: 1 });
      expect(r.success, campo).toBe(false);
    }
  });

  it("cada medio tiene su etiqueta", () => {
    expect(Object.keys(ETIQUETAS_MEDIO_PAGO).sort()).toEqual([...MEDIOS_PAGO].sort());
  });
});

describe("esquemaConsultaCuenta", () => {
  it("desde y hasta opcionales; vacío equivale a ausente", () => {
    expect(esquemaConsultaCuenta.parse({})).toEqual({});
    expect(esquemaConsultaCuenta.parse({ desde: "", hasta: "" })).toEqual({});
    expect(esquemaConsultaCuenta.parse({ desde: "2026-10-01", hasta: "2026-10-01" })).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-01",
    });
  });

  it("rechaza fechas inválidas, desde > hasta y parámetros desconocidos", () => {
    expect(esquemaConsultaCuenta.safeParse({ desde: "2026-02-30" }).success).toBe(false);
    expect(esquemaConsultaCuenta.safeParse({ desde: "01/10/2026" }).success).toBe(false);
    const invertido = esquemaConsultaCuenta.safeParse({ desde: "2026-10-02", hasta: "2026-10-01" });
    expect(invertido.success).toBe(false);
    expect(invertido.error?.issues[0].path).toEqual(["hasta"]);
    expect(esquemaConsultaCuenta.safeParse({ page: "1" }).success).toBe(false);
  });
});

describe("parámetros de ruta", () => {
  it("id entero positivo, como texto", () => {
    expect(esquemaParametrosCliente.parse({ id: "4" })).toEqual({ id: 4 });
    expect(esquemaParametrosPago.parse({ id: "341" })).toEqual({ id: 341 });
    for (const id of ["0", "-1", "1.5", "abc", ""]) {
      expect(esquemaParametrosPago.safeParse({ id }).success, id).toBe(false);
    }
  });
});
