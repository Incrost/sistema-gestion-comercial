/**
 * Pruebas de integración de las rutas de cuenta corriente y pagos
 * (RF-C4, RF-C5; sección 11.5):
 *   GET  /api/clientes/{id}/cuenta
 *   POST /api/clientes/{id}/pagos
 *   GET  /api/pagos/{id}
 *
 * Se llama a cada Route Handler con un NextRequest, igual que Next.js, contra
 * una base SQLite temporal (no toca local.db ni Turso).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { firmarSesion } from "@/lib/sesion-token";
import type { ClientePublico } from "@/servicios/clientes";
import type { CuentaCorriente } from "@/servicios/cuenta-corriente";
import type { PagoPublico } from "@/servicios/pagos";
import { conId, esperarError, esperarJson, pedido } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";
import { crearDebitoDePrueba } from "@/test/cuenta-corriente";

import * as rutaCuenta from "../clientes/[id]/cuenta/route";
import * as rutaPagosCliente from "../clientes/[id]/pagos/route";
import * as rutaClientes from "../clientes/route";
import * as rutaPago from "./[id]/route";

const { cliente: clienteLibsql, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

// local.db no debe cambiar durante las pruebas (punto 40).
const RUTA_LOCAL_DB = join(process.cwd(), "local.db");
const huella = () => (existsSync(RUTA_LOCAL_DB) ? createHash("sha256").update(readFileSync(RUTA_LOCAL_DB)).digest("hex") : "sin-archivo");
const huellaInicial = huella();

const CLAVE_VENDEDOR = "clave-de-prueba-vendedor-1";
let cookieAdmin: string;
let cookieVendedor: string;
let adminId: number;
let vendedorId: number;

beforeAll(async () => {
  const admin = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin" });
  const vendedor = await crearUsuarioDePrueba(db, {
    email: "vende@prueba.test", password: CLAVE_VENDEDOR, rol: "vendedor", nombre: "Pablo Ruiz",
  });
  adminId = admin.id;
  vendedorId = vendedor.id;
  cookieAdmin = await firmarSesion(admin.id);
  cookieVendedor = await firmarSesion(vendedor.id);

  // Falla interna simulada (500) para comprobar qué se registra en el log.
  await clienteLibsql.execute(`
    CREATE TRIGGER falla_interna BEFORE INSERT ON pagos
    WHEN NEW.observacion = 'FALLA-INTERNA'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

const consultarCuenta = (cookie: string | undefined, id: number | string, consulta = "") =>
  rutaCuenta.GET(pedido(`/api/clientes/${id}/cuenta${consulta}`, { cookie }), conId(id));
const pagar = (cookie: string | undefined, id: number | string, cuerpo: object | string) =>
  rutaPagosCliente.POST(pedido(`/api/clientes/${id}/pagos`, { metodo: "POST", cookie, cuerpo }), conId(id));
const obtenerPago = (cookie: string | undefined, id: number | string) =>
  rutaPago.GET(pedido(`/api/pagos/${id}`, { cookie }), conId(id));

let dni = 50_000_000;
async function clienteConDeuda(deuda: number, datos: Record<string, unknown> = {}) {
  const respuesta = await rutaClientes.POST(
    pedido("/api/clientes", {
      metodo: "POST",
      cookie: cookieAdmin,
      cuerpo: { tipoDoc: "DNI", nroDoc: String(++dni), nombre: `Cliente ${dni}`, cuentaCorriente: true, ...datos },
    }),
    { params: Promise.resolve({}) },
  );
  const c = await esperarJson<ClientePublico>(respuesta, 201);
  if (deuda > 0) {
    await crearDebitoDePrueba({ clienteId: c.id, importe: deuda, vendedorId: adminId, fecha: new Date("2026-10-24T15:10:00Z") });
  }
  return c;
}

// ---------------------------------------------------------------------------
// GET /api/clientes/{id}/cuenta
// ---------------------------------------------------------------------------

describe("GET /api/clientes/{id}/cuenta", () => {
  it("responde el formato exigido", async () => {
    const c = await clienteConDeuda(960_000);
    const pago = await esperarJson<PagoPublico>(await pagar(cookieVendedor, c.id, { importe: 500_000, medio: "efectivo" }), 201);
    const cuenta = await esperarJson<CuentaCorriente>(await consultarCuenta(cookieVendedor, c.id), 200);

    expect(Object.keys(cuenta).sort()).toEqual(["cliente", "movimientos", "saldo", "saldoAnterior"]);
    expect(cuenta).toEqual({
      cliente: { id: c.id, nombre: c.nombre },
      saldoAnterior: 0,
      movimientos: [
        {
          fecha: "2026-10-24T15:10:00.000Z",
          tipo: "debito",
          importe: 960_000,
          descripcion: expect.stringMatching(/^Factura 0001-\d{8}$/),
          facturaId: expect.any(Number),
          pagoId: null,
          saldo: 960_000,
        },
        {
          fecha: pago.fecha,
          tipo: "credito",
          importe: 500_000,
          descripcion: `Recibo ${pago.numeroRecibo}`,
          facturaId: null,
          pagoId: pago.id,
          saldo: 460_000,
        },
      ],
      saldo: 460_000,
    });
  });

  it("filtros: saldoAnterior con desde; desde > hasta → 422 VALIDACION", async () => {
    const c = await clienteConDeuda(100_000);
    const r = await esperarJson<CuentaCorriente>(await consultarCuenta(cookieAdmin, c.id, "?desde=2026-10-25"), 200);
    expect(r).toMatchObject({ saldoAnterior: 100_000, movimientos: [], saldo: 100_000 });

    const error = await esperarError(
      await consultarCuenta(cookieAdmin, c.id, "?desde=2026-10-25&hasta=2026-10-01"),
      422,
      "VALIDACION",
    );
    expect(error.error.details).toEqual([{ campo: "hasta", mensaje: expect.any(String) }]);
    await esperarError(await consultarCuenta(cookieAdmin, c.id, "?desde=25/10/2026"), 422, "VALIDACION");
    await esperarError(await consultarCuenta(cookieAdmin, c.id, "?page=2"), 422, "VALIDACION");
  });

  it("cliente inexistente → 404; id inválido → 422", async () => {
    await esperarError(await consultarCuenta(cookieAdmin, 999_999), 404, "NO_ENCONTRADO");
    await esperarError(await consultarCuenta(cookieAdmin, "abc"), 422, "VALIDACION");
  });
});

// ---------------------------------------------------------------------------
// POST /api/clientes/{id}/pagos
// ---------------------------------------------------------------------------

describe("POST /api/clientes/{id}/pagos", () => {
  it("201 con el recibo; el vendedor registra y consulta pagos", async () => {
    const c = await clienteConDeuda(1_440_000);
    const pago = await esperarJson<PagoPublico>(
      await pagar(cookieVendedor, c.id, { importe: 500_000, medio: "transferencia", observacion: "Pago parcial" }),
      201,
    );
    expect(pago).toEqual({
      id: expect.any(Number),
      numeroRecibo: expect.stringMatching(/^R 0001-\d{8}$/),
      fecha: expect.any(String),
      cliente: { id: c.id, nombre: c.nombre },
      importe: 500_000,
      medio: "transferencia",
      observacion: "Pago parcial",
      usuario: { id: vendedorId, nombre: "Pablo Ruiz" },
      saldoCliente: 940_000,
    });
    expect(pago.fecha).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await esperarJson(await obtenerPago(cookieVendedor, pago.id), 200)).toEqual(pago);
  });

  it("errores de negocio: 422 con su código", async () => {
    const sinCuenta = await clienteConDeuda(0, { cuentaCorriente: false });
    await esperarError(await pagar(cookieAdmin, sinCuenta.id, { importe: 100, medio: "efectivo" }), 422, "CUENTA_CORRIENTE_NO_HABILITADA");

    const conDeuda = await clienteConDeuda(10_000);
    const error = await esperarError(
      await pagar(cookieAdmin, conDeuda.id, { importe: 10_001, medio: "efectivo" }),
      422,
      "PAGO_SUPERA_DEUDA",
    );
    expect(error.error.details).toEqual({ saldoActual: 10_000, importe: 10_001, excedente: 1 });

    await esperarError(await pagar(cookieAdmin, 999_999, { importe: 100, medio: "efectivo" }), 404, "NO_ENCONTRADO");
  });

  it("validación: medio desconocido, importes inválidos y campos no permitidos → 422; JSON roto → 400", async () => {
    const c = await clienteConDeuda(10_000);
    for (const cuerpo of [
      { importe: 100, medio: "mercado_pago" },
      { importe: 0, medio: "efectivo" },
      { importe: -1, medio: "efectivo" },
      { importe: 1.5, medio: "efectivo" },
      { importe: "100", medio: "efectivo" },
      { importe: 100, medio: "efectivo", clienteId: c.id },
      { importe: 100, medio: "efectivo", saldoCliente: 0 },
      { importe: 100, medio: "efectivo", desconocido: 1 },
    ]) {
      await esperarError(await pagar(cookieAdmin, c.id, cuerpo), 422, "VALIDACION");
    }
    const extra = await esperarError(await pagar(cookieAdmin, c.id, { importe: 100, medio: "efectivo", desconocido: 1 }), 422, "VALIDACION");
    expect(extra.error.details).toEqual([{ campo: "desconocido", mensaje: "Campo no permitido." }]);
    await esperarError(await pagar(cookieAdmin, c.id, "{roto"), 400, "JSON_INVALIDO");
  });
});

// ---------------------------------------------------------------------------
// GET /api/pagos/{id}
// ---------------------------------------------------------------------------

describe("GET /api/pagos/{id}", () => {
  it("devuelve el saldo histórico aunque luego haya otros pagos", async () => {
    const c = await clienteConDeuda(100_000);
    const primero = await esperarJson<PagoPublico>(await pagar(cookieAdmin, c.id, { importe: 30_000, medio: "efectivo" }), 201);
    await esperarJson(await pagar(cookieAdmin, c.id, { importe: 70_000, medio: "efectivo" }), 201);
    const reimpreso = await esperarJson<PagoPublico>(await obtenerPago(cookieAdmin, primero.id), 200);
    expect(reimpreso).toEqual(primero);
    expect(reimpreso.saldoCliente).toBe(70_000);
  });

  it("404 NO_ENCONTRADO si no existe; 422 si el id no es válido", async () => {
    await esperarError(await obtenerPago(cookieAdmin, 999_999), 404, "NO_ENCONTRADO");
    await esperarError(await obtenerPago(cookieAdmin, "x1"), 422, "VALIDACION");
  });
});

// ---------------------------------------------------------------------------
// Sesión, métodos, logs y aislamiento
// ---------------------------------------------------------------------------

describe("sesión, métodos y seguridad", () => {
  it("sin sesión o con una cookie manipulada las tres rutas responden 401", async () => {
    for (const cookie of [undefined, `${cookieAdmin}x`]) {
      await esperarError(await consultarCuenta(cookie, 1), 401, "NO_AUTENTICADO");
      await esperarError(await pagar(cookie, 1, { importe: 100, medio: "efectivo" }), 401, "NO_AUTENTICADO");
      await esperarError(await obtenerPago(cookie, 1), 401, "NO_AUTENTICADO");
    }
  });

  it("un usuario desactivado pierde el acceso aunque conserve la cookie", async () => {
    const c = await clienteConDeuda(10_000);
    const u = await crearUsuarioDePrueba(db, { email: "baja@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
    const cookie = await firmarSesion(u.id);
    await esperarJson(await consultarCuenta(cookie, c.id), 200);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, u.id));
    await esperarError(await consultarCuenta(cookie, c.id), 401, "NO_AUTENTICADO");
    await esperarError(await pagar(cookie, c.id, { importe: 100, medio: "efectivo" }), 401, "NO_AUTENTICADO");
    await esperarError(await obtenerPago(cookie, 1), 401, "NO_AUTENTICADO");
  });

  it("no existen DELETE ni otros métodos de escritura sobre la cuenta o los pagos", () => {
    expect(Object.keys(rutaCuenta).filter((m) => /^[A-Z]+$/.test(m))).toEqual(["GET"]);
    expect(Object.keys(rutaPagosCliente).filter((m) => /^[A-Z]+$/.test(m))).toEqual(["POST"]);
    expect(Object.keys(rutaPago).filter((m) => /^[A-Z]+$/.test(m))).toEqual(["GET"]);
  });

  it("ninguna ruta de la API crea movimientos de cuenta por su cuenta", () => {
    const raiz = join(process.cwd(), "src", "app");
    const rutas: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (nombre === "route.ts") rutas.push(ruta);
      }
    };
    recorrer(raiz);
    const prohibido = /movimientosCuenta|movimientos_cuenta|registrarMovimientoCuenta|registrarDebito|registrarCredito/;
    const infractores = rutas.filter((r) => prohibido.test(readFileSync(r, "utf8"))).map((r) => relative(raiz, r));
    expect(infractores).toEqual([]);
    // Tampoco existe una carpeta de API para movimientos de cuenta.
    expect(existsSync(join(raiz, "api", "movimientos-cuenta"))).toBe(false);
  });

  it("la contraseña, la cookie y el secreto no aparecen en los logs, ni ante un error interno", async () => {
    const c = await clienteConDeuda(10_000);
    const registrado: string[] = [];
    const espias = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        registrado.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack} ${String(a.cause)}` : String(a))).join(" "));
      }),
    );
    try {
      const interno = await esperarError(
        await pagar(cookieVendedor, c.id, { importe: 100, medio: "efectivo", observacion: "FALLA-INTERNA" }),
        500,
        "ERROR_INTERNO",
      );
      expect(JSON.stringify(interno)).not.toMatch(/falla simulada|INSERT|pagos/);
      await pagar(cookieVendedor, c.id, { importe: 100, medio: "efectivo" });
      await consultarCuenta(cookieVendedor, c.id);
    } finally {
      for (const espia of espias) espia.mockRestore();
    }
    const texto = registrado.join("\n");
    expect(registrado.length).toBeGreaterThan(0); // el error interno sí se registró
    expect(texto).not.toContain(cookieVendedor);
    expect(texto).not.toContain(CLAVE_VENDEDOR);
    expect(texto).not.toContain(process.env.SESSION_SECRET!);
    expect(texto).not.toMatch(/\$2[aby]\$/); // ningún hash bcrypt
  });

  it("las pruebas usan una base temporal y no modifican local.db", async () => {
    expect(process.env.DATABASE_URL).toBe("sin-base:usar-src-test-base-de-prueba");
    const ruta = String((await clienteLibsql.execute("PRAGMA database_list")).rows[0].file);
    expect(ruta).toContain("sgc-prueba-");
    expect(huella()).toBe(huellaInicial);
  });
});
