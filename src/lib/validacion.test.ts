import { describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizarDocumento, normalizarEmail } from "./normalizacion";
import {
  esquemaContrasena,
  esquemaCuit,
  esquemaDni,
  esquemaEmail,
  esquemaFechaFiltro,
  esquemaId,
  esquemaIdTexto,
  esquemaImporte,
  esquemaImportePositivo,
  esquemaPaginacion,
  esquemaUltimos4,
  textoObligatorio,
} from "./validacion";

/** Primer mensaje de error de un valor inválido. */
function primerMensaje(esquema: z.ZodType, valor: unknown): string | undefined {
  const resultado = esquema.safeParse(valor);
  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe("normalización", () => {
  it("quita puntos, espacios y guiones del documento", () => {
    expect(normalizarDocumento("28.456.123")).toBe("28456123");
    expect(normalizarDocumento(" 20-28.456.123-4 ")).toBe("20284561234");
  });

  it("normaliza el email", () => {
    expect(normalizarEmail("  Laura@Correo.TEST ")).toBe("laura@correo.test");
  });
});

describe("esquemaPaginacion", () => {
  it("usa page 1 y pageSize 20 por defecto", () => {
    expect(esquemaPaginacion.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(esquemaPaginacion.parse({ page: "", pageSize: null })).toEqual({ page: 1, pageSize: 20 });
  });

  it("convierte los parámetros de la URL a número", () => {
    expect(esquemaPaginacion.parse({ page: "3", pageSize: "50" })).toEqual({ page: 3, pageSize: 50 });
  });

  it("acepta como máximo 100 elementos por página", () => {
    expect(esquemaPaginacion.parse({ pageSize: "100" }).pageSize).toBe(100);
    expect(primerMensaje(esquemaPaginacion, { pageSize: "101" })).toBe("No puede ser mayor que 100.");
  });

  it("rechaza page menor que 1 o no numérico", () => {
    expect(esquemaPaginacion.safeParse({ page: "0" }).success).toBe(false);
    expect(esquemaPaginacion.safeParse({ page: "abc" }).success).toBe(false);
    expect(esquemaPaginacion.safeParse({ page: "1.5" }).success).toBe(false);
  });
});

describe("documentos", () => {
  it("acepta un DNI con puntos y lo guarda normalizado", () => {
    expect(esquemaDni.parse("28.456.123")).toBe("28456123");
    expect(esquemaDni.parse("123456")).toBe("123456");
  });

  it("rechaza un DNI de longitud incorrecta", () => {
    expect(primerMensaje(esquemaDni, "12345")).toBe("El DNI debe tener entre 6 y 8 dígitos.");
    expect(esquemaDni.safeParse("123456789").success).toBe(false);
  });

  it("acepta un CUIT con guiones y lo guarda normalizado", () => {
    expect(esquemaCuit.parse("20-28456123-4")).toBe("20284561234");
  });

  it("rechaza un CUIT con longitud incorrecta", () => {
    expect(primerMensaje(esquemaCuit, "20-2845612-4")).toBe("El CUIT debe tener 11 dígitos.");
    expect(esquemaCuit.safeParse("202845612345").success).toBe(false);
  });
});

describe("otros esquemas base", () => {
  it("valida identificadores enteros positivos", () => {
    expect(esquemaId.parse(4)).toBe(4);
    expect(esquemaId.safeParse(0).success).toBe(false);
    expect(esquemaId.safeParse("4").success).toBe(false);
    expect(esquemaIdTexto.parse("4")).toBe(4);
    expect(esquemaIdTexto.safeParse("4a").success).toBe(false);
    expect(esquemaIdTexto.safeParse("0").success).toBe(false);
  });

  it("valida fechas de filtro AAAA-MM-DD reales", () => {
    expect(esquemaFechaFiltro.parse("2026-10-29")).toBe("2026-10-29");
    expect(esquemaFechaFiltro.safeParse("29/10/2026").success).toBe(false);
    expect(esquemaFechaFiltro.safeParse("2026-02-30").success).toBe(false);
  });

  it("valida importes en centavos", () => {
    expect(esquemaImporte.parse(0)).toBe(0);
    expect(esquemaImporte.safeParse(-1).success).toBe(false);
    expect(primerMensaje(esquemaImporte, 10.5)).toBe("Debe expresarse en centavos, sin decimales.");
    expect(esquemaImportePositivo.safeParse(0).success).toBe(false);
    expect(esquemaImportePositivo.parse(500000)).toBe(500000);
  });

  it("normaliza y valida el email", () => {
    expect(esquemaEmail.parse("  Laura@Correo.TEST ")).toBe("laura@correo.test");
    expect(primerMensaje(esquemaEmail, "laura")).toBe("Debe ser un email válido.");
    expect(primerMensaje(esquemaEmail, "  ")).toBe("Es obligatorio.");
  });

  it("exige contraseñas de al menos 8 caracteres", () => {
    expect(esquemaContrasena.safeParse("1234567").success).toBe(false);
    expect(esquemaContrasena.parse("12345678")).toBe("12345678");
  });

  it("acepta solo 4 dígitos de tarjeta", () => {
    expect(esquemaUltimos4.parse("4321")).toBe("4321");
    expect(esquemaUltimos4.safeParse("4509123412341234").success).toBe(false);
  });

  it("recorta el texto obligatorio y rechaza el vacío", () => {
    expect(textoObligatorio().parse("  Martillo  ")).toBe("Martillo");
    expect(primerMensaje(textoObligatorio(), "   ")).toBe("Es obligatorio.");
    expect(primerMensaje(textoObligatorio(), undefined)).toBe("Es obligatorio.");
    expect(primerMensaje(textoObligatorio(5), "123456")).toBe("No puede superar los 5 caracteres.");
  });
});
