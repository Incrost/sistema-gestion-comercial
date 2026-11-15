/**
 * Pruebas de los esquemas de emisión de facturas (RF-V1 a RF-V5; reglas 9 y
 * 10; secciones 10.4 y 11.6). Sin base de datos: solo validación.
 */
import { describe, expect, it } from "vitest";

import { errorDeValidacion, type DetalleCampo } from "./api-error";
import {
  CANTIDAD_MAXIMA_POR_RENGLON,
  esquemaEmisionFactura,
  esquemaMarcaTarjeta,
  IMPORTE_MAXIMO_FACTURA,
  MARCA_TARJETA_MAXIMA,
  RENGLONES_MAXIMOS,
} from "./validacion-facturas";

const tarjeta = { tipo: "debito", marca: "Visa", ultimos4: "1234" };
const base = {
  clienteId: null,
  items: [{ productoId: 4, cantidad: 1 }],
  pago: { forma: "contado" },
};

/** Valida y devuelve los detalles por campo (o [] si es válido). */
function detalles(datos: unknown): DetalleCampo[] {
  const resultado = esquemaEmisionFactura.safeParse(datos);
  if (resultado.success) return [];
  return errorDeValidacion(resultado.error).details as DetalleCampo[];
}

function campos(datos: unknown): string[] {
  return [...new Set(detalles(datos).map((d) => d.campo))];
}

describe("cuerpo válido", () => {
  it("acepta el ejemplo de la consigna (cuenta corriente)", () => {
    const datos = {
      clienteId: 1,
      items: [
        { productoId: 4, cantidad: 1 },
        { productoId: 1, cantidad: 2 },
      ],
      pago: { forma: "cuenta_corriente" },
    };
    expect(esquemaEmisionFactura.parse(datos)).toEqual(datos);
  });

  it("clienteId null u omitido = consumidor final (null)", () => {
    expect(esquemaEmisionFactura.parse(base).clienteId).toBeNull();
    const sinCliente = { items: base.items, pago: base.pago };
    expect(esquemaEmisionFactura.parse(sinCliente).clienteId).toBeNull();
  });

  it("contado con y sin montoRecibido (null equivale a omitido)", () => {
    expect(esquemaEmisionFactura.parse({ ...base, pago: { forma: "contado", montoRecibido: 150000 } }).pago).toEqual({
      forma: "contado",
      montoRecibido: 150000,
    });
    expect(campos({ ...base, pago: { forma: "contado", montoRecibido: null } })).toEqual([]);
    expect(campos({ ...base, pago: { forma: "contado", montoRecibido: IMPORTE_MAXIMO_FACTURA } })).toEqual([]);
  });

  it("tarjeta débito y crédito; la marca se recorta y normaliza", () => {
    expect(campos({ ...base, pago: { forma: "tarjeta", tarjeta } })).toEqual([]);
    const credito = esquemaEmisionFactura.parse({
      ...base,
      pago: { forma: "tarjeta", tarjeta: { tipo: "credito", marca: "  American   Express ", ultimos4: "0001" } },
    });
    expect(credito.pago).toEqual({
      forma: "tarjeta",
      tarjeta: { tipo: "credito", marca: "American Express", ultimos4: "0001" },
    });
  });
});

describe("clienteId", () => {
  it.each([0, -1, 1.5, "1", true, {}])("%j → VALIDACION en clienteId", (clienteId) => {
    expect(campos({ ...base, clienteId })).toEqual(["clienteId"]);
  });
});

describe("items (RF-V3)", () => {
  it("lista vacía, ausente o que no es lista", () => {
    expect(detalles({ ...base, items: [] })).toEqual([{ campo: "items", mensaje: "Debe agregar al menos un producto." }]);
    expect(campos({ ...base, items: undefined })).toEqual(["items"]);
    expect(campos({ ...base, items: { productoId: 1, cantidad: 1 } })).toEqual(["items"]);
  });

  it("producto repetido se informa en el renglón repetido", () => {
    const d = detalles({
      ...base,
      items: [
        { productoId: 4, cantidad: 1 },
        { productoId: 5, cantidad: 1 },
        { productoId: 4, cantidad: 2 },
      ],
    });
    expect(d).toEqual([
      { campo: "items.2.productoId", mensaje: "El producto está repetido: sume la cantidad en un único renglón." },
    ]);
  });

  it(`más de ${RENGLONES_MAXIMOS} renglones se rechaza`, () => {
    const items = Array.from({ length: RENGLONES_MAXIMOS + 1 }, (_, i) => ({ productoId: i + 1, cantidad: 1 }));
    expect(campos({ ...base, items })).toEqual(["items"]);
    expect(campos({ ...base, items: items.slice(0, RENGLONES_MAXIMOS) })).toEqual([]);
  });

  it.each([
    [0, "Debe ser mayor que 0."],
    [-3, "Debe ser mayor que 0."],
    [1.5, "Debe ser un número entero."],
    ["2", "Debe ser un número."],
    [null, "Es obligatorio."],
    [CANTIDAD_MAXIMA_POR_RENGLON + 1, `No puede superar ${CANTIDAD_MAXIMA_POR_RENGLON} unidades.`],
    [1e20, undefined],
    [Number.MAX_SAFE_INTEGER + 2, undefined],
  ])("cantidad %j → VALIDACION", (cantidad, mensaje) => {
    const d = detalles({ ...base, items: [{ productoId: 4, cantidad }] });
    expect([...new Set(d.map((x) => x.campo))]).toEqual(["items.0.cantidad"]);
    if (mensaje) expect(d[0].mensaje).toBe(mensaje);
  });

  it(`cantidad ${CANTIDAD_MAXIMA_POR_RENGLON} se acepta`, () => {
    expect(campos({ ...base, items: [{ productoId: 4, cantidad: CANTIDAD_MAXIMA_POR_RENGLON }] })).toEqual([]);
  });

  it.each([0, -1, 2.5, "4", null])("productoId %j → VALIDACION", (productoId) => {
    expect(campos({ ...base, items: [{ productoId, cantidad: 1 }] })).toEqual(["items.0.productoId"]);
  });

  it.each(["precio", "precioUnitario", "subtotal", "total", "codigo", "descripcion", "existencia", "otro"])(
    "el renglón rechaza «%s»",
    (campo) => {
      const d = detalles({ ...base, items: [{ productoId: 4, cantidad: 1, [campo]: 100 }] });
      expect(d.map((x) => x.campo)).toEqual([`items.0.${campo}`]);
    },
  );

  it("los precios del renglón se rechazan con un mensaje explícito", () => {
    const [d] = detalles({ ...base, items: [{ productoId: 4, cantidad: 1, precioUnitario: 1 }] });
    expect(d.mensaje).toMatch(/los calcula el servidor/);
  });
});

describe("cuerpo estricto: datos que decide el servidor", () => {
  it.each([
    "total",
    "subtotal",
    "precio",
    "precioUnitario",
    "vendedorId",
    "usuarioId",
    "puntoVenta",
    "numero",
    "numeroFormateado",
    "fecha",
    "estado",
    "saldoCliente",
    "existencia",
    "cualquierOtro",
  ])("rechaza «%s»", (campo) => {
    expect(campos({ ...base, [campo]: 1 })).toEqual([campo]);
  });
});

describe("pago (RF-V5)", () => {
  it("forma ausente o no permitida", () => {
    expect(campos({ ...base, pago: undefined })).toEqual(["pago"]);
    const d = detalles({ ...base, pago: { forma: "cheque" } });
    expect(d).toHaveLength(1);
    expect(d[0].campo).toMatch(/^pago/);
    expect(d[0].mensaje).toBe("La forma de pago debe ser «contado», «tarjeta» o «cuenta_corriente».");
  });

  it.each([0, -100, 10.5, "1000", IMPORTE_MAXIMO_FACTURA + 1, 1e20])("montoRecibido %j → VALIDACION", (montoRecibido) => {
    expect(campos({ ...base, pago: { forma: "contado", montoRecibido } })).toEqual(["pago.montoRecibido"]);
  });

  it("contado no acepta datos de tarjeta ni otros campos", () => {
    expect(campos({ ...base, pago: { forma: "contado", tarjeta } })).toEqual(["pago.tarjeta"]);
    expect(campos({ ...base, pago: { forma: "contado", vuelto: 0 } })).toEqual(["pago.vuelto"]);
  });

  it("tarjeta no acepta montoRecibido; exige los datos de la tarjeta", () => {
    expect(campos({ ...base, pago: { forma: "tarjeta", tarjeta, montoRecibido: 100 } })).toEqual(["pago.montoRecibido"]);
    expect(campos({ ...base, pago: { forma: "tarjeta" } })).toEqual(["pago.tarjeta"]);
  });

  it("cuenta corriente no acepta datos adicionales", () => {
    expect(campos({ ...base, pago: { forma: "cuenta_corriente", montoRecibido: 1 } })).toEqual(["pago.montoRecibido"]);
    expect(campos({ ...base, pago: { forma: "cuenta_corriente", tarjeta } })).toEqual(["pago.tarjeta"]);
    expect(campos({ ...base, pago: { forma: "cuenta_corriente", limite: 1 } })).toEqual(["pago.limite"]);
  });
});

describe("tarjeta (regla 9)", () => {
  const conTarjeta = (t: Record<string, unknown>) => ({ ...base, pago: { forma: "tarjeta", tarjeta: t } });

  it.each(["123", "12345", "abcd", "12a4", " 1234", "", 1234, null])("ultimos4 %j → VALIDACION", (ultimos4) => {
    expect(campos(conTarjeta({ ...tarjeta, ultimos4 }))).toEqual(["pago.tarjeta.ultimos4"]);
  });

  it.each(["prepaga", "", null])("tipo %j → VALIDACION", (tipo) => {
    expect(campos(conTarjeta({ ...tarjeta, tipo }))).toEqual(["pago.tarjeta.tipo"]);
  });

  it.each(["numero", "numeroCompleto", "numeroTarjeta", "cvv", "codigoSeguridad", "vencimiento"])(
    "rechaza expresamente «%s» dentro de la tarjeta",
    (campo) => {
      const d = detalles(conTarjeta({ ...tarjeta, [campo]: "4509953566233704" }));
      expect(d).toEqual([
        {
          campo: `pago.tarjeta.${campo}`,
          mensaje:
            "No se admite el número completo ni los datos de seguridad de la tarjeta: solo tipo, marca y últimos 4 dígitos.",
        },
      ]);
    },
  );

  it.each(["numero", "cvv", "vencimiento"])("rechaza «%s» también al nivel del pago", (campo) => {
    expect(campos({ ...base, pago: { forma: "tarjeta", tarjeta, [campo]: "123" } })).toEqual([`pago.${campo}`]);
  });

  it("rechaza cualquier otro campo de la tarjeta", () => {
    expect(campos(conTarjeta({ ...tarjeta, titular: "X" }))).toEqual(["pago.tarjeta.titular"]);
  });

  it("marca: obligatoria, longitud máxima, caracteres y sin números de tarjeta", () => {
    expect(esquemaMarcaTarjeta.safeParse("   ").success).toBe(false);
    expect(esquemaMarcaTarjeta.safeParse("x".repeat(MARCA_TARJETA_MAXIMA + 1)).success).toBe(false);
    expect(esquemaMarcaTarjeta.safeParse("Visa<script>").success).toBe(false);
    expect(esquemaMarcaTarjeta.safeParse("4509953566233704").success).toBe(false);
    expect(esquemaMarcaTarjeta.safeParse("Visa 1234").success).toBe(false);
    expect(esquemaMarcaTarjeta.safeParse("Cabal 24").success).toBe(true);
    expect(esquemaMarcaTarjeta.parse("  Tarjeta   Naranja ")).toBe("Tarjeta Naranja");
  });
});
