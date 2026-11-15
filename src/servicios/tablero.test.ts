/**
 * Pruebas del servicio del tablero (RF-T1, RF-T2): indicadores, ventas
 * diarias, formas de pago, cuentas corrientes y productos bajo el mínimo.
 * Los más vendidos (RF-T3) están en tablero-mas-vendidos.test.ts.
 *
 * Base SQLite temporal REAL (migraciones, claves foráneas y CHECK). Las
 * facturas se emiten con emitirFactura() dentro de conFechaSimulada(), el
 * mismo mecanismo que usa el seed; el tablero también se consulta con una
 * fecha simulada fija, sin tocar la hora del sistema.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { clientes } from "@/db/schema";
import { normalizarError } from "@/lib/api-error";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import type { UsuarioAutenticado } from "./auth";
import { crearCategoria } from "./categorias";
import { crearCliente } from "./clientes";
import { obtenerSaldo } from "./cuenta-corriente";
import { anularFactura, emitirFactura } from "./facturas";
import { registrarPago } from "./pagos";
import { actualizarProducto, crearProducto, listarProductos } from "./productos";
import { conFechaSimulada } from "./reloj";
import {
  calcularPeriodos,
  calcularTicketPromedio,
  completarDias,
  DIAS_VENTAS_DIARIAS,
  obtenerTablero,
  type Tablero,
} from "./tablero";

const { cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

/** «Ahora» de las pruebas: 20/10/2026 23:50 en Argentina (= 21/10 02:50 UTC). */
const REFERENCIA = "2026-10-20T23:50:00-03:00";

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
  categoriaId = (await crearCategoria(admin, { nombre: "Tablero" })).id;
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

const tableroEn = (iso: string, usuario: UsuarioAutenticado = vendedor) =>
  conFechaSimulada(new Date(iso), () => obtenerTablero(usuario));

let n = 0;
function nuevoProducto(precio: number, datos: { stockMinimo?: number; stockInicial?: number } = {}) {
  const codigo = `TB-${String(++n).padStart(3, "0")}`;
  return crearProducto(admin, {
    codigo,
    descripcion: `Producto ${codigo}`,
    categoriaId,
    precio,
    stockMinimo: datos.stockMinimo ?? 0,
    ...(datos.stockInicial !== undefined ? { stockInicial: datos.stockInicial } : { stockInicial: 1000 }),
  });
}

let dni = 30_100_000;
const nuevoClienteCuenta = () =>
  crearCliente(admin, { tipoDoc: "DNI", nroDoc: String(++dni), nombre: `Cliente ${dni}`, cuentaCorriente: true });

const CONTADO = { forma: "contado" } as const;
const TARJETA = { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "1234" } } as const;
const CUENTA = { forma: "cuenta_corriente" } as const;

type Pago = typeof CONTADO | typeof TARJETA | typeof CUENTA;

/** Emite una factura con la fecha de emisión simulada `iso` (hora de Argentina). */
function emitirEn(iso: string, productoId: number, cantidad: number, pago: Pago, clienteId: number | null = null) {
  return conFechaSimulada(new Date(iso), () =>
    emitirFactura(vendedor, { clienteId, items: [{ productoId, cantidad }], pago }),
  );
}

function anularEn(iso: string, facturaId: number) {
  return conFechaSimulada(new Date(iso), () =>
    anularFactura(admin, { id: String(facturaId) }, { motivo: "Prueba del tablero" }),
  );
}

const importeDelDia = (t: Tablero, fecha: string) => t.ventasDiarias.find((v) => v.fecha === fecha)?.importe;

// ---------------------------------------------------------------------------
// Funciones puras: períodos, relleno y ticket promedio
// ---------------------------------------------------------------------------

describe("calcularPeriodos() — límites en hora argentina", () => {
  const iso = (d: Date) => d.toISOString();

  it("día actual: de 00:00 a 24:00 de Argentina (03:00 UTC a 03:00 UTC)", () => {
    const p = calcularPeriodos(new Date(REFERENCIA));
    expect(p.dia).toBe("2026-10-20");
    expect(iso(p.hoy.desde)).toBe("2026-10-20T03:00:00.000Z");
    expect(iso(p.hoy.hasta)).toBe("2026-10-21T03:00:00.000Z");
  });

  it("una hora después de la medianoche UTC sigue siendo el día anterior en Argentina", () => {
    const p = calcularPeriodos(new Date("2026-10-21T01:00:00Z")); // 20/10 22:00 AR
    expect(p.dia).toBe("2026-10-20");
    expect(calcularPeriodos(new Date("2026-10-21T03:00:00Z")).dia).toBe("2026-10-21"); // 00:00 AR
    expect(calcularPeriodos(new Date("2026-10-21T02:59:59.999Z")).dia).toBe("2026-10-20");
  });

  it("mes calendario de Argentina: del día 1 a las 00:00 al día 1 del mes siguiente", () => {
    const p = calcularPeriodos(new Date(REFERENCIA));
    expect(iso(p.mes.desde)).toBe("2026-10-01T03:00:00.000Z");
    expect(iso(p.mes.hasta)).toBe("2026-11-01T03:00:00.000Z");
  });

  it("el último minuto del mes en Argentina (ya 1.º en UTC) pertenece al mes que termina", () => {
    const p = calcularPeriodos(new Date("2026-11-01T02:59:00Z")); // 31/10 23:59 AR
    expect(p.dia).toBe("2026-10-31");
    expect(iso(p.mes.desde)).toBe("2026-10-01T03:00:00.000Z");
    const q = calcularPeriodos(new Date("2026-11-01T03:00:00Z")); // 01/11 00:00 AR
    expect(iso(q.mes.desde)).toBe("2026-11-01T03:00:00.000Z");
    expect(iso(q.mes.hasta)).toBe("2026-12-01T03:00:00.000Z");
  });

  it("cambio de año: 31/12 a la noche en Argentina es diciembre", () => {
    const p = calcularPeriodos(new Date("2027-01-01T02:00:00Z")); // 31/12/2026 23:00 AR
    expect(p.dia).toBe("2026-12-31");
    expect(iso(p.mes.desde)).toBe("2026-12-01T03:00:00.000Z");
    expect(iso(p.mes.hasta)).toBe("2027-01-01T03:00:00.000Z");
  });

  it("ventana: exactamente 30 días ordenados, de hace 29 días a hoy, ambos inclusive", () => {
    const p = calcularPeriodos(new Date(REFERENCIA));
    expect(p.ventana.dias).toHaveLength(DIAS_VENTAS_DIARIAS);
    expect(p.ventana.dias[0]).toBe("2026-09-21");
    expect(p.ventana.dias.at(-1)).toBe("2026-10-20");
    expect([...p.ventana.dias].sort()).toEqual(p.ventana.dias);
    expect(new Set(p.ventana.dias).size).toBe(30);
    expect(iso(p.ventana.desde)).toBe("2026-09-21T03:00:00.000Z");
    expect(iso(p.ventana.hasta)).toBe("2026-10-21T03:00:00.000Z");
  });

  it("la ventana cruza febrero sin saltear ni repetir días", () => {
    const p = calcularPeriodos(new Date("2026-03-01T15:00:00Z"));
    expect(p.ventana.dias[0]).toBe("2026-01-31");
    expect(p.ventana.dias).toContain("2026-02-28");
    expect(p.ventana.dias).not.toContain("2026-02-29");
    expect(p.ventana.dias).toHaveLength(30);
  });

  describe("no depende de la zona horaria de la máquina", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it.each(["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"])("TZ=%s", (tz) => {
      const enArgentina = calcularPeriodos(new Date("2026-11-01T02:30:00Z"));
      process.env.TZ = tz;
      expect(calcularPeriodos(new Date("2026-11-01T02:30:00Z"))).toEqual(enArgentina);
      expect(enArgentina.dia).toBe("2026-10-31");
    });
  });
});

describe("completarDias()", () => {
  it("rellena con 0 los días sin ventas y respeta el orden", () => {
    const dias = ["2026-10-01", "2026-10-02", "2026-10-03"];
    expect(completarDias(dias, new Map([["2026-10-02", 500]]))).toEqual([
      { fecha: "2026-10-01", importe: 0 },
      { fecha: "2026-10-02", importe: 500 },
      { fecha: "2026-10-03", importe: 0 },
    ]);
  });

  it("ignora días fuera de la lista", () => {
    expect(completarDias(["2026-10-01"], new Map([["2026-09-30", 900]]))).toEqual([{ fecha: "2026-10-01", importe: 0 }]);
  });
});

describe("calcularTicketPromedio()", () => {
  it("divide el importe por la cantidad", () => {
    expect(calcularTicketPromedio(1_050_000, 4)).toBe(262_500);
  });

  it("es 0 sin ventas (no divide por cero)", () => {
    expect(calcularTicketPromedio(0, 0)).toBe(0);
  });

  it("redondea al centavo más cercano, con las mitades hacia arriba", () => {
    expect(calcularTicketPromedio(1001, 2)).toBe(501); // 500,5 → 501
    expect(calcularTicketPromedio(1000, 3)).toBe(333); // 333,33 → 333
    expect(calcularTicketPromedio(2000, 3)).toBe(667); // 666,67 → 667
    expect(calcularTicketPromedio(1003, 2)).toBe(502); // 501,5 → 502
  });

  it("siempre devuelve un entero de centavos", () => {
    for (const [importe, cantidad] of [[10, 3], [7, 4], [999_999, 7]]) {
      expect(Number.isInteger(calcularTicketPromedio(importe, cantidad))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tablero vacío (antes de cargar datos en esta base)
// ---------------------------------------------------------------------------

describe("tablero vacío", () => {
  it("todo en cero, 30 días en cero, tres formas en cero y sin más vendidos", async () => {
    const t = await tableroEn(REFERENCIA);
    expect(t.hoy).toEqual({ cantidad: 0, importe: 0 });
    expect(t.mes).toEqual({ cantidad: 0, importe: 0, ticketPromedio: 0 });
    expect(t.cuentasCorrientes).toEqual({ totalAdeudado: 0, clientesConSaldo: 0 });
    expect(t.bajoMinimo).toEqual({ cantidad: 0 });
    expect(t.ventasDiarias).toHaveLength(30);
    expect(t.ventasDiarias.every((v) => v.importe === 0)).toBe(true);
    expect(t.porFormaDePago).toEqual([
      { forma: "contado", importe: 0 },
      { forma: "tarjeta", importe: 0 },
      { forma: "cuenta_corriente", importe: 0 },
    ]);
    expect(t.masVendidos).toEqual([]);
  });

  it("tiene exactamente las claves de la sección 11.2", async () => {
    const t = await tableroEn(REFERENCIA);
    expect(Object.keys(t).sort()).toEqual(
      ["bajoMinimo", "cuentasCorrientes", "hoy", "masVendidos", "mes", "porFormaDePago", "ventasDiarias"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

describe("permisos", () => {
  it("admin y vendedor obtienen el mismo tablero", async () => {
    expect(await tableroEn(REFERENCIA, admin)).toEqual(await tableroEn(REFERENCIA, vendedor));
  });

  it("sin usuario → 401 NO_AUTENTICADO", async () => {
    const error = await obtenerTablero(null as unknown as UsuarioAutenticado).catch(normalizarError);
    expect(error).toMatchObject({ status: 401, code: "NO_AUTENTICADO" });
  });
});

// ---------------------------------------------------------------------------
// Conjunto conocido de ventas
// ---------------------------------------------------------------------------
//
//  Fecha y hora AR          UTC              Forma     Importe   Estado
//  V1 20/10 00:10      20/10 03:10    contado   100.000   emitida  (hoy)
//  V2 20/10 23:30      21/10 02:30    tarjeta   250.000   emitida  (hoy; en UTC sería el 21)
//  V3 20/10 12:00      20/10 15:00    contado   300.000   ANULADA
//  V4 19/10 23:59      20/10 02:59    contado   200.000   emitida  (ayer; en UTC sería hoy)
//  V5 01/10 00:05      01/10 03:05    cta. cte. 500.000   emitida  (primer minuto del mes)
//  V6 30/09 23:55      01/10 02:55    contado   100.000   emitida  (septiembre; en UTC sería octubre)
//  V7 21/09 10:00      21/09 13:00    tarjeta   100.000   emitida  (primer día de la ventana)
//  V8 20/09 23:00      21/09 02:00    contado   500.000   emitida  (fuera de la ventana)
//  V9 10/10 15:00      10/10 18:00    cta. cte. 100.000   ANULADA
//
// Montos en centavos (100.000 = $ 1.000,00).

describe("indicadores, ventas diarias y formas de pago", () => {
  let t: Tablero;
  let clienteX: number;

  beforeAll(async () => {
    const pa = await nuevoProducto(100_000);
    const pb = await nuevoProducto(250_000);
    clienteX = (await nuevoClienteCuenta()).id;

    await emitirEn("2026-10-20T00:10:00-03:00", pa.id, 1, CONTADO); // V1
    await emitirEn("2026-10-20T23:30:00-03:00", pb.id, 1, TARJETA); // V2
    const v3 = await emitirEn("2026-10-20T12:00:00-03:00", pa.id, 3, CONTADO);
    await anularEn("2026-10-20T12:30:00-03:00", v3.id);
    await emitirEn("2026-10-19T23:59:00-03:00", pa.id, 2, CONTADO); // V4
    await emitirEn("2026-10-01T00:05:00-03:00", pb.id, 2, CUENTA, clienteX); // V5
    await emitirEn("2026-09-30T23:55:00-03:00", pa.id, 1, CONTADO); // V6
    await emitirEn("2026-09-21T10:00:00-03:00", pa.id, 1, TARJETA); // V7
    await emitirEn("2026-09-20T23:00:00-03:00", pa.id, 5, CONTADO); // V8
    const v9 = await emitirEn("2026-10-10T15:00:00-03:00", pa.id, 1, CUENTA, clienteX);
    await anularEn("2026-10-10T16:00:00-03:00", v9.id);

    t = await tableroEn(REFERENCIA);
  });

  it("ventas del día: cantidad e importe, sin la anulada", () => {
    expect(t.hoy).toEqual({ cantidad: 2, importe: 350_000 });
  });

  it("una venta de las 23:30 de Argentina (02:30 UTC del día siguiente) cuenta como de hoy", async () => {
    expect(t.hoy.importe).toBe(100_000 + 250_000);
    // A las 00:30 del 21 en Argentina ya es otro día: hoy queda vacío.
    expect((await tableroEn("2026-10-21T00:30:00-03:00")).hoy).toEqual({ cantidad: 0, importe: 0 });
  });

  it("una venta de las 23:59 de ayer (ya «hoy» en UTC) no cuenta como de hoy", () => {
    expect(importeDelDia(t, "2026-10-19")).toBe(200_000);
  });

  it("ventas del mes: cantidad, importe y ticket promedio, sin anuladas", () => {
    // V1 + V2 + V4 + V5 (V3 y V9 anuladas; V6, V7 y V8 son de septiembre).
    expect(t.mes).toEqual({ cantidad: 4, importe: 1_050_000, ticketPromedio: 262_500 });
  });

  it("límites del mes: el 01/10 00:05 entra; el 30/09 23:55 (01/10 en UTC) no", () => {
    expect(importeDelDia(t, "2026-10-01")).toBe(500_000);
    expect(importeDelDia(t, "2026-09-30")).toBe(100_000);
    expect(t.mes.cantidad).toBe(4);
  });

  it("ventas diarias: 30 días ordenados, de hace 29 días a hoy", () => {
    expect(t.ventasDiarias).toHaveLength(30);
    expect(t.ventasDiarias[0].fecha).toBe("2026-09-21");
    expect(t.ventasDiarias.at(-1)!.fecha).toBe("2026-10-20");
    const fechas = t.ventasDiarias.map((v) => v.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it("ventas diarias: importes por día, días sin ventas en 0 y sin anuladas", () => {
    const conVentas = Object.fromEntries(t.ventasDiarias.filter((v) => v.importe > 0).map((v) => [v.fecha, v.importe]));
    expect(conVentas).toEqual({
      "2026-09-21": 100_000, // V7 (primer día de la ventana)
      "2026-09-30": 100_000, // V6
      "2026-10-01": 500_000, // V5
      "2026-10-19": 200_000, // V4
      "2026-10-20": 350_000, // V1 + V2 (V3 anulada)
    });
    expect(importeDelDia(t, "2026-10-10")).toBe(0); // V9 anulada
    expect(t.ventasDiarias.filter((v) => v.importe === 0)).toHaveLength(25);
    expect(t.ventasDiarias.every((v) => Number.isInteger(v.importe))).toBe(true);
  });

  it("ventas diarias: la venta del 20/09 23:00 (21/09 en UTC) queda fuera de la ventana", () => {
    const total = t.ventasDiarias.reduce((s, v) => s + v.importe, 0);
    expect(total).toBe(1_250_000); // sin los 500.000 de V8
  });

  it("formas de pago del mes: siempre las tres, en orden estable, sin anuladas", () => {
    expect(t.porFormaDePago).toEqual([
      { forma: "contado", importe: 300_000 }, // V1 + V4 (V3 anulada)
      { forma: "tarjeta", importe: 250_000 }, // V2
      { forma: "cuenta_corriente", importe: 500_000 }, // V5 (V9 anulada)
    ]);
    expect(t.porFormaDePago.reduce((s, f) => s + f.importe, 0)).toBe(t.mes.importe);
  });

  it("formas de pago: una forma sin ventas en el mes aparece con 0", async () => {
    // En septiembre (al 30/09) solo hubo contado y tarjeta.
    const sep = await tableroEn("2026-09-30T23:58:00-03:00");
    expect(sep.porFormaDePago).toEqual([
      { forma: "contado", importe: 600_000 }, // V6 + V8
      { forma: "tarjeta", importe: 100_000 }, // V7
      { forma: "cuenta_corriente", importe: 0 },
    ]);
  });

  it("los importes son enteros en centavos", () => {
    for (const valor of [t.hoy.importe, t.mes.importe, t.mes.ticketPromedio, ...t.porFormaDePago.map((f) => f.importe)]) {
      expect(Number.isSafeInteger(valor)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Cuentas corrientes
  // -------------------------------------------------------------------------

  describe("cuentas corrientes", () => {
    let clienteY: number;
    let clienteQ: number;

    beforeAll(async () => {
      const [pa] = (await listarProductos(admin, { q: "TB-001" })).data;
      // X: 500.000 (V5) + 100.000 (V9) − 100.000 (anulación V9) − pago 200.000 = 300.000.
      await conFechaSimulada(new Date("2026-10-15T10:00:00-03:00"), () =>
        registrarPago(vendedor, { id: String(clienteX) }, { importe: 200_000, medio: "efectivo" }),
      );
      // Y: compra 100.000 a cuenta y paga todo → saldo 0 (no cuenta).
      clienteY = (await nuevoClienteCuenta()).id;
      await emitirEn("2026-10-02T10:00:00-03:00", pa.id, 1, CUENTA, clienteY);
      await conFechaSimulada(new Date("2026-10-03T10:00:00-03:00"), () =>
        registrarPago(vendedor, { id: String(clienteY) }, { importe: 100_000, medio: "transferencia" }),
      );
      // Q: compra 100.000 a cuenta → saldo 100.000.
      clienteQ = (await nuevoClienteCuenta()).id;
      await emitirEn("2026-10-05T10:00:00-03:00", pa.id, 1, CUENTA, clienteQ);
      // Z: cliente con cuenta, sin movimientos (saldo 0).
      await nuevoClienteCuenta();
    });

    it("total adeudado = suma de saldos positivos calculados desde movimientos_cuenta", async () => {
      const c = (await tableroEn(REFERENCIA)).cuentasCorrientes;
      expect(c.totalAdeudado).toBe(300_000 + 100_000);
      // Coincide con el saldo de cada cliente (obtenerSaldo, regla 7).
      const ids = (await db.select({ id: clientes.id }).from(clientes)).map((f) => f.id);
      const saldos = await Promise.all(ids.map((id) => obtenerSaldo(db, id)));
      expect(c.totalAdeudado).toBe(saldos.filter((s) => s > 0).reduce((a, b) => a + b, 0));
    });

    it("clientes con saldo: solo los de saldo mayor que cero", async () => {
      const c = (await tableroEn(REFERENCIA)).cuentasCorrientes;
      expect(c.clientesConSaldo).toBe(2); // X y Q
      expect(await obtenerSaldo(db, clienteY)).toBe(0);
    });

    it("al cancelar una deuda el cliente deja de contarse", async () => {
      await conFechaSimulada(new Date("2026-10-18T10:00:00-03:00"), () =>
        registrarPago(vendedor, { id: String(clienteQ) }, { importe: 100_000, medio: "efectivo" }),
      );
      expect((await tableroEn(REFERENCIA)).cuentasCorrientes).toEqual({ totalAdeudado: 300_000, clientesConSaldo: 1 });
    });
  });
});

// ---------------------------------------------------------------------------
// Productos bajo el mínimo
// ---------------------------------------------------------------------------

describe("productos bajo el mínimo", () => {
  let antes: number;

  beforeAll(async () => {
    antes = (await tableroEn(REFERENCIA)).bajoMinimo.cantidad;
    await nuevoProducto(1000, { stockMinimo: 5, stockInicial: 4 }); // 4 < 5 → cuenta
    await nuevoProducto(1000, { stockMinimo: 5, stockInicial: 5 }); // 5 = 5 → no cuenta
    await nuevoProducto(1000, { stockMinimo: 5, stockInicial: 6 }); // 6 > 5 → no cuenta
    await nuevoProducto(1000, { stockMinimo: 3, stockInicial: 0 }); // 0 < 3 → cuenta
    const inactivo = await nuevoProducto(1000, { stockMinimo: 5, stockInicial: 2 }); // inactivo → no cuenta
    await actualizarProducto(admin, { id: String(inactivo.id) }, { activo: false });
  });

  it("cuenta solo productos activos con existencia < stockMinimo", async () => {
    expect(antes).toBe(0);
    expect((await tableroEn(REFERENCIA)).bajoMinimo.cantidad).toBe(2);
  });

  it("coincide con el filtro bajoMinimo del catálogo (bloque «Para reponer»)", async () => {
    const lista = await listarProductos(vendedor, { bajoMinimo: "true" });
    expect(lista.total).toBe(2);
    expect(lista.data.every((p) => p.activo && p.existencia < p.stockMinimo)).toBe(true);
  });
});
