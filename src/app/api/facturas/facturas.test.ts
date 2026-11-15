/**
 * Pruebas de integración de las rutas de facturación (RF-V1 a RF-V6; sección 11.6):
 *   POST /api/facturas
 *   GET  /api/facturas/proximo-numero
 *
 * Se llama a cada Route Handler con un NextRequest, igual que Next.js, contra
 * una base SQLite temporal (no toca local.db ni Turso).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { productos, usuarios } from "@/db/schema";
import { firmarSesion } from "@/lib/sesion-token";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { crearCategoria } from "@/servicios/categorias";
import { crearCliente } from "@/servicios/clientes";
import type { FacturaPublica } from "@/servicios/facturas";
import { crearProducto } from "@/servicios/productos";
import { esperarError, esperarJson, pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import * as rutaProximo from "./proximo-numero/route";
import * as rutaFacturas from "./route";

const { cliente: libsql, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

// local.db no debe cambiar durante las pruebas.
const RUTA_LOCAL_DB = join(process.cwd(), "local.db");
const huella = () =>
  existsSync(RUTA_LOCAL_DB) ? createHash("sha256").update(readFileSync(RUTA_LOCAL_DB)).digest("hex") : "sin-archivo";
const huellaInicial = huella();

let admin: UsuarioAutenticado;
let cookieAdmin: string;
let cookieVendedor: string;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin", nombre: "Laura Méndez" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  cookieAdmin = await firmarSesion(a.id);
  cookieVendedor = await firmarSesion(v.id);
  categoriaId = (await crearCategoria(admin, { nombre: "Rutas" })).id;

  // Falla interna simulada para comprobar que el detalle no llega al cliente.
  await libsql.execute(`
    CREATE TRIGGER falla_interna BEFORE INSERT ON factura_items
    WHEN NEW.codigo = 'FALLA-INTERNA'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

const emitir = (cookie: string | undefined, cuerpo: object | string) =>
  rutaFacturas.POST(pedido("/api/facturas", { metodo: "POST", cookie, cuerpo }), sinParametros);
const proximo = (cookie: string | undefined) =>
  rutaProximo.GET(pedido("/api/facturas/proximo-numero", { cookie }), sinParametros);

let n = 0;
async function nuevoProducto(stock = 10, precio = 190_000, codigo = `RT-${++n}`) {
  return crearProducto(admin, { codigo, descripcion: `Producto ${codigo}`, categoriaId, precio, stockMinimo: 0, stockInicial: stock });
}

let dni = 20_000_000;
const nuevoCliente = (datos: Record<string, unknown> = {}) =>
  crearCliente(admin, { tipoDoc: "DNI", nroDoc: String(++dni), nombre: `Cliente ${dni}`, ...datos });

// ---------------------------------------------------------------------------
// POST /api/facturas
// ---------------------------------------------------------------------------

describe("POST /api/facturas", () => {
  it("201 con la forma pública de la consigna (cuenta corriente)", async () => {
    const p1 = await nuevoProducto(10, 190_000);
    const p2 = await nuevoProducto(10, 1_250_000);
    const c = await nuevoCliente({ nombre: "Mariana López", nroDoc: "28.456.123", domicilio: "Las Heras 455", cuentaCorriente: true, limiteCredito: 40_000_000 });
    const f = await esperarJson<FacturaPublica>(
      await emitir(cookieAdmin, { clienteId: c.id, items: [{ productoId: p1.id, cantidad: 1 }, { productoId: p2.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }),
      201,
    );
    expect(f).toEqual({
      id: expect.any(Number),
      puntoVenta: 1,
      numero: expect.any(Number),
      numeroFormateado: expect.stringMatching(/^0001-\d{8}$/),
      fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      estado: "emitida",
      cliente: { id: c.id, nombre: "Mariana López", tipoDoc: "DNI", nroDoc: c.nroDoc, domicilio: "Las Heras 455" },
      vendedor: { id: admin.id, nombre: "Laura Méndez" },
      items: [
        { productoId: p1.id, codigo: p1.codigo, descripcion: p1.descripcion, cantidad: 1, precioUnitario: 190_000, subtotal: 190_000 },
        { productoId: p2.id, codigo: p2.codigo, descripcion: p2.descripcion, cantidad: 1, precioUnitario: 1_250_000, subtotal: 1_250_000 },
      ],
      total: 1_440_000,
      pago: { forma: "cuenta_corriente" },
      saldoCliente: 1_440_000,
    });
    expect(f.numeroFormateado).toBe(`0001-${String(f.numero).padStart(8, "0")}`);
  });

  it("contado a consumidor final (vendedor): cliente null, montoRecibido y vuelto", async () => {
    const p = await nuevoProducto(10, 150_000);
    const f = await esperarJson<FacturaPublica>(
      await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado", montoRecibido: 200_000 } }),
      201,
    );
    expect(f.cliente).toBeNull();
    expect(f.vendedor.nombre).toBe("Pablo Ruiz");
    expect(f.pago).toEqual({ forma: "contado", montoRecibido: 200_000, vuelto: 50_000 });
  });

  it("tarjeta: solo tipo, marca y últimos 4", async () => {
    const p = await nuevoProducto();
    const f = await esperarJson<FacturaPublica>(
      await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Visa", ultimos4: "1234" } } }),
      201,
    );
    expect(f.pago).toEqual({ forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Visa", ultimos4: "1234" } });
  });

  it("JSON inválido o vacío → 400 JSON_INVALIDO", async () => {
    await esperarError(await emitir(cookieVendedor, "{roto"), 400, "JSON_INVALIDO");
    await esperarError(await emitir(cookieVendedor, ""), 400, "JSON_INVALIDO");
  });

  it("campos inválidos → 422 VALIDACION con detalle por campo", async () => {
    const p = await nuevoProducto();
    const e = await esperarError(
      await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 0, precioUnitario: 1 }], pago: { forma: "contado" }, total: 1 }),
      422,
      "VALIDACION",
    );
    const campos = (e.error.details as { campo: string }[]).map((d) => d.campo).sort();
    expect(campos).toEqual(["items.0.cantidad", "items.0.precioUnitario", "total"]);
    await esperarError(await emitir(cookieVendedor, []), 422, "VALIDACION");
    await esperarError(
      await emitir(cookieVendedor, {
        clienteId: null,
        items: [{ productoId: p.id, cantidad: 1 }],
        pago: { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "1234", numero: "4509953566233704" } },
      }),
      422,
      "VALIDACION",
    );
  });

  it("errores de negocio con su código HTTP: 404, 409, 422", async () => {
    const p = await nuevoProducto(1, 1_000);
    const sinCuenta = await nuevoCliente();
    await esperarError(await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: 999_999, cantidad: 1 }], pago: { forma: "contado" } }), 404, "NO_ENCONTRADO");
    const stock = await esperarError(await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "contado" } }), 409, "STOCK_INSUFICIENTE");
    expect(stock.error.details).toEqual([{ productoId: p.id, solicitado: 2, disponible: 1 }]);
    await esperarError(await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado", montoRecibido: 999 } }), 422, "MONTO_INSUFICIENTE");
    await esperarError(await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }), 422, "CUENTA_CORRIENTE_NO_HABILITADA");
    await esperarError(await emitir(cookieVendedor, { clienteId: sinCuenta.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }), 422, "CUENTA_CORRIENTE_NO_HABILITADA");
  });

  it("un error interno responde 500 ERROR_INTERNO sin detalles", async () => {
    const p = await nuevoProducto(5, 1_000, "FALLA-INTERNA");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const e = await esperarError(await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } }), 500, "ERROR_INTERNO");
      expect(JSON.stringify(e)).not.toMatch(/falla simulada|INSERT|factura_items|SQLITE/);
      expect(e.error.details).toBeUndefined();
    } finally {
      log.mockRestore();
    }
    const [fila] = await db.select({ e: productos.existencia }).from(productos).where(eq(productos.id, p.id));
    expect(fila.e).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// GET /api/facturas/proximo-numero
// ---------------------------------------------------------------------------

describe("GET /api/facturas/proximo-numero", () => {
  it("200 { numeroFormateado }; no consume número y avanza al emitir", async () => {
    const a = await esperarJson<{ numeroFormateado: string }>(await proximo(cookieVendedor), 200);
    const b = await esperarJson<{ numeroFormateado: string }>(await proximo(cookieAdmin), 200);
    expect(Object.keys(a)).toEqual(["numeroFormateado"]);
    expect(a.numeroFormateado).toMatch(/^0001-\d{8}$/);
    expect(b).toEqual(a);

    const p = await nuevoProducto();
    const f = await esperarJson<FacturaPublica>(
      await emitir(cookieVendedor, { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } }),
      201,
    );
    expect(f.numeroFormateado).toBe(a.numeroFormateado);
    const c = await esperarJson<{ numeroFormateado: string }>(await proximo(cookieVendedor), 200);
    expect(c.numeroFormateado).toBe(`0001-${String(f.numero + 1).padStart(8, "0")}`);
  });
});

// ---------------------------------------------------------------------------
// Sesión, métodos y arquitectura
// ---------------------------------------------------------------------------

describe("sesión, métodos y arquitectura", () => {
  it("sin sesión o con cookie manipulada → 401 en ambas rutas", async () => {
    const cuerpo = { clienteId: null, items: [{ productoId: 1, cantidad: 1 }], pago: { forma: "contado" } };
    for (const cookie of [undefined, "cookie-manipulada"]) {
      await esperarError(await emitir(cookie, cuerpo), 401, "NO_AUTENTICADO");
      await esperarError(await proximo(cookie), 401, "NO_AUTENTICADO");
    }
  });

  it("un usuario desactivado pierde el acceso aunque conserve la cookie", async () => {
    const u = await crearUsuarioDePrueba(db, { email: "baja@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
    const cookie = await firmarSesion(u.id);
    const p = await nuevoProducto();
    const cuerpo = { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } };
    await esperarJson(await emitir(cookie, cuerpo), 201);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, u.id));
    await esperarError(await emitir(cookie, cuerpo), 401, "NO_AUTENTICADO");
    await esperarError(await proximo(cookie), 401, "NO_AUTENTICADO");
  });

  it("/api/facturas solo exporta GET y POST; proximo-numero solo GET (sin DELETE)", () => {
    const metodos = (modulo: object) => Object.keys(modulo).filter((m) => /^[A-Z]+$/.test(m)).sort();
    expect(metodos(rutaFacturas)).toEqual(["GET", "POST"]);
    expect(metodos(rutaProximo)).toEqual(["GET"]);
    expect("DELETE" in rutaFacturas).toBe(false);
    expect("DELETE" in rutaProximo).toBe(false);
  });

  it("las rutas no contienen reglas de negocio: solo llaman al servicio", () => {
    for (const archivo of ["route.ts", join("proximo-numero", "route.ts")]) {
      const fuente = readFileSync(join(process.cwd(), "src", "app", "api", "facturas", archivo), "utf8");
      const imports = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
      expect(imports).toEqual(["@/lib/http/ruta", "@/servicios/facturas"]);
      expect(fuente).not.toMatch(/ApiError|@\/db|moverStock|registrarDebito|asignarNumero|existencia|precio|total\s*[=:]/);
    }
  });

  it("las pruebas no modifican local.db", () => {
    expect(huella()).toBe(huellaInicial);
  });
});
