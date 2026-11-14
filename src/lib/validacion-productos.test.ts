/**
 * Pruebas de los esquemas de categorías, productos y stock (sección 11.4).
 */
import { describe, expect, it } from "vitest";

import { MOTIVOS_EGRESO, MOTIVOS_INGRESO } from "@/config/motivos-stock";

import { esquemaParametrosId } from "./validacion";
import {
  esquemaAltaCategoria,
  esquemaAltaProducto,
  esquemaConsultaMovimientos,
  esquemaConsultaProductos,
  esquemaEdicionCategoria,
  esquemaEdicionProducto,
  esquemaMovimientoManual,
  esquemaMovimientoStock,
} from "./validacion-productos";

const productoValido = {
  codigo: "HE-001",
  descripcion: "Martillo carpintero 500 g",
  categoriaId: 1,
  precio: 1250000,
  stockMinimo: 5,
};

function campos(resultado: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return Object.fromEntries(
    (resultado.error?.issues ?? []).map((i) => [i.path.map(String).join("."), i.message]),
  );
}

describe("categorías", () => {
  it("normaliza los espacios del nombre", () => {
    expect(esquemaAltaCategoria.parse({ nombre: "  Pintura   al  agua " })).toEqual({
      nombre: "Pintura al agua",
    });
  });

  it("rechaza nombre vacío y campos extra", () => {
    expect(esquemaAltaCategoria.safeParse({ nombre: "   " }).success).toBe(false);
    expect(esquemaAltaCategoria.safeParse({ nombre: "A", activa: true }).success).toBe(false);
  });

  it("la edición exige al menos un campo y acepta nombre o activa", () => {
    expect(esquemaEdicionCategoria.safeParse({}).success).toBe(false);
    expect(esquemaEdicionCategoria.parse({ activa: false })).toEqual({ activa: false });
    expect(esquemaEdicionCategoria.safeParse({ activa: "no" }).success).toBe(false);
  });
});

describe("alta de producto", () => {
  it("acepta un producto válido y recorta el código", () => {
    const datos = esquemaAltaProducto.parse({ ...productoValido, codigo: "  HE-001 ", stockInicial: 3 });
    expect(datos.codigo).toBe("HE-001");
    expect(datos.stockInicial).toBe(3);
  });

  it("rechaza explícitamente la existencia", () => {
    const r = esquemaAltaProducto.safeParse({ ...productoValido, existencia: 10 });
    expect(r.success).toBe(false);
    expect(campos(r).existencia).toMatch(/existencia no se edita/);
  });

  it.each([
    ["precio con decimales", { precio: 12.5 }, "precio"],
    ["precio cero", { precio: 0 }, "precio"],
    ["precio negativo", { precio: -1 }, "precio"],
    ["precio como texto", { precio: "100" }, "precio"],
    ["stock mínimo negativo", { stockMinimo: -1 }, "stockMinimo"],
    ["stock mínimo con decimales", { stockMinimo: 1.5 }, "stockMinimo"],
    ["stock inicial negativo", { stockInicial: -2 }, "stockInicial"],
    ["código vacío", { codigo: "  " }, "codigo"],
    ["código con espacios", { codigo: "HE 001" }, "codigo"],
    ["código demasiado largo", { codigo: "X".repeat(31) }, "codigo"],
    ["descripción vacía", { descripcion: "" }, "descripcion"],
    ["categoría no entera", { categoriaId: 1.5 }, "categoriaId"],
    ["categoría cero", { categoriaId: 0 }, "categoriaId"],
  ])("rechaza %s", (_nombre, cambio, campo) => {
    const r = esquemaAltaProducto.safeParse({ ...productoValido, ...cambio });
    expect(r.success).toBe(false);
    expect(campos(r)).toHaveProperty(campo);
  });

  it("rechaza campos no previstos", () => {
    expect(esquemaAltaProducto.safeParse({ ...productoValido, marca: "X" }).success).toBe(false);
  });
});

describe("edición de producto", () => {
  it("exige al menos un campo", () => {
    expect(esquemaEdicionProducto.safeParse({}).success).toBe(false);
  });

  it("rechaza existencia y stockInicial", () => {
    expect(campos(esquemaEdicionProducto.safeParse({ existencia: 3 }))).toHaveProperty("existencia");
    expect(campos(esquemaEdicionProducto.safeParse({ stockInicial: 3 }))).toHaveProperty("stockInicial");
  });

  it("acepta la baja lógica", () => {
    expect(esquemaEdicionProducto.parse({ activo: false })).toEqual({ activo: false });
  });
});

describe("consulta de productos", () => {
  it("toma activo=true por defecto y convierte los parámetros de texto", () => {
    expect(
      esquemaConsultaProductos.parse({ q: " mar ", categoriaId: "2", bajoMinimo: "true", page: "2" }),
    ).toEqual({ q: "mar", categoriaId: 2, bajoMinimo: true, activo: "true", page: 2, pageSize: 20 });
  });

  it("acepta activo=todos y rechaza valores desconocidos", () => {
    expect(esquemaConsultaProductos.parse({ activo: "todos" }).activo).toBe("todos");
    expect(esquemaConsultaProductos.safeParse({ activo: "si" }).success).toBe(false);
    expect(esquemaConsultaProductos.safeParse({ orden: "precio" }).success).toBe(false);
  });
});

describe("movimiento manual", () => {
  it("acepta todos los motivos de su tipo", () => {
    for (const motivo of MOTIVOS_INGRESO) {
      expect(esquemaMovimientoManual.safeParse({ tipo: "ingreso", cantidad: 1, motivo }).success).toBe(true);
    }
    for (const motivo of MOTIVOS_EGRESO) {
      expect(esquemaMovimientoManual.safeParse({ tipo: "egreso", cantidad: 1, motivo }).success).toBe(true);
    }
  });

  it("rechaza un motivo de otro tipo o inventado", () => {
    expect(campos(esquemaMovimientoManual.safeParse({ tipo: "egreso", cantidad: 1, motivo: "Reposición" }))).toHaveProperty("motivo");
    expect(campos(esquemaMovimientoManual.safeParse({ tipo: "ingreso", cantidad: 1, motivo: "Regalo" }))).toHaveProperty("motivo");
    expect(campos(esquemaMovimientoManual.safeParse({ tipo: "egreso", cantidad: 1, motivo: "" }))).toHaveProperty("motivo");
  });

  it.each(["venta", "anulacion", "otro"])("rechaza el tipo %s", (tipo) => {
    const r = esquemaMovimientoManual.safeParse({ tipo, cantidad: 1, motivo: "Rotura" });
    expect(campos(r).tipo).toMatch(/ingreso.*egreso/);
  });

  it.each([0, -3, 1.5, "2"])("rechaza la cantidad %s", (cantidad) => {
    expect(esquemaMovimientoManual.safeParse({ tipo: "ingreso", cantidad, motivo: "Reposición" }).success).toBe(false);
  });

  it("observación vacía equivale a ausente", () => {
    expect(
      esquemaMovimientoManual.parse({ tipo: "egreso", cantidad: 1, motivo: "Rotura", observacion: "  " }),
    ).toEqual({ tipo: "egreso", cantidad: 1, motivo: "Rotura" });
  });
});

describe("movimiento interno (moverStock)", () => {
  it("venta y anulación exigen factura; ingreso y egreso no la admiten", () => {
    expect(esquemaMovimientoStock.safeParse({ productoId: 1, tipo: "venta", cantidad: 1, motivo: "Venta" }).success).toBe(false);
    expect(esquemaMovimientoStock.safeParse({ productoId: 1, tipo: "venta", cantidad: 1, motivo: "Venta", facturaId: 3 }).success).toBe(true);
    expect(esquemaMovimientoStock.safeParse({ productoId: 1, tipo: "ingreso", cantidad: 1, motivo: "Reposición", facturaId: 3 }).success).toBe(false);
  });
});

describe("consulta de movimientos y parámetros", () => {
  it("valida fechas y su orden", () => {
    expect(esquemaConsultaMovimientos.safeParse({ desde: "2026-02-30" }).success).toBe(false);
    expect(esquemaConsultaMovimientos.safeParse({ desde: "2026-11-10", hasta: "2026-11-01" }).success).toBe(false);
    expect(esquemaConsultaMovimientos.parse({ desde: "2026-11-01", hasta: "2026-11-10", tipo: "venta" })).toMatchObject({
      desde: "2026-11-01",
      hasta: "2026-11-10",
      tipo: "venta",
    });
  });

  it("el id de la URL es un entero positivo", () => {
    expect(esquemaParametrosId.parse({ id: "7" })).toEqual({ id: 7 });
    for (const id of ["0", "-1", "1.5", "abc", ""]) {
      expect(esquemaParametrosId.safeParse({ id }).success).toBe(false);
    }
  });
});
