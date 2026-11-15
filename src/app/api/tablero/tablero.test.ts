/**
 * Pruebas de integración de GET /api/tablero (RF-T1 a RF-T3, sección 11.2).
 *
 * Se llama al Route Handler con un NextRequest, igual que Next.js, contra una
 * base SQLite temporal (no toca local.db ni Turso).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { firmarSesion } from "@/lib/sesion-token";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { crearCategoria } from "@/servicios/categorias";
import { emitirFactura } from "@/servicios/facturas";
import { crearProducto } from "@/servicios/productos";
import type { Tablero } from "@/servicios/tablero";
import { esperarError, esperarJson, pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import * as rutaTablero from "./route";

const { cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

// local.db no debe cambiar durante las pruebas.
const RUTA_LOCAL_DB = join(process.cwd(), "local.db");
const huella = () =>
  existsSync(RUTA_LOCAL_DB) ? createHash("sha256").update(readFileSync(RUTA_LOCAL_DB)).digest("hex") : "sin-archivo";
const huellaInicial = huella();

let admin: UsuarioAutenticado;
let cookieAdmin: string;
let cookieVendedor: string;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  cookieAdmin = await firmarSesion(a.id);
  cookieVendedor = await firmarSesion(v.id);

  // Una venta de hoy (fecha real) para que la respuesta tenga datos.
  const { id: categoriaId } = await crearCategoria(admin, { nombre: "Ruta tablero" });
  const p = await crearProducto(admin, {
    codigo: "RT-001", descripcion: "Producto de la ruta", categoriaId, precio: 123_450, stockMinimo: 0, stockInicial: 10,
  });
  await emitirFactura(admin, { clienteId: null, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "contado" } });
});

const consultar = (cookie: string | undefined, consulta = "") =>
  rutaTablero.GET(pedido(`/api/tablero${consulta}`, { cookie }), sinParametros);

describe("GET /api/tablero", () => {
  it("200 para el administrador con el formato completo", async () => {
    const t = await esperarJson<Tablero>(await consultar(cookieAdmin), 200);
    expect(Object.keys(t).sort()).toEqual(
      ["bajoMinimo", "cuentasCorrientes", "hoy", "masVendidos", "mes", "porFormaDePago", "ventasDiarias"].sort(),
    );
    expect(t.hoy).toEqual({ cantidad: 1, importe: 246_900 });
    expect(t.mes).toEqual({ cantidad: 1, importe: 246_900, ticketPromedio: 246_900 });
    expect(t.cuentasCorrientes).toEqual({ totalAdeudado: 0, clientesConSaldo: 0 });
    expect(t.bajoMinimo).toEqual({ cantidad: 0 });
    expect(t.ventasDiarias).toHaveLength(30);
    expect(t.ventasDiarias.at(-1)!.importe).toBe(246_900);
    expect(t.ventasDiarias[0]).toEqual({ fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), importe: 0 });
    expect(t.porFormaDePago.map((f) => f.forma)).toEqual(["contado", "tarjeta", "cuenta_corriente"]);
    expect(t.masVendidos).toEqual([
      { productoId: expect.any(Number), codigo: "RT-001", descripcion: "Producto de la ruta", unidades: 2, importe: 246_900 },
    ]);
  });

  it("200 para el vendedor con los mismos datos", async () => {
    const deAdmin = await esperarJson(await consultar(cookieAdmin), 200);
    expect(await esperarJson(await consultar(cookieVendedor), 200)).toEqual(deAdmin);
  });

  it("ignora cualquier fecha enviada en la consulta: el período lo define el servidor", async () => {
    const normal = await esperarJson(await consultar(cookieVendedor), 200);
    expect(await esperarJson(await consultar(cookieVendedor, "?fecha=2020-01-01&desde=2020-01-01"), 200)).toEqual(normal);
  });

  it("401 sin sesión", async () => {
    await esperarError(await consultar(undefined), 401, "NO_AUTENTICADO");
  });

  it("401 con una cookie manipulada", async () => {
    await esperarError(await consultar(`${cookieAdmin}x`), 401, "NO_AUTENTICADO");
  });

  it("un usuario desactivado pierde el acceso de inmediato", async () => {
    const u = await crearUsuarioDePrueba(db, { email: "baja@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
    const cookie = await firmarSesion(u.id);
    await esperarJson(await consultar(cookie), 200);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, u.id));
    await esperarError(await consultar(cookie), 401, "NO_AUTENTICADO");
  });
});

describe("la ruta es un adaptador fino", () => {
  it("solo exporta GET (no hay métodos de escritura)", () => {
    expect(Object.keys(rutaTablero)).toEqual(["GET"]);
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(rutaTablero).not.toHaveProperty(metodo);
    }
  });

  it("usa rutaProtegida y obtenerTablero, sin SQL ni cálculos", () => {
    const fuente = readFileSync(join(process.cwd(), "src/app/api/tablero/route.ts"), "utf8");
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codigo).toContain("rutaProtegida");
    expect(codigo).toContain("obtenerTablero(usuario)");
    for (const prohibido of ["drizzle", "@/db", "sql`", "select(", "searchParams", "reduce(", "Math."]) {
      expect(codigo).not.toContain(prohibido);
    }
  });
});

describe("aislamiento", () => {
  it("las pruebas no modificaron local.db", () => {
    expect(huella()).toBe(huellaInicial);
  });
});
