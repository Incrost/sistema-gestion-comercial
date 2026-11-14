/**
 * Pruebas de los datos iniciales de clientes (sección 8): cantidad,
 * variedad, idempotencia y saldos en 0. Base temporal.
 */
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { categorias, clientes, facturas, movimientosCuenta, pagos, productos, usuarios } from "@/db/schema";
import { normalizarDocumento } from "@/lib/normalizacion";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { listarClientes } from "@/servicios/clientes";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { sembrarCatalogo } from "./catalogo";
import { CLIENTES_SEMILLA, sembrarClientes } from "./clientes";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
beforeAll(async () => {
  const fila = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin" });
  admin = { id: fila.id, nombre: fila.nombre, email: fila.email, rol: fila.rol };
  await sembrarCatalogo(admin);
});

async function totales() {
  const tablas = { usuarios, categorias, productos, clientes, facturas, pagos, movimientosCuenta };
  const entradas = await Promise.all(
    Object.entries(tablas).map(async ([nombre, tabla]) => [nombre, (await db.select({ n: count() }).from(tabla))[0].n]),
  );
  return Object.fromEntries(entradas) as Record<keyof typeof tablas, number>;
}

describe("sembrarClientes()", () => {
  it("los datos cumplen la consigna y son variados", () => {
    expect(CLIENTES_SEMILLA.length).toBeGreaterThanOrEqual(10);
    const claves = CLIENTES_SEMILLA.map((c) => `${c.tipoDoc}:${normalizarDocumento(c.nroDoc)}`);
    expect(new Set(claves).size).toBe(CLIENTES_SEMILLA.length);
    expect(CLIENTES_SEMILLA.some((c) => c.tipoDoc === "DNI")).toBe(true);
    expect(CLIENTES_SEMILLA.some((c) => c.tipoDoc === "CUIT")).toBe(true);
    for (const campo of ["domicilio", "telefono", "email"] as const) {
      expect(CLIENTES_SEMILLA.some((c) => c[campo])).toBe(true);
      expect(CLIENTES_SEMILLA.some((c) => !c[campo])).toBe(true);
    }
    expect(CLIENTES_SEMILLA.some((c) => c.cuentaCorriente && c.limiteCredito)).toBe(true);
    expect(CLIENTES_SEMILLA.some((c) => c.cuentaCorriente && !c.limiteCredito)).toBe(true);
    expect(CLIENTES_SEMILLA.some((c) => !c.cuentaCorriente)).toBe(true);
    expect(CLIENTES_SEMILLA.some((c) => c.activo === false)).toBe(true);
    expect(CLIENTES_SEMILLA.filter((c) => c.email).every((c) => c.email!.endsWith(".test"))).toBe(true);
  });

  it("crea los clientes con saldo 0 y sin movimientos, pagos ni facturas", async () => {
    const antes = await totales();
    expect(await sembrarClientes(admin)).toEqual({ clientesCreados: CLIENTES_SEMILLA.length, clientesExistentes: 0 });
    const despues = await totales();
    expect(despues).toEqual({ ...antes, clientes: CLIENTES_SEMILLA.length });
    expect(despues.movimientosCuenta + despues.pagos + despues.facturas).toBe(0);

    const todos = await listarClientes(admin, { activo: "todos", pageSize: "100" });
    expect(todos.total).toBe(CLIENTES_SEMILLA.length);
    expect(todos.data.every((c) => c.saldo === 0)).toBe(true);
    expect(todos.data.filter((c) => !c.activo)).toHaveLength(CLIENTES_SEMILLA.filter((c) => c.activo === false).length);
  });

  it("es idempotente: una segunda ejecución no duplica ni modifica nada", async () => {
    const antes = await totales();
    const filasAntes = await db.select().from(clientes);
    expect(await sembrarClientes(admin)).toEqual({ clientesCreados: 0, clientesExistentes: CLIENTES_SEMILLA.length });
    expect(await totales()).toEqual(antes);
    expect(await db.select().from(clientes)).toEqual(filasAntes);
  });
});
