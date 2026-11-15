/**
 * Pruebas del registro de pagos y de la numeración de recibos (RF-C5;
 * reglas 4, 7, 8, 10 y 11; sección 10.8, puntos 3, 4 y 5).
 *
 * Base SQLite temporal REAL: la atomicidad y el bloqueo no se simulan. Para
 * provocar fallas a mitad de la operación se crean triggers que abortan:
 * - la inserción del crédito (DESPUÉS de asignar el número e insertar el pago);
 * - el guardado del saldo resultante (DESPUÉS de insertar el crédito).
 */
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { movimientosCuenta, pagos, secuencias } from "@/db/schema";
import { enTransaccion } from "@/db/transaccion";
import { normalizarError } from "@/lib/api-error";
import { MEDIOS_PAGO } from "@/lib/validacion-pagos";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";
import { crearDebitoDePrueba } from "@/test/cuenta-corriente";

import type { UsuarioAutenticado } from "./auth";
import { actualizarCliente, crearCliente } from "./clientes";
import { obtenerSaldo } from "./cuenta-corriente";
import { asignarNumero, consultarProximoNumero } from "./numeracion";
import { obtenerPago, registrarPago } from "./pagos";

const { cliente, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin", nombre: "Ana Admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };

  // Falla DESPUÉS de asignar el número e insertar el pago, ANTES del crédito.
  await cliente.execute(`
    CREATE TRIGGER falla_credito BEFORE INSERT ON movimientos_cuenta
    WHEN NEW.pago_id IS NOT NULL
      AND (SELECT observacion FROM pagos WHERE id = NEW.pago_id) = 'FALLA-CREDITO'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
  // Falla DESPUÉS de insertar el crédito (al guardar el saldo resultante).
  await cliente.execute(`
    CREATE TRIGGER falla_saldo BEFORE UPDATE OF saldo_resultante ON pagos
    WHEN NEW.observacion = 'FALLA-SALDO'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

let dni = 40_000_000;
async function clienteConDeuda(deuda: number, datos: Record<string, unknown> = {}) {
  const c = await crearCliente(admin, {
    tipoDoc: "DNI",
    nroDoc: String(++dni),
    nombre: `Cliente ${dni}`,
    cuentaCorriente: true,
    ...datos,
  });
  if (deuda > 0) await crearDebitoDePrueba({ clienteId: c.id, importe: deuda, vendedorId: admin.id });
  return c;
}

const pagar = (clienteId: number, cuerpo: unknown, usuario = vendedor) =>
  registrarPago(usuario, { id: String(clienteId) }, cuerpo);

async function ultimoRecibo() {
  const [fila] = await db
    .select({ n: secuencias.ultimoNumero })
    .from(secuencias)
    .where(and(eq(secuencias.clave, "recibo"), eq(secuencias.puntoVenta, 1)));
  return fila?.n ?? 0;
}

async function pagosDe(clienteId: number) {
  return db.select().from(pagos).where(eq(pagos.clienteId, clienteId));
}

async function creditosDe(clienteId: number) {
  return db
    .select()
    .from(movimientosCuenta)
    .where(and(eq(movimientosCuenta.clienteId, clienteId), eq(movimientosCuenta.tipo, "credito")));
}

function esFallaSimulada(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e.message.includes("falla simulada")) return true;
  }
  return false;
}

async function capturar(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un error");
}

/** Comprueba que el pago fallido no dejó NADA: ni pago, ni crédito, ni número. */
async function esperarSinCambios(clienteId: number, deuda: number, reciboAntes: number) {
  expect(await pagosDe(clienteId)).toHaveLength(0);
  expect(await creditosDe(clienteId)).toHaveLength(0);
  expect(await obtenerSaldo(db, clienteId)).toBe(deuda);
  expect(await ultimoRecibo()).toBe(reciboAntes);
}

// ---------------------------------------------------------------------------
// Registro correcto
// ---------------------------------------------------------------------------

describe("registrarPago() — casos correctos", () => {
  it("pago parcial: 201-forma pública, saldo correcto, un crédito y trazabilidad (regla 11)", async () => {
    const c = await clienteConDeuda(1_440_000);
    const antes = Date.now();
    const pago = await pagar(c.id, { importe: 500_000, medio: "transferencia", observacion: "  Pago   parcial " });

    expect(Object.keys(pago).sort()).toEqual(
      ["cliente", "fecha", "id", "importe", "medio", "numeroRecibo", "observacion", "saldoCliente", "usuario"].sort(),
    );
    expect(pago).toMatchObject({
      numeroRecibo: expect.stringMatching(/^R 0001-\d{8}$/),
      cliente: { id: c.id, nombre: c.nombre },
      importe: 500_000,
      medio: "transferencia",
      observacion: "Pago parcial",
      usuario: { id: vendedor.id, nombre: "Pablo Ruiz" },
      saldoCliente: 940_000,
    });
    expect(Date.parse(pago.fecha)).toBeGreaterThanOrEqual(antes - 1000);
    expect(await obtenerSaldo(db, c.id)).toBe(940_000);

    // Exactamente un crédito, enlazado al pago, con la misma fecha.
    const creditos = await creditosDe(c.id);
    expect(creditos).toHaveLength(1);
    expect(creditos[0]).toMatchObject({
      tipo: "credito",
      importe: 500_000,
      pagoId: pago.id,
      facturaId: null,
      descripcion: `Recibo ${pago.numeroRecibo}`,
    });
    expect(creditos[0].fecha.toISOString()).toBe(pago.fecha);

    // El pago guarda usuario, fecha y saldo resultante; el movimiento llega
    // al usuario a través de su pago de origen.
    const [fila] = await pagosDe(c.id);
    expect(fila).toMatchObject({ usuarioId: vendedor.id, saldoResultante: 940_000, puntoVenta: 1 });
    expect(fila.fecha).toBeInstanceOf(Date);
  });

  it("pago igual a la deuda deja el saldo en 0", async () => {
    const c = await clienteConDeuda(1_000_000);
    const pago = await pagar(c.id, { importe: 1_000_000, medio: "efectivo" }, admin);
    expect(pago).toMatchObject({ saldoCliente: 0, observacion: null, usuario: { id: admin.id } });
    expect(await obtenerSaldo(db, c.id)).toBe(0);
  });

  it("efectivo, transferencia y tarjeta_debito son medios válidos", async () => {
    expect([...MEDIOS_PAGO]).toEqual(["efectivo", "transferencia", "tarjeta_debito"]);
    const c = await clienteConDeuda(30_000);
    for (const medio of MEDIOS_PAGO) {
      expect((await pagar(c.id, { importe: 10_000, medio })).medio).toBe(medio);
    }
    expect(await obtenerSaldo(db, c.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validación y reglas
// ---------------------------------------------------------------------------

describe("registrarPago() — validaciones y reglas", () => {
  it("datos inválidos → VALIDACION sin tocar la base", async () => {
    const c = await clienteConDeuda(100_000);
    const recibo = await ultimoRecibo();
    const invalidos = [
      { importe: 0, medio: "efectivo" },
      { importe: -100, medio: "efectivo" },
      { importe: 100.5, medio: "efectivo" },
      { importe: "1000", medio: "efectivo" },
      { medio: "efectivo" },
      { importe: 100, medio: "cheque" },
      { importe: 100 },
      { importe: 100, medio: "efectivo", observacion: "x".repeat(201) },
      { importe: 100, medio: "efectivo", extra: true },
      { importe: 100, medio: "efectivo", saldo: 0 },
      { importe: 100, medio: "efectivo", saldoCliente: 0 },
      { importe: 100, medio: "efectivo", numero: 5 },
      { importe: 100, medio: "efectivo", numeroRecibo: "R 0001-00000005" },
      { importe: 100, medio: "efectivo", usuarioId: admin.id },
      { importe: 100, medio: "efectivo", clienteId: c.id },
      { importe: 100, medio: "efectivo", fecha: "2026-01-01T00:00:00Z" },
      { importe: 100, medio: "efectivo", tipo: "debito" },
      null,
      "texto",
    ];
    for (const cuerpo of invalidos) {
      const error = normalizarError(await capturar(pagar(c.id, cuerpo)));
      expect(error, JSON.stringify(cuerpo)).toMatchObject({ status: 422, code: "VALIDACION" });
    }
    await esperarSinCambios(c.id, 100_000, recibo);
  });

  it("cliente inexistente → 404 NO_ENCONTRADO; id inválido → VALIDACION", async () => {
    await expect(pagar(999_999, { importe: 100, medio: "efectivo" })).rejects.toMatchObject({
      status: 404,
      code: "NO_ENCONTRADO",
    });
    await expect(registrarPago(vendedor, { id: "abc" }, { importe: 100, medio: "efectivo" })).rejects.toThrow();
  });

  it("cliente inactivo: se rechaza sin modificar datos (404 al vendedor, 422 al admin)", async () => {
    const c = await clienteConDeuda(0);
    await actualizarCliente(admin, { id: String(c.id) }, { activo: false });
    const recibo = await ultimoRecibo();
    await expect(pagar(c.id, { importe: 100, medio: "efectivo" })).rejects.toMatchObject({ status: 404 });
    await expect(pagar(c.id, { importe: 100, medio: "efectivo" }, admin)).rejects.toMatchObject({
      status: 422,
      code: "VALIDACION",
    });
    await esperarSinCambios(c.id, 0, recibo);
  });

  it("sin cuenta corriente → 422 CUENTA_CORRIENTE_NO_HABILITADA", async () => {
    const c = await clienteConDeuda(0, { cuentaCorriente: false });
    const recibo = await ultimoRecibo();
    await expect(pagar(c.id, { importe: 100, medio: "efectivo" })).rejects.toMatchObject({
      status: 422,
      code: "CUENTA_CORRIENTE_NO_HABILITADA",
    });
    await esperarSinCambios(c.id, 0, recibo);
  });

  it("sin deuda → 422 PAGO_SUPERA_DEUDA", async () => {
    const c = await clienteConDeuda(0);
    const recibo = await ultimoRecibo();
    await expect(pagar(c.id, { importe: 100, medio: "efectivo" })).rejects.toMatchObject({
      status: 422,
      code: "PAGO_SUPERA_DEUDA",
      message: "El cliente no tiene deuda pendiente.",
    });
    await esperarSinCambios(c.id, 0, recibo);
  });

  it("pago mayor que la deuda → 422 PAGO_SUPERA_DEUDA, sin pago, movimiento ni número", async () => {
    const c = await clienteConDeuda(100_000);
    const recibo = await ultimoRecibo();
    await expect(pagar(c.id, { importe: 100_001, medio: "efectivo" })).rejects.toMatchObject({
      status: 422,
      code: "PAGO_SUPERA_DEUDA",
      details: { saldoActual: 100_000, importe: 100_001, excedente: 1 },
    });
    await esperarSinCambios(c.id, 100_000, recibo);
  });
});

// ---------------------------------------------------------------------------
// Numeración (regla 4)
// ---------------------------------------------------------------------------

describe("numeración de recibos (regla 4)", () => {
  it("correlativa, con formato R 0001-00000001, y ultimoNumero = último asignado", async () => {
    const c = await clienteConDeuda(30_000);
    const p1 = await pagar(c.id, { importe: 10_000, medio: "efectivo" });
    const p2 = await pagar(c.id, { importe: 10_000, medio: "efectivo" });
    const p3 = await pagar(c.id, { importe: 10_000, medio: "efectivo" });
    const numeros = [p1, p2, p3].map((p) => Number(p.numeroRecibo.slice(-8)));
    expect(numeros[1]).toBe(numeros[0] + 1);
    expect(numeros[2]).toBe(numeros[1] + 1);
    expect(await ultimoRecibo()).toBe(numeros[2]);
    expect(await consultarProximoNumero(db, { clave: "recibo", puntoVenta: 1 })).toBe(numeros[2] + 1);
    expect(p3.numeroRecibo).toBe(`R 0001-${String(numeros[2]).padStart(8, "0")}`);
  });

  it("el primer número de un talonario nuevo es 00000001 y cada clave tiene su propia numeración", async () => {
    const nuevo = { clave: "recibo", puntoVenta: 7 } as const;
    expect(await consultarProximoNumero(db, nuevo)).toBe(1);
    expect(await enTransaccion((tx) => asignarNumero(tx, nuevo))).toBe(1);
    expect(await enTransaccion((tx) => asignarNumero(tx, nuevo))).toBe(2);
    expect(await enTransaccion((tx) => asignarNumero(tx, { clave: "factura", puntoVenta: 7 }))).toBe(1);
  });

  it("un número asignado en una transacción que falla no se consume", async () => {
    const talonario = { clave: "factura", puntoVenta: 8 } as const;
    await expect(
      enTransaccion(async (tx) => {
        expect(await asignarNumero(tx, talonario)).toBe(1);
        throw new Error("falla después de numerar");
      }),
    ).rejects.toThrow(/después de numerar/);
    expect(await consultarProximoNumero(db, talonario)).toBe(1);
    expect(await enTransaccion((tx) => asignarNumero(tx, talonario))).toBe(1);
  });

  it("muchas asignaciones simultáneas: sin duplicados ni huecos", async () => {
    const talonario = { clave: "recibo", puntoVenta: 9 } as const;
    const numeros = await Promise.all(
      Array.from({ length: 20 }, () => enTransaccion((tx) => asignarNumero(tx, talonario))),
    );
    expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

// ---------------------------------------------------------------------------
// Atomicidad (rollback real)
// ---------------------------------------------------------------------------

describe("transacción del pago (rollback real)", () => {
  it("falla después de asignar el número e insertar el pago: revierte pago y número", async () => {
    const c = await clienteConDeuda(50_000);
    const recibo = await ultimoRecibo();
    const error = await capturar(pagar(c.id, { importe: 20_000, medio: "efectivo", observacion: "FALLA-CREDITO" }));
    expect(esFallaSimulada(error)).toBe(true);
    await esperarSinCambios(c.id, 50_000, recibo);

    // El siguiente pago correcto usa el número que no se consumió.
    const pago = await pagar(c.id, { importe: 20_000, medio: "efectivo" });
    expect(Number(pago.numeroRecibo.slice(-8))).toBe(recibo + 1);
  });

  it("falla después de insertar el crédito: revierte toda la operación", async () => {
    const c = await clienteConDeuda(50_000);
    const recibo = await ultimoRecibo();
    const error = await capturar(pagar(c.id, { importe: 20_000, medio: "efectivo", observacion: "FALLA-SALDO" }));
    expect(esFallaSimulada(error)).toBe(true);
    await esperarSinCambios(c.id, 50_000, recibo);
  });
});

// ---------------------------------------------------------------------------
// Concurrencia (regla 8; sección 10.8, punto 4)
// ---------------------------------------------------------------------------

describe("concurrencia", () => {
  it("dos pagos simultáneos de toda la deuda ($ 10.000,00): solo uno se confirma", async () => {
    const c = await clienteConDeuda(1_000_000);
    const resultados = await Promise.allSettled([
      pagar(c.id, { importe: 1_000_000, medio: "efectivo" }),
      pagar(c.id, { importe: 1_000_000, medio: "transferencia" }, admin),
    ]);
    const exitos = resultados.filter((r) => r.status === "fulfilled");
    const fallas = resultados.filter((r) => r.status === "rejected");
    expect(exitos).toHaveLength(1);
    expect(fallas).toHaveLength(1);
    expect((fallas[0] as PromiseRejectedResult).reason).toMatchObject({ status: 422, code: "PAGO_SUPERA_DEUDA" });
    expect(await obtenerSaldo(db, c.id)).toBe(0);
    expect(await pagosDe(c.id)).toHaveLength(1);
    expect(await creditosDe(c.id)).toHaveLength(1);
  });

  it("muchos pagos parciales simultáneos nunca dejan saldo negativo", async () => {
    const c = await clienteConDeuda(1_000_000);
    const resultados = await Promise.allSettled(
      Array.from({ length: 6 }, () => pagar(c.id, { importe: 300_000, medio: "efectivo" })),
    );
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await obtenerSaldo(db, c.id)).toBe(100_000);
    const saldos = (await pagosDe(c.id)).map((p) => p.saldoResultante).sort((a, b) => b - a);
    expect(saldos).toEqual([700_000, 400_000, 100_000]);
  });

  it("si OTRA conexión paga la deuda mientras tiene el bloqueo, el pago pendiente se rechaza", async () => {
    const c = await clienteConDeuda(60_000);
    await pagar(c.id, { importe: 10_000, medio: "efectivo" }); // asegura la fila de la secuencia
    const recibo = await ultimoRecibo();

    // Otro proceso toma el bloqueo de escritura y paga los $ 500,00 restantes.
    const ajena = await cliente.transaction("write");
    const pendiente = pagar(c.id, { importe: 50_000, medio: "efectivo" });
    const numero = Number(
      (await ajena.execute(
        "UPDATE secuencias SET ultimo_numero = ultimo_numero + 1 WHERE clave = 'recibo' AND punto_venta = 1 RETURNING ultimo_numero",
      )).rows[0].ultimo_numero,
    );
    const pagoAjeno = await ajena.execute({
      sql: `INSERT INTO pagos (punto_venta, numero, cliente_id, importe, medio, usuario_id, saldo_resultante)
            VALUES (1, ?, ?, 50000, 'efectivo', ?, 0) RETURNING id`,
      args: [numero, c.id, admin.id],
    });
    await ajena.execute({
      sql: `INSERT INTO movimientos_cuenta (cliente_id, tipo, importe, descripcion, pago_id)
            VALUES (?, 'credito', 50000, 'Recibo de otro proceso', ?)`,
      args: [c.id, Number(pagoAjeno.rows[0].id)],
    });
    await new Promise((r) => setTimeout(r, 120));
    await ajena.commit();

    await expect(pendiente).rejects.toMatchObject({ code: "PAGO_SUPERA_DEUDA" });
    expect(await obtenerSaldo(db, c.id)).toBe(0);
    expect(await ultimoRecibo()).toBe(recibo + 1); // solo el del otro proceso
    const [{ n }] = await db.select({ n: count() }).from(pagos).where(eq(pagos.clienteId, c.id));
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Reimpresión (decisión C7)
// ---------------------------------------------------------------------------

describe("obtenerPago()", () => {
  it("devuelve el mismo objeto y el saldo histórico, aunque luego haya otras operaciones", async () => {
    const c = await clienteConDeuda(1_000_000);
    const primero = await pagar(c.id, { importe: 300_000, medio: "efectivo", observacion: "Primer pago" });
    expect(await obtenerPago(admin, { id: String(primero.id) })).toEqual(primero);

    await pagar(c.id, { importe: 200_000, medio: "transferencia" });
    await crearDebitoDePrueba({ clienteId: c.id, importe: 50_000, vendedorId: admin.id });
    expect(await obtenerSaldo(db, c.id)).toBe(550_000);

    const reimpreso = await obtenerPago(vendedor, { id: String(primero.id) });
    expect(reimpreso.saldoCliente).toBe(700_000);
    expect(reimpreso).toEqual(primero);
  });

  it("inexistente → 404 NO_ENCONTRADO; id inválido → VALIDACION", async () => {
    await expect(obtenerPago(admin, { id: "999999" })).rejects.toMatchObject({ status: 404, code: "NO_ENCONTRADO" });
    await expect(obtenerPago(admin, { id: "0" })).rejects.toThrow();
  });
});
