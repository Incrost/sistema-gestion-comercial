/**
 * Pruebas de los esquemas compartidos de clientes (RF-C1, RF-C2, RF-C7).
 * Son puras: no usan base de datos.
 */
import { describe, expect, it } from "vitest";

import {
  esquemaAltaCliente,
  esquemaConsultaClientes,
  esquemaEdicionCliente,
  resolverDocumento,
} from "./validacion-clientes";

const campos = (resultado: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  resultado.error?.issues.map((i) => i.path.map(String).join(".")) ?? [];

describe("resolverDocumento()", () => {
  it.each([
    ["DNI", "28.456.123", "28.456.123", "28456123"],
    ["DNI", "28456123", "28.456.123", "28456123"],
    ["DNI", " 1-234 56 ", "123.456", "123456"],
    ["CUIT", "20284561234", "20-28456123-4", "20284561234"],
    ["CUIT", "20.284.561.234", "20-28456123-4", "20284561234"],
  ] as const)("%s %j → visible %j y normalizado %j", (tipo, entrada, visible, normalizado) => {
    expect(resolverDocumento(tipo, entrada)).toEqual({
      ok: true,
      documento: { tipoDoc: tipo, nroDoc: visible, nroDocNormalizado: normalizado },
    });
  });

  it.each([
    ["DNI", "12345", "El DNI debe tener entre 6 y 8 dígitos."],
    ["DNI", "123456789", "El DNI debe tener entre 6 y 8 dígitos."],
    ["CUIT", "28456123", "El CUIT debe tener 11 dígitos."],
    ["CUIT", "202845612345", "El CUIT debe tener 11 dígitos."],
  ] as const)("%s %j → %s", (tipo, entrada, mensaje) => {
    expect(resolverDocumento(tipo, entrada)).toEqual({ ok: false, mensaje });
  });
});

describe("esquemaAltaCliente", () => {
  const base = { tipoDoc: "DNI", nroDoc: "28.456.123", nombre: "Mariana López" };

  it("aplica valores por defecto y normaliza los opcionales vacíos a null", () => {
    expect(esquemaAltaCliente.parse({ ...base, domicilio: "  ", telefono: "", email: null })).toEqual({
      ...base,
      domicilio: null,
      telefono: null,
      email: null,
      cuentaCorriente: false,
    });
  });

  it("normaliza espacios y email; el teléfono es texto libre (sin exigir 8 dígitos)", () => {
    const datos = esquemaAltaCliente.parse({ ...base, nombre: " Ana   Paz ", telefono: " (0381) 15-555 ", email: " A@B.TEST " });
    expect(datos).toMatchObject({ nombre: "Ana Paz", telefono: "(0381) 15-555", email: "a@b.test" });
    expect(esquemaAltaCliente.safeParse({ ...base, telefono: "123" }).success).toBe(true);
  });

  it.each([
    [{ nroDoc: "1234" }, "nroDoc"],
    [{ nroDoc: "28a456123" }, "nroDoc"],
    [{ tipoDoc: "CUIT" }, "nroDoc"],
    [{ tipoDoc: "dni" }, "tipoDoc"],
    [{ email: "x@" }, "email"],
    [{ telefono: "1".repeat(41) }, "telefono"],
    [{ limiteCredito: 1000 }, "limiteCredito"],
    [{ cuentaCorriente: true, limiteCredito: 1.5 }, "limiteCredito"],
    [{ cuentaCorriente: true, limiteCredito: -5 }, "limiteCredito"],
    [{ cuentaCorriente: "si" }, "cuentaCorriente"],
    [{ saldo: 0 }, "saldo"],
    [{ disponible: 0 }, "disponible"],
    [{ activo: true }, "activo"],
    [{ nroDocNormalizado: "28456123" }, "nroDocNormalizado"],
    [{ nombre: undefined }, "nombre"],
  ])("%j → error en %s", (cambio, campo) => {
    expect(campos(esquemaAltaCliente.safeParse({ ...base, ...cambio }))).toContain(campo);
  });

  it("rechaza campos desconocidos", () => {
    const r = esquemaAltaCliente.safeParse({ ...base, extra: 1 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].code).toBe("unrecognized_keys");
  });

  it("acepta cuenta corriente con límite en centavos o sin límite", () => {
    expect(esquemaAltaCliente.parse({ ...base, cuentaCorriente: true, limiteCredito: 40000000 }).limiteCredito).toBe(40000000);
    expect(esquemaAltaCliente.parse({ ...base, cuentaCorriente: true, limiteCredito: null }).limiteCredito).toBeNull();
    expect(esquemaAltaCliente.parse({ ...base, cuentaCorriente: false, limiteCredito: null }).limiteCredito).toBeNull();
  });
});

describe("esquemaEdicionCliente", () => {
  it("exige al menos un campo", () => {
    const r = esquemaEdicionCliente.safeParse({});
    expect(r.error?.issues.map((i) => i.message)).toEqual(["Debe indicar al menos un campo para modificar."]);
  });

  it("los campos ausentes quedan undefined (no se modifican); null y \"\" borran", () => {
    expect(esquemaEdicionCliente.parse({ nombre: "X" })).toEqual({ nombre: "X" });
    expect(esquemaEdicionCliente.parse({ telefono: "", email: null })).toEqual({ telefono: null, email: null });
  });

  it("acepta activo y controla el documento si llegan tipo y número juntos", () => {
    expect(esquemaEdicionCliente.parse({ activo: false })).toEqual({ activo: false });
    expect(campos(esquemaEdicionCliente.safeParse({ tipoDoc: "CUIT", nroDoc: "28456123" }))).toEqual(["nroDoc"]);
    expect(esquemaEdicionCliente.safeParse({ nroDoc: "28456123" }).success).toBe(true);
  });

  it.each(["saldo", "disponible", "nroDocNormalizado", "id"])("rechaza %s", (campo) => {
    expect(esquemaEdicionCliente.safeParse({ [campo]: 1 }).success).toBe(false);
  });

  it("límite con cuentaCorriente false → error", () => {
    expect(campos(esquemaEdicionCliente.safeParse({ cuentaCorriente: false, limiteCredito: 10 }))).toEqual(["limiteCredito"]);
  });
});

describe("esquemaConsultaClientes", () => {
  it("valores por defecto", () => {
    expect(esquemaConsultaClientes.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      conDeuda: false,
      orden: "nombre",
      activo: "true",
    });
  });

  it("convierte los parámetros de la URL", () => {
    expect(
      esquemaConsultaClientes.parse({ q: "  lopez  ana ", conDeuda: "true", orden: "saldo", activo: "todos", page: "2", pageSize: "5" }),
    ).toEqual({ q: "lopez ana", conDeuda: true, orden: "saldo", activo: "todos", page: 2, pageSize: 5 });
    expect(esquemaConsultaClientes.parse({ q: "", conDeuda: "" })).toMatchObject({ conDeuda: false });
  });

  it.each([{ orden: "fecha" }, { conDeuda: "1" }, { activo: "si" }, { pageSize: "101" }, { otro: "x" }])(
    "rechaza %j",
    (consulta) => {
      expect(esquemaConsultaClientes.safeParse(consulta).success).toBe(false);
    },
  );
});
