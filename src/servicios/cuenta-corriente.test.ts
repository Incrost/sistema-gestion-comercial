/**
 * Pruebas de la cuenta corriente (RF-C4; reglas 7, 8 y 10).
 *
 * Base SQLite temporal REAL con claves foráneas: los débitos nacen de una
 * factura a cuenta corriente mínima preparada en la misma transacción
 * (src/test/cuenta-corriente.ts); los créditos, de pagos reales.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { eq, getTableColumns } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { clientes, movimientosCuenta } from "@/db/schema";
import { enTransaccion } from "@/db/transaccion";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";
import { crearDebitoDePrueba } from "@/test/cuenta-corriente";

import type { UsuarioAutenticado } from "./auth";
import { actualizarCliente, crearCliente } from "./clientes";
import {
  importeFirmado,
  obtenerCuentaCorriente,
  obtenerSaldo,
  registrarCredito,
  registrarMovimientoCuenta,
} from "./cuenta-corriente";
import { registrarPago } from "./pagos";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
});

let dni = 20_000_000;
async function nuevoCliente(datos: Record<string, unknown> = {}) {
  return crearCliente(admin, {
    tipoDoc: "DNI",
    nroDoc: String(++dni),
    nombre: `Cliente ${dni}`,
    cuentaCorriente: true,
    ...datos,
  });
}

const debito = (clienteId: number, importe: number, fecha?: Date) =>
  crearDebitoDePrueba({ clienteId, importe, vendedorId: admin.id, fecha });

const cuenta = (clienteId: number, consulta: Record<string, string> = {}, usuario = vendedor) =>
  obtenerCuentaCorriente(usuario, { id: String(clienteId) }, consulta);

describe("saldo (regla 7)", () => {
  it("un cliente sin movimientos tiene saldo 0", async () => {
    const c = await nuevoCliente();
    expect(await obtenerSaldo(db, c.id)).toBe(0);
    expect(await cuenta(c.id)).toEqual({
      cliente: { id: c.id, nombre: c.nombre },
      saldoAnterior: 0,
      movimientos: [],
      saldo: 0,
    });
  });

  it("saldo = débitos − créditos", async () => {
    const c = await nuevoCliente();
    await debito(c.id, 960_000);
    await debito(c.id, 480_000);
    await registrarPago(vendedor, { id: String(c.id) }, { importe: 500_000, medio: "efectivo" });
    expect(await obtenerSaldo(db, c.id)).toBe(960_000 + 480_000 - 500_000);
    expect((await cuenta(c.id)).saldo).toBe(940_000);
    expect(importeFirmado("debito", 10)).toBe(10);
    expect(importeFirmado("credito", 10)).toBe(-10);
  });
});

describe("GET cuenta corriente (RF-C4)", () => {
  it("movimientos en orden cronológico, con saldo acumulado por renglón", async () => {
    const c = await nuevoCliente();
    // Se graban desordenados a propósito.
    await debito(c.id, 300_000, new Date("2026-10-20T15:00:00Z"));
    await debito(c.id, 100_000, new Date("2026-10-10T15:00:00Z"));
    await debito(c.id, 200_000, new Date("2026-10-15T15:00:00Z"));
    const pago = await registrarPago(vendedor, { id: String(c.id) }, { importe: 250_000, medio: "transferencia" });

    const r = await cuenta(c.id);
    expect(r.movimientos.map((m) => [m.tipo, m.importe, m.saldo])).toEqual([
      ["debito", 100_000, 100_000],
      ["debito", 200_000, 300_000],
      ["debito", 300_000, 600_000],
      ["credito", 250_000, 350_000],
    ]);
    const fechas = r.movimientos.map((m) => Date.parse(m.fecha));
    expect([...fechas].sort((a, b) => a - b)).toEqual(fechas);
    expect(r.saldo).toBe(350_000);
    expect(r.saldoAnterior).toBe(0);

    // Forma pública de cada renglón (sin columnas internas).
    expect(Object.keys(r.movimientos[0]).sort()).toEqual(
      ["descripcion", "facturaId", "fecha", "importe", "pagoId", "saldo", "tipo"].sort(),
    );
    expect(r.movimientos[0]).toMatchObject({ descripcion: expect.stringMatching(/^Factura 0001-\d{8}$/), pagoId: null });
    expect(r.movimientos[3]).toMatchObject({
      descripcion: `Recibo ${pago.numeroRecibo}`,
      facturaId: null,
      pagoId: pago.id,
    });
  });

  it("desde recorta el historial: saldoAnterior trae lo acumulado y el primer renglón parte de él", async () => {
    const c = await nuevoCliente();
    await debito(c.id, 100_000, new Date("2026-09-01T15:00:00Z"));
    await debito(c.id, 50_000, new Date("2026-09-05T15:00:00Z"));
    await debito(c.id, 70_000, new Date("2026-10-01T15:00:00Z"));

    const r = await cuenta(c.id, { desde: "2026-09-10" });
    expect(r.saldoAnterior).toBe(150_000);
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0]).toMatchObject({ importe: 70_000, saldo: 220_000 });
    expect(r.saldo).toBe(220_000);
  });

  it("período sin movimientos: lista vacía y saldos coherentes con el filtro", async () => {
    const c = await nuevoCliente();
    await debito(c.id, 100_000, new Date("2026-09-01T15:00:00Z"));
    await debito(c.id, 40_000, new Date("2026-10-01T15:00:00Z"));

    expect(await cuenta(c.id, { desde: "2026-09-10", hasta: "2026-09-20" })).toMatchObject({
      saldoAnterior: 100_000,
      movimientos: [],
      saldo: 100_000,
    });
    // Con solo `hasta`: el saldo al cierre de ese día.
    expect(await cuenta(c.id, { hasta: "2026-09-15" })).toMatchObject({
      saldoAnterior: 0,
      saldo: 100_000,
    });
    // Antes del primer movimiento.
    expect(await cuenta(c.id, { hasta: "2026-08-01" })).toEqual(
      expect.objectContaining({ saldoAnterior: 0, movimientos: [], saldo: 0 }),
    );
  });

  it("desde y hasta se interpretan como días de Argentina (UTC−3)", async () => {
    const c = await nuevoCliente();
    // 2026-10-24T02:30Z es el 23/10 a las 23:30 en Argentina.
    await debito(c.id, 10_000, new Date("2026-10-24T02:30:00Z"));
    // 2026-10-24T03:00Z es el 24/10 a las 00:00 en Argentina.
    await debito(c.id, 20_000, new Date("2026-10-24T03:00:00Z"));

    const dia23 = await cuenta(c.id, { desde: "2026-10-23", hasta: "2026-10-23" });
    expect(dia23.movimientos.map((m) => m.importe)).toEqual([10_000]);

    const dia24 = await cuenta(c.id, { desde: "2026-10-24", hasta: "2026-10-24" });
    expect(dia24.saldoAnterior).toBe(10_000);
    expect(dia24.movimientos.map((m) => m.importe)).toEqual([20_000]);
    expect(dia24.saldo).toBe(30_000);
  });

  it("desde posterior a hasta → VALIDACION", async () => {
    const c = await nuevoCliente();
    await expect(cuenta(c.id, { desde: "2026-10-10", hasta: "2026-10-01" })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["hasta"] })],
    });
    await expect(cuenta(c.id, { desde: "2026-02-30" })).rejects.toThrow();
    await expect(cuenta(c.id, { otro: "x" })).rejects.toThrow();
  });

  it("cliente inexistente → 404; inactivo → 404 al vendedor y 422 al admin", async () => {
    await expect(cuenta(999_999)).rejects.toMatchObject({ status: 404, code: "NO_ENCONTRADO" });
    const c = await nuevoCliente();
    await actualizarCliente(admin, { id: String(c.id) }, { activo: false });
    await expect(cuenta(c.id)).rejects.toMatchObject({ status: 404 });
    await expect(cuenta(c.id, {}, admin)).rejects.toMatchObject({ status: 422, code: "VALIDACION" });
  });
});

describe("registrarMovimientoCuenta() — única vía de escritura", () => {
  it("rechaza un crédito que dejaría el saldo negativo (regla 8)", async () => {
    const c = await nuevoCliente();
    const { facturaId } = await debito(c.id, 1_000);
    await expect(
      enTransaccion((tx) =>
        registrarCredito(tx, { clienteId: c.id, importe: 1_001, descripcion: "Anulación", origen: { facturaId } }),
      ),
    ).rejects.toMatchObject({ code: "PAGO_SUPERA_DEUDA" });
    expect(await obtenerSaldo(db, c.id)).toBe(1_000);
  });

  it("exige exactamente un origen, importe entero positivo, y un débito solo nace de una factura", async () => {
    const c = await nuevoCliente();
    const { facturaId } = await debito(c.id, 5_000);
    const intentos = [
      { clienteId: c.id, tipo: "credito", importe: 0, descripcion: "x", origen: { facturaId } },
      { clienteId: c.id, tipo: "credito", importe: 10.5, descripcion: "x", origen: { facturaId } },
      { clienteId: c.id, tipo: "credito", importe: 10, descripcion: "x", origen: {} },
      { clienteId: c.id, tipo: "credito", importe: 10, descripcion: "x", origen: { facturaId, pagoId: 1 } },
      { clienteId: c.id, tipo: "debito", importe: 10, descripcion: "x", origen: { pagoId: 1 } },
      { clienteId: c.id, tipo: "credito", importe: 10, descripcion: "  ", origen: { facturaId } },
    ];
    for (const datos of intentos) {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        enTransaccion((tx) => registrarMovimientoCuenta(tx, datos as any)),
      ).rejects.toThrow();
    }
    expect(await obtenerSaldo(db, c.id)).toBe(5_000);
  });

  it("dentro de una transacción ajena se revierte con ella", async () => {
    const c = await nuevoCliente();
    const { facturaId } = await debito(c.id, 8_000);
    await expect(
      enTransaccion(async (tx) => {
        await registrarCredito(tx, { clienteId: c.id, importe: 8_000, descripcion: "Anulación", origen: { facturaId } });
        throw new Error("falla posterior de la operación mayor");
      }),
    ).rejects.toThrow(/falla posterior/);
    expect(await obtenerSaldo(db, c.id)).toBe(8_000);
    expect(await db.select().from(movimientosCuenta).where(eq(movimientosCuenta.clienteId, c.id))).toHaveLength(1);
  });
});

describe("única fuente del saldo y de los movimientos (sección 10.2)", () => {
  function archivosFuente() {
    const raiz = join(process.cwd(), "src");
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) archivos.push(ruta);
      }
    };
    recorrer(raiz);
    return archivos.map((ruta) => ({
      ruta: relative(raiz, ruta).replaceAll("\\", "/"),
      texto: readFileSync(ruta, "utf8"),
    }));
  }

  it("la tabla clientes no tiene saldo y ningún archivo escribe un campo «saldo»", () => {
    expect(Object.keys(getTableColumns(clientes))).not.toContain("saldo");
    const escribeSaldo = /\.(set|values)\(\s*\{[^}]*\bsaldo\b\s*[:,}]|set\s+["`]?saldo\b/i;
    expect(archivosFuente().filter((a) => escribeSaldo.test(a.texto)).map((a) => a.ruta)).toEqual([]);
  });

  it("solo cuenta-corriente.ts inserta en movimientos_cuenta (fuera de las pruebas)", () => {
    const inserta = /insert\(\s*movimientosCuenta\b|insert\s+into\s+["`]?movimientos_cuenta/i;
    const infractores = archivosFuente()
      .filter((a) => !a.ruta.startsWith("test/") && inserta.test(a.texto))
      .map((a) => a.ruta);
    expect(infractores).toEqual(["servicios/cuenta-corriente.ts"]);
  });
});
