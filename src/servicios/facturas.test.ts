/**
 * Pruebas del servicio de facturación (RF-V1 a RF-V6; reglas 1, 2, 3, 4, 6,
 * 7, 9, 10 y 11; sección 10.8, puntos 3, 4 y 5).
 *
 * Base SQLite temporal REAL, con claves foráneas, CHECK e índices únicos de
 * las migraciones: la atomicidad y la concurrencia no se simulan. Para
 * provocar fallas a mitad de la emisión se crean triggers que abortan:
 * - la inserción de la factura (total 4242);
 * - la inserción de un renglón (código FALLA-ITEM);
 * - el movimiento de stock de un renglón (código FALLA-MOV), después de
 *   insertar la factura, los renglones y el movimiento del renglón anterior;
 * - el débito de cuenta corriente (cliente «Cliente FALLA-DEBITO»).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { facturaItems, facturas, movimientosCuenta, movimientosStock, productos, secuencias } from "@/db/schema";
import { ApiError, normalizarError } from "@/lib/api-error";
import { NOMBRE_CONSUMIDOR_FINAL } from "@/lib/validacion-facturas";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import type { UsuarioAutenticado } from "./auth";
import { crearCategoria } from "./categorias";
import { actualizarCliente, crearCliente } from "./clientes";
import { obtenerSaldo } from "./cuenta-corriente";
import { buscarFacturaPublica, consultarProximoNumero, emitirFactura, type FacturaPublica } from "./facturas";
import { actualizarProducto, crearProducto } from "./productos";

const { cliente: libsql, cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let categoriaId: number;

beforeAll(async () => {
  const a = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-de-prueba-1", rol: "admin", nombre: "Laura Méndez" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-de-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  vendedor = { id: v.id, nombre: v.nombre, email: v.email, rol: v.rol };
  categoriaId = (await crearCategoria(admin, { nombre: "Facturación" })).id;

  await libsql.execute(`
    CREATE TRIGGER falla_factura BEFORE INSERT ON facturas
    WHEN NEW.total = 4242
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
  await libsql.execute(`
    CREATE TRIGGER falla_item BEFORE INSERT ON factura_items
    WHEN NEW.codigo = 'FALLA-ITEM'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
  await libsql.execute(`
    CREATE TRIGGER falla_movimiento BEFORE INSERT ON movimientos_stock
    WHEN NEW.tipo = 'venta' AND (SELECT codigo FROM productos WHERE id = NEW.producto_id) = 'FALLA-MOV'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
  await libsql.execute(`
    CREATE TRIGGER falla_debito BEFORE INSERT ON movimientos_cuenta
    WHEN NEW.tipo = 'debito' AND (SELECT nombre FROM clientes WHERE id = NEW.cliente_id) = 'Cliente FALLA-DEBITO'
    BEGIN SELECT RAISE(ABORT, 'falla simulada'); END`);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

let n = 0;
async function nuevoProducto(datos: { stock?: number; precio?: number; codigo?: string; descripcion?: string } = {}) {
  const codigo = datos.codigo ?? `FA-${++n}`;
  return crearProducto(admin, {
    codigo,
    descripcion: datos.descripcion ?? `Producto ${codigo}`,
    categoriaId,
    precio: datos.precio ?? 100_000,
    stockMinimo: 0,
    stockInicial: datos.stock ?? 10,
  });
}

let dni = 30_000_000;
async function nuevoCliente(datos: Record<string, unknown> = {}) {
  return crearCliente(admin, {
    tipoDoc: "DNI",
    nroDoc: String(++dni),
    nombre: `Cliente ${dni}`,
    domicilio: "Las Heras 455",
    ...datos,
  });
}

const emitir = (cuerpo: unknown, usuario = vendedor) => emitirFactura(usuario, cuerpo);

const contado = (items: { productoId: number; cantidad: number }[], extra: Record<string, unknown> = {}) => ({
  clienteId: null,
  items,
  pago: { forma: "contado", ...extra },
});

/** Ejecuta y devuelve el error normalizado como lo vería la API. */
async function fallo(promesa: Promise<unknown>): Promise<ApiError> {
  try {
    await promesa;
  } catch (error) {
    if (!(error instanceof ApiError) && !(error instanceof Error && error.name === "ZodError")) {
      // Errores internos (triggers): se devuelven como ERROR_INTERNO sin registrar en el log.
      const espia = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        return normalizarError(error);
      } finally {
        espia.mockRestore();
      }
    }
    return normalizarError(error);
  }
  throw new Error("Se esperaba un error");
}

async function existencia(id: number) {
  const [fila] = await db.select({ e: productos.existencia }).from(productos).where(eq(productos.id, id));
  return fila.e;
}

async function ultimaFactura() {
  const [fila] = await db
    .select({ n: secuencias.ultimoNumero })
    .from(secuencias)
    .where(and(eq(secuencias.clave, "factura"), eq(secuencias.puntoVenta, 1)));
  return fila?.n ?? 0;
}

const contar = async (tabla: typeof facturas | typeof facturaItems | typeof movimientosStock | typeof movimientosCuenta) =>
  (await db.select({ n: count() }).from(tabla))[0].n;

/** Foto de todo lo que una emisión podría modificar. */
async function instantanea(productoIds: number[], clienteId?: number) {
  return {
    facturas: await contar(facturas),
    items: await contar(facturaItems),
    movimientosStock: await contar(movimientosStock),
    movimientosCuenta: await contar(movimientosCuenta),
    secuencia: await ultimaFactura(),
    existencias: await Promise.all(productoIds.map(existencia)),
    saldo: clienteId === undefined ? null : await obtenerSaldo(db, clienteId),
  };
}

async function movimientosDeFactura(facturaId: number) {
  return db.select().from(movimientosStock).where(eq(movimientosStock.facturaId, facturaId));
}

async function movimientosCuentaDeFactura(facturaId: number) {
  return db.select().from(movimientosCuenta).where(eq(movimientosCuenta.facturaId, facturaId));
}

/** Regla 2: la suma de movimientos de cada producto coincide con su existencia. */
async function esperarStockCuadrado() {
  const sumas = await db
    .select({ productoId: movimientosStock.productoId, suma: sql<number>`sum(${movimientosStock.cantidad})` })
    .from(movimientosStock)
    .groupBy(movimientosStock.productoId);
  const sumaPorProducto = new Map(sumas.map((s) => [s.productoId, Number(s.suma)]));
  const filas = await db.select({ id: productos.id, existencia: productos.existencia }).from(productos);
  for (const fila of filas) expect(sumaPorProducto.get(fila.id) ?? 0).toBe(fila.existencia);
}

// ---------------------------------------------------------------------------
// Contado — RF-V2, RF-V5
// ---------------------------------------------------------------------------

describe("contado", () => {
  it("consumidor final: 201-forma pública completa, cliente null, vuelto calculado", async () => {
    const p1 = await nuevoProducto({ precio: 190_000, codigo: "EL-001", descripcion: "Cinta aisladora 20 m" });
    const p2 = await nuevoProducto({ precio: 1_250_000, codigo: "HE-001", descripcion: "Martillo carpintero 500 g" });
    const antes = Date.now();
    const f = await emitir(contado([{ productoId: p1.id, cantidad: 1 }, { productoId: p2.id, cantidad: 2 }], { montoRecibido: 3_000_000 }));

    expect(Object.keys(f)).toEqual([
      "id", "puntoVenta", "numero", "numeroFormateado", "fecha", "estado", "cliente", "vendedor", "items", "total", "pago",
    ]);
    expect(f).toMatchObject({
      puntoVenta: 1,
      numeroFormateado: `0001-${String(f.numero).padStart(8, "0")}`,
      estado: "emitida",
      cliente: null,
      vendedor: { id: vendedor.id, nombre: "Pablo Ruiz" },
      items: [
        { productoId: p1.id, codigo: "EL-001", descripcion: "Cinta aisladora 20 m", cantidad: 1, precioUnitario: 190_000, subtotal: 190_000 },
        { productoId: p2.id, codigo: "HE-001", descripcion: "Martillo carpintero 500 g", cantidad: 2, precioUnitario: 1_250_000, subtotal: 2_500_000 },
      ],
      total: 2_690_000,
      pago: { forma: "contado", montoRecibido: 3_000_000, vuelto: 310_000 },
    });
    expect(f.fecha).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(f.fecha)).toBeGreaterThanOrEqual(antes - 1000);
    expect("saldoCliente" in f).toBe(false);

    // Comprador congelado de manera coherente.
    const [fila] = await db.select().from(facturas).where(eq(facturas.id, f.id));
    expect(fila).toMatchObject({
      clienteId: null,
      compradorNombre: NOMBRE_CONSUMIDOR_FINAL,
      compradorTipoDoc: null,
      compradorNroDoc: null,
      compradorDomicilio: null,
      vendedorId: vendedor.id,
      formaPago: "contado",
      montoRecibido: 3_000_000,
      tarjetaTipo: null,
      tarjetaMarca: null,
      tarjetaUltimos4: null,
    });
  });

  it("cliente registrado: congela nombre, documento y domicilio", async () => {
    const p = await nuevoProducto();
    const c = await nuevoCliente({ nroDoc: "28.456.123", nombre: "Mariana López", domicilio: "Las Heras 455" });
    const f = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    expect(f.cliente).toEqual({ id: c.id, nombre: "Mariana López", tipoDoc: "DNI", nroDoc: c.nroDoc, domicilio: "Las Heras 455" });
    const [fila] = await db.select().from(facturas).where(eq(facturas.id, f.id));
    expect(fila).toMatchObject({
      clienteId: c.id,
      compradorNombre: "Mariana López",
      compradorTipoDoc: "DNI",
      compradorNroDoc: c.nroDoc,
      compradorDomicilio: "Las Heras 455",
    });
  });

  it("montoRecibido omitido se toma como el total (vuelto 0)", async () => {
    const p = await nuevoProducto({ precio: 12_345 });
    const f = await emitir(contado([{ productoId: p.id, cantidad: 3 }]));
    expect(f.total).toBe(37_035);
    expect(f.pago).toEqual({ forma: "contado", montoRecibido: 37_035, vuelto: 0 });
  });

  it("montoRecibido igual al total se acepta; uno menor → 422 MONTO_INSUFICIENTE sin grabar nada", async () => {
    const p = await nuevoProducto({ precio: 50_000 });
    const exacto = await emitir(contado([{ productoId: p.id, cantidad: 2 }], { montoRecibido: 100_000 }));
    expect(exacto.pago).toEqual({ forma: "contado", montoRecibido: 100_000, vuelto: 0 });

    const antes = await instantanea([p.id]);
    const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: 2 }], { montoRecibido: 99_999 })));
    expect(e.status).toBe(422);
    expect(e.code).toBe("MONTO_INSUFICIENTE");
    expect(e.details).toEqual({ campo: "pago.montoRecibido", total: 100_000, montoRecibido: 99_999, faltante: 1 });
    expect(await instantanea([p.id])).toEqual(antes);
  });

  it("contado y tarjeta no crean movimientos de cuenta corriente", async () => {
    const p = await nuevoProducto();
    const c = await nuevoCliente({ cuentaCorriente: true });
    const f1 = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    const f2 = await emitir({
      clienteId: c.id,
      items: [{ productoId: p.id, cantidad: 1 }],
      pago: { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "1234" } },
    });
    expect(await movimientosCuentaDeFactura(f1.id)).toHaveLength(0);
    expect(await movimientosCuentaDeFactura(f2.id)).toHaveLength(0);
    expect(await obtenerSaldo(db, c.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tarjeta — RF-V5, regla 9
// ---------------------------------------------------------------------------

describe("tarjeta (regla 9)", () => {
  it.each(["debito", "credito"] as const)("%s: guarda y devuelve solo tipo, marca y últimos 4", async (tipo) => {
    const p = await nuevoProducto();
    const f = await emitir({
      clienteId: null,
      items: [{ productoId: p.id, cantidad: 1 }],
      pago: { forma: "tarjeta", tarjeta: { tipo, marca: "  Visa ", ultimos4: "4321" } },
    });
    expect(f.pago).toEqual({ forma: "tarjeta", tarjeta: { tipo, marca: "Visa", ultimos4: "4321" } });
    const [fila] = await db.select().from(facturas).where(eq(facturas.id, f.id));
    expect(fila).toMatchObject({ formaPago: "tarjeta", tarjetaTipo: tipo, tarjetaMarca: "Visa", tarjetaUltimos4: "4321", montoRecibido: null });
  });

  it("últimos 4 inválidos → 422 VALIDACION", async () => {
    const p = await nuevoProducto();
    for (const ultimos4 of ["123", "12345", "12a4"]) {
      const e = await fallo(
        emitir({ clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4 } } }),
      );
      expect(e.code).toBe("VALIDACION");
      expect(e.details).toEqual([{ campo: "pago.tarjeta.ultimos4", mensaje: "Debe tener exactamente 4 dígitos." }]);
    }
  });

  it("número completo, CVV, vencimiento y campos extra → 422 VALIDACION; nada se graba", async () => {
    const p = await nuevoProducto();
    const antes = await instantanea([p.id]);
    for (const campo of ["numero", "numeroCompleto", "cvv", "vencimiento", "titular"]) {
      const e = await fallo(
        emitir({
          clienteId: null,
          items: [{ productoId: p.id, cantidad: 1 }],
          pago: { forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Visa", ultimos4: "3704", [campo]: "4509953566233704" } },
        }),
      );
      expect(e.status).toBe(422);
      expect(e.code).toBe("VALIDACION");
      expect(e.details).toEqual([expect.objectContaining({ campo: `pago.tarjeta.${campo}` })]);
    }
    expect(await instantanea([p.id])).toEqual(antes);
    // Ninguna columna de la base contiene el número completo.
    const texto = JSON.stringify(await db.select().from(facturas));
    expect(texto).not.toContain("4509953566233704");
  });
});

// ---------------------------------------------------------------------------
// Cuenta corriente — reglas 6 y 7
// ---------------------------------------------------------------------------

describe("cuenta corriente", () => {
  it("válida: un débito por el total, saldoCliente en la respuesta", async () => {
    const p = await nuevoProducto({ precio: 720_000 });
    const c = await nuevoCliente({ cuentaCorriente: true, limiteCredito: 40_000_000 });
    const f = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } });

    expect(f.pago).toEqual({ forma: "cuenta_corriente" });
    expect(f.total).toBe(1_440_000);
    expect(f.saldoCliente).toBe(1_440_000);
    expect(Object.keys(f).at(-1)).toBe("saldoCliente");

    const debitos = await movimientosCuentaDeFactura(f.id);
    expect(debitos).toHaveLength(1);
    expect(debitos[0]).toMatchObject({
      clienteId: c.id,
      tipo: "debito",
      importe: 1_440_000,
      descripcion: `Factura ${f.numeroFormateado}`,
      facturaId: f.id,
      pagoId: null,
    });
    expect(debitos[0].fecha.toISOString()).toBe(f.fecha);
    expect(await obtenerSaldo(db, c.id)).toBe(1_440_000);

    // Una segunda venta acumula el saldo.
    const f2 = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } });
    expect(f2.saldoCliente).toBe(2_160_000);
  });

  it("consumidor final no puede comprar a cuenta → 422 CUENTA_CORRIENTE_NO_HABILITADA", async () => {
    const p = await nuevoProducto();
    const antes = await instantanea([p.id]);
    for (const cuerpo of [
      { clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } },
      { items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } },
    ]) {
      const e = await fallo(emitir(cuerpo));
      expect(e.status).toBe(422);
      expect(e.code).toBe("CUENTA_CORRIENTE_NO_HABILITADA");
    }
    expect(await instantanea([p.id])).toEqual(antes);
  });

  it("cliente sin cuenta corriente habilitada → 422 CUENTA_CORRIENTE_NO_HABILITADA", async () => {
    const p = await nuevoProducto();
    const c = await nuevoCliente({ cuentaCorriente: false });
    const antes = await instantanea([p.id], c.id);
    const e = await fallo(emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }));
    expect(e.code).toBe("CUENTA_CORRIENTE_NO_HABILITADA");
    expect(e.status).toBe(422);
    expect(await instantanea([p.id], c.id)).toEqual(antes);
  });

  it("límite de crédito: llegar exactamente al límite se permite; superarlo → LIMITE_CREDITO_EXCEDIDO con details", async () => {
    const p = await nuevoProducto({ precio: 2_500 });
    const c = await nuevoCliente({ cuentaCorriente: true, limiteCredito: 10_000 });
    const f = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 4 }], pago: { forma: "cuenta_corriente" } });
    expect(f.saldoCliente).toBe(10_000);

    const antes = await instantanea([p.id], c.id);
    const e = await fallo(emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }));
    expect(e.status).toBe(422);
    expect(e.code).toBe("LIMITE_CREDITO_EXCEDIDO");
    expect(e.details).toEqual({ saldoActual: 10_000, limite: 10_000, total: 2_500, excedente: 2_500 });
    expect(await instantanea([p.id], c.id)).toEqual(antes);
  });

  it("límite con saldo previo: details con saldoActual, limite y excedente correctos", async () => {
    const p = await nuevoProducto({ precio: 3_000 });
    const c = await nuevoCliente({ cuentaCorriente: true, limiteCredito: 10_000 });
    await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } });
    const e = await fallo(emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } }));
    expect(e.details).toEqual({ saldoActual: 6_000, limite: 10_000, total: 6_000, excedente: 2_000 });
  });

  it("cliente sin límite puede comprar a cuenta cualquier importe válido", async () => {
    const p = await nuevoProducto({ precio: 99_999_999_999, stock: 5 });
    const c = await nuevoCliente({ cuentaCorriente: true, limiteCredito: null });
    const f = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 3 }], pago: { forma: "cuenta_corriente" } });
    expect(f.saldoCliente).toBe(299_999_999_997);
  });

  it("límite 0: cualquier venta a cuenta lo supera", async () => {
    const p = await nuevoProducto({ precio: 1 });
    const c = await nuevoCliente({ cuentaCorriente: true, limiteCredito: 0 });
    const e = await fallo(emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }));
    expect(e.code).toBe("LIMITE_CREDITO_EXCEDIDO");
  });
});

// ---------------------------------------------------------------------------
// Cliente — RF-V2
// ---------------------------------------------------------------------------

describe("cliente", () => {
  it("un cliente inactivo no puede comprar (422 al admin, 404 al vendedor); nada se graba", async () => {
    const p = await nuevoProducto();
    const c = await nuevoCliente({ cuentaCorriente: true });
    await actualizarCliente(admin, { id: String(c.id) }, { activo: false });
    const antes = await instantanea([p.id]);
    for (const forma of ["contado", "cuenta_corriente"]) {
      const cuerpo = { clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma } };
      const eAdmin = await fallo(emitir(cuerpo, admin));
      expect([eAdmin.status, eAdmin.code]).toEqual([422, "VALIDACION"]);
      expect(eAdmin.details).toEqual([{ campo: "clienteId", mensaje: "El cliente está dado de baja." }]);
      const eVendedor = await fallo(emitir(cuerpo, vendedor));
      expect([eVendedor.status, eVendedor.code]).toEqual([404, "NO_ENCONTRADO"]);
    }
    expect(await instantanea([p.id])).toEqual(antes);
  });

  it("cliente inexistente → 404 NO_ENCONTRADO", async () => {
    const p = await nuevoProducto();
    const e = await fallo(emitir({ clienteId: 999_999, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } }));
    expect([e.status, e.code]).toEqual([404, "NO_ENCONTRADO"]);
  });

  it("cambiar después los datos del cliente no altera la factura emitida", async () => {
    const p = await nuevoProducto();
    const c = await nuevoCliente({ nombre: "Nombre Original", domicilio: "Calle Vieja 1" });
    const f = await emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "contado" } });
    await actualizarCliente(admin, { id: String(c.id) }, { nombre: "Nombre Nuevo", domicilio: "Calle Nueva 2" });
    const leida = await buscarFacturaPublica(db, f.id);
    expect(leida?.cliente).toEqual(f.cliente);
    expect(leida?.cliente?.nombre).toBe("Nombre Original");
  });
});

// ---------------------------------------------------------------------------
// Productos, precios y totales — RF-V3, reglas 3 y 10
// ---------------------------------------------------------------------------

describe("productos, precios y totales", () => {
  it("producto inexistente → 404 NO_ENCONTRADO con productoId en details", async () => {
    const p = await nuevoProducto();
    const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: 1 }, { productoId: 888_888, cantidad: 1 }])));
    expect([e.status, e.code]).toEqual([404, "NO_ENCONTRADO"]);
    expect(e.details).toEqual([{ campo: "items.1.productoId", productoId: 888_888, mensaje: "El producto no existe." }]);
  });

  it("producto inactivo → 422 PRODUCTO_INACTIVO (ambos roles); nada se graba", async () => {
    const p = await nuevoProducto();
    await actualizarProducto(admin, { id: String(p.id) }, { activo: false });
    const antes = await instantanea([p.id]);
    for (const usuario of [admin, vendedor]) {
      const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: 1 }]), usuario));
      expect([e.status, e.code]).toEqual([422, "PRODUCTO_INACTIVO"]);
      expect(e.details).toEqual([{ campo: "items.0.productoId", productoId: p.id, mensaje: "El producto está dado de baja." }]);
    }
    expect(await instantanea([p.id])).toEqual(antes);
  });

  it("lista vacía y producto repetido → 422 VALIDACION", async () => {
    const p = await nuevoProducto();
    expect((await fallo(emitir(contado([])))).code).toBe("VALIDACION");
    const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: 1 }, { productoId: p.id, cantidad: 2 }])));
    expect(e.code).toBe("VALIDACION");
    expect(e.details).toEqual([expect.objectContaining({ campo: "items.1.productoId" })]);
  });

  it.each([0, -1, 1.5, "2", 100_001, 1e20])("cantidad %j → 422 VALIDACION", async (cantidad) => {
    const p = await nuevoProducto();
    const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: cantidad as number }])));
    expect([e.status, e.code]).toEqual([422, "VALIDACION"]);
    expect((e.details as { campo: string }[]).every((d) => d.campo === "items.0.cantidad")).toBe(true);
  });

  it("precios, subtotales y total enviados por el cliente se rechazan", async () => {
    const p = await nuevoProducto();
    const casos = [
      { ...contado([{ productoId: p.id, cantidad: 1 }]), total: 1 },
      { ...contado([{ productoId: p.id, cantidad: 1 }]), subtotal: 1 },
      contado([{ productoId: p.id, cantidad: 1, precio: 1 } as never]),
      contado([{ productoId: p.id, cantidad: 1, precioUnitario: 1 } as never]),
      contado([{ productoId: p.id, cantidad: 1, subtotal: 1 } as never]),
      { ...contado([{ productoId: p.id, cantidad: 1 }]), vendedorId: admin.id },
    ];
    for (const cuerpo of casos) expect((await fallo(emitir(cuerpo))).code).toBe("VALIDACION");
  });

  it("el total se calcula con los precios de la base, en centavos enteros", async () => {
    const a = await nuevoProducto({ precio: 1_999 });
    const b = await nuevoProducto({ precio: 10 });
    const c = await nuevoProducto({ precio: 333 });
    const f = await emitir(contado([{ productoId: a.id, cantidad: 3 }, { productoId: b.id, cantidad: 7 }, { productoId: c.id, cantidad: 3 }]));
    expect(f.items.map((i) => i.subtotal)).toEqual([5_997, 70, 999]);
    expect(f.total).toBe(7_066);
    // Regla 10: todos los importes son enteros (nunca coma flotante).
    for (const valor of [f.total, ...f.items.flatMap((i) => [i.precioUnitario, i.subtotal])]) {
      expect(Number.isSafeInteger(valor)).toBe(true);
    }
    const [fila] = await db.select({ total: facturas.total }).from(facturas).where(eq(facturas.id, f.id));
    expect(fila.total).toBe(7_066);
    // La base guarda enteros.
    const tipos = await libsql.execute({ sql: "select typeof(total) t from facturas where id = ?", args: [f.id] });
    expect(tipos.rows[0].t).toBe("integer");
  });

  it("precio, código y descripción quedan congelados; cambiar el catálogo no altera la factura", async () => {
    const p = await nuevoProducto({ precio: 190_000, descripcion: "Cinta aisladora 20 m" });
    const f = await emitir(contado([{ productoId: p.id, cantidad: 2 }]));
    const [renglon] = await db.select().from(facturaItems).where(eq(facturaItems.facturaId, f.id));
    expect(renglon).toMatchObject({ productoId: p.id, codigo: p.codigo, descripcion: "Cinta aisladora 20 m", cantidad: 2, precioUnitario: 190_000, subtotal: 380_000 });

    await actualizarProducto(admin, { id: String(p.id) }, { precio: 250_000, descripcion: "Cinta aisladora 25 m", codigo: `${p.codigo}-X` });
    const leida = await buscarFacturaPublica(db, f.id);
    expect(leida?.items).toEqual(f.items);
    expect(leida?.total).toBe(380_000);
    // Una venta nueva usa el precio nuevo.
    const nueva = await emitir(contado([{ productoId: p.id, cantidad: 1 }]));
    expect(nueva.items[0]).toMatchObject({ precioUnitario: 250_000, descripcion: "Cinta aisladora 25 m" });
  });

  it("desbordamientos: subtotal o total fuera de rango → 422 VALIDACION (no ERROR_INTERNO)", async () => {
    const caro = await nuevoProducto({ precio: 99_999_999_999, stock: 100_000 });
    const caro2 = await nuevoProducto({ precio: 99_999_999_999, stock: 1_000 });
    const antes = await instantanea([caro.id, caro2.id]);

    // 100.000 × 99.999.999.999 supera incluso Number.MAX_SAFE_INTEGER.
    const e1 = await fallo(emitir(contado([{ productoId: caro.id, cantidad: 100_000 }])));
    expect([e1.status, e1.code]).toEqual([422, "VALIDACION"]);
    expect(e1.details).toEqual([{ campo: "items.0.cantidad", mensaje: "El subtotal del renglón supera el importe máximo admitido." }]);

    // Cada subtotal entra en el máximo, pero la suma no.
    const e2 = await fallo(emitir(contado([{ productoId: caro.id, cantidad: 1_000 }, { productoId: caro2.id, cantidad: 1_000 }])));
    expect([e2.status, e2.code]).toEqual([422, "VALIDACION"]);
    expect(e2.details).toEqual([{ campo: "items", mensaje: "El total de la factura supera el importe máximo admitido." }]);

    expect(await instantanea([caro.id, caro2.id])).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// Stock — RF-V4, reglas 1, 2 y 11
// ---------------------------------------------------------------------------

describe("stock", () => {
  it("vender exactamente la existencia se permite y la deja en 0", async () => {
    const p = await nuevoProducto({ stock: 3 });
    await emitir(contado([{ productoId: p.id, cantidad: 3 }]));
    expect(await existencia(p.id)).toBe(0);
  });

  it("stock insuficiente → 409 STOCK_INSUFICIENTE con productoId, solicitado y disponible", async () => {
    const p = await nuevoProducto({ stock: 2 });
    const antes = await instantanea([p.id]);
    const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: 3 }])));
    expect([e.status, e.code]).toEqual([409, "STOCK_INSUFICIENTE"]);
    expect(e.details).toEqual([{ productoId: p.id, solicitado: 3, disponible: 2 }]);
    expect(await instantanea([p.id])).toEqual(antes);
  });

  it("varios productos sin stock se informan todos juntos, antes de escribir", async () => {
    const a = await nuevoProducto({ stock: 1 });
    const b = await nuevoProducto({ stock: 10 });
    const c = await nuevoProducto({ stock: 0 });
    const antes = await instantanea([a.id, b.id, c.id]);
    const e = await fallo(emitir(contado([{ productoId: a.id, cantidad: 2 }, { productoId: b.id, cantidad: 5 }, { productoId: c.id, cantidad: 1 }])));
    expect(e.code).toBe("STOCK_INSUFICIENTE");
    expect(e.details).toEqual([
      { productoId: a.id, solicitado: 2, disponible: 1 },
      { productoId: c.id, solicitado: 1, disponible: 0 },
    ]);
    expect(await instantanea([a.id, b.id, c.id])).toEqual(antes);
  });

  it("un movimiento de venta por renglón, con cantidad negativa, existencia resultante, usuario, fecha y factura", async () => {
    const a = await nuevoProducto({ stock: 10 });
    const b = await nuevoProducto({ stock: 4 });
    const antes = Date.now();
    const f = await emitir(contado([{ productoId: a.id, cantidad: 3 }, { productoId: b.id, cantidad: 4 }]), admin);
    const despues = Date.now();

    const movimientos = await movimientosDeFactura(f.id);
    expect(movimientos).toHaveLength(2);
    const porProducto = new Map(movimientos.map((m) => [m.productoId, m]));
    expect(porProducto.get(a.id)).toMatchObject({ tipo: "venta", cantidad: -3, existenciaResultante: 7, motivo: "Venta", usuarioId: admin.id, facturaId: f.id });
    expect(porProducto.get(b.id)).toMatchObject({ tipo: "venta", cantidad: -4, existenciaResultante: 0, motivo: "Venta", usuarioId: admin.id, facturaId: f.id });
    for (const m of movimientos) {
      expect(m.fecha.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(m.fecha.getTime()).toBeLessThanOrEqual(despues + 1000);
    }
    expect(await existencia(a.id)).toBe(7);
    expect(await existencia(b.id)).toBe(0);
    await esperarStockCuadrado();
  });

  it("la existencia nunca queda negativa y la suma de movimientos coincide con la existencia", async () => {
    const [{ negativos }] = await db.select({ negativos: count() }).from(productos).where(sql`${productos.existencia} < 0`);
    expect(negativos).toBe(0);
    await esperarStockCuadrado();
  });
});

// ---------------------------------------------------------------------------
// Numeración — regla 4
// ---------------------------------------------------------------------------

describe("numeración (regla 4)", () => {
  it("correlativa: cada factura toma el siguiente número", async () => {
    const p = await nuevoProducto({ stock: 10 });
    const inicial = await ultimaFactura();
    const numeros: number[] = [];
    for (let i = 0; i < 3; i++) numeros.push((await emitir(contado([{ productoId: p.id, cantidad: 1 }]))).numero);
    expect(numeros).toEqual([inicial + 1, inicial + 2, inicial + 3]);
  });

  it("proximo-numero es informativo: no consume y coincide con el que se asigna", async () => {
    const p = await nuevoProducto();
    const primero = await consultarProximoNumero(vendedor);
    const segundo = await consultarProximoNumero(admin);
    expect(segundo).toEqual(primero);
    expect(Object.keys(primero)).toEqual(["numeroFormateado"]);
    expect(primero.numeroFormateado).toBe(`0001-${String((await ultimaFactura()) + 1).padStart(8, "0")}`);
    const f = await emitir(contado([{ productoId: p.id, cantidad: 1 }]));
    expect(f.numeroFormateado).toBe(primero.numeroFormateado);
    expect((await consultarProximoNumero(vendedor)).numeroFormateado).toBe(`0001-${String(f.numero + 1).padStart(8, "0")}`);
  });

  it("una operación fallida no consume número ni deja huecos", async () => {
    const p = await nuevoProducto({ stock: 1, precio: 1_000 });
    const previo = await consultarProximoNumero(vendedor);
    await fallo(emitir(contado([{ productoId: p.id, cantidad: 2 }]))); // stock
    await fallo(emitir(contado([{ productoId: p.id, cantidad: 1 }], { montoRecibido: 1 }))); // monto
    await fallo(emitir({ clienteId: null, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }));
    expect(await consultarProximoNumero(vendedor)).toEqual(previo);
    const f = await emitir(contado([{ productoId: p.id, cantidad: 1 }]));
    expect(f.numeroFormateado).toBe(previo.numeroFormateado);
  });

  it("proximo-numero exige usuario", async () => {
    await expect(consultarProximoNumero(null as never)).rejects.toMatchObject({ code: "NO_AUTENTICADO" });
  });
});

// ---------------------------------------------------------------------------
// Atomicidad — RF-V6 (sección 10.8, punto 3)
// ---------------------------------------------------------------------------

describe("atomicidad: una falla a mitad de camino no deja nada", () => {
  it("falla al insertar la factura (después de asignar el número)", async () => {
    const p = await nuevoProducto({ precio: 4_242, stock: 5 });
    const antes = await instantanea([p.id]);
    const e = await fallo(emitir(contado([{ productoId: p.id, cantidad: 1 }])));
    expect(e.code).toBe("ERROR_INTERNO");
    expect(await instantanea([p.id])).toEqual(antes);
  });

  it("falla al insertar un renglón (después de insertar la factura)", async () => {
    const ok = await nuevoProducto({ stock: 5 });
    const malo = await nuevoProducto({ stock: 5, codigo: "FALLA-ITEM" });
    const antes = await instantanea([ok.id, malo.id]);
    const e = await fallo(emitir(contado([{ productoId: ok.id, cantidad: 1 }, { productoId: malo.id, cantidad: 1 }])));
    expect(e.code).toBe("ERROR_INTERNO");
    expect(await instantanea([ok.id, malo.id])).toEqual(antes);
  });

  it("falla moverStock del segundo renglón (después de factura, renglones y el primer movimiento)", async () => {
    const ok = await nuevoProducto({ stock: 5 });
    const malo = await nuevoProducto({ stock: 5, codigo: "FALLA-MOV" });
    const c = await nuevoCliente({ cuentaCorriente: true });
    const antes = await instantanea([ok.id, malo.id], c.id);
    const e = await fallo(
      emitir({ clienteId: c.id, items: [{ productoId: ok.id, cantidad: 2 }, { productoId: malo.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }),
    );
    expect(e.code).toBe("ERROR_INTERNO");
    // La existencia del primer producto (ya descontada dentro de la transacción) se restituye.
    expect(await instantanea([ok.id, malo.id], c.id)).toEqual(antes);
  });

  it("falla registrarDebito (después de factura, renglones y stock)", async () => {
    const p = await nuevoProducto({ stock: 5 });
    const c = await nuevoCliente({ cuentaCorriente: true, nombre: "Cliente FALLA-DEBITO" });
    const antes = await instantanea([p.id], c.id);
    const e = await fallo(emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" } }));
    expect(e.code).toBe("ERROR_INTERNO");
    expect(await instantanea([p.id], c.id)).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// Concurrencia — reglas 1, 4 y 7 (sección 10.8, punto 4)
// ---------------------------------------------------------------------------

describe("concurrencia", () => {
  it("dos ventas simultáneas de la última unidad: solo una se confirma", async () => {
    const p = await nuevoProducto({ stock: 1 });
    const c = await nuevoCliente({ cuentaCorriente: true });
    const antes = await instantanea([p.id]);
    const resultados = await Promise.allSettled([
      emitir(contado([{ productoId: p.id, cantidad: 1 }]), vendedor),
      emitir({ clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } }, admin),
    ]);
    const ok = resultados.filter((r): r is PromiseFulfilledResult<FacturaPublica> => r.status === "fulfilled");
    const rechazadas = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect(normalizarError(rechazadas[0].reason)).toMatchObject({ status: 409, code: "STOCK_INSUFICIENTE" });

    const despues = await instantanea([p.id]);
    expect(despues.facturas).toBe(antes.facturas + 1);
    expect(despues.items).toBe(antes.items + 1);
    expect(despues.movimientosStock).toBe(antes.movimientosStock + 1);
    expect(despues.secuencia).toBe(antes.secuencia + 1);
    expect(despues.existencias).toEqual([0]);
    // Si la que falló era la venta a cuenta, no dejó débito.
    const debitosTotales = despues.movimientosCuenta - antes.movimientosCuenta;
    expect(debitosTotales).toBe(ok[0].value.pago.forma === "cuenta_corriente" ? 1 : 0);
    expect(ok[0].value.numero).toBe(antes.secuencia + 1);
    await esperarStockCuadrado();
  });

  it("varias ventas simultáneas conservan la numeración sin huecos ni repetidos", async () => {
    const p = await nuevoProducto({ stock: 100 });
    const inicial = await ultimaFactura();
    const cantidad = 8;
    const facturasEmitidas = await Promise.all(
      Array.from({ length: cantidad }, (_, i) => emitir(contado([{ productoId: p.id, cantidad: 1 }]), i % 2 ? admin : vendedor)),
    );
    const numeros = facturasEmitidas.map((f) => f.numero).sort((x, y) => x - y);
    expect(numeros).toEqual(Array.from({ length: cantidad }, (_, i) => inicial + i + 1));
    expect(await existencia(p.id)).toBe(100 - cantidad);
  });

  it("ventas simultáneas con faltante intercalado: los números siguen sin huecos", async () => {
    const p = await nuevoProducto({ stock: 3 });
    const inicial = await ultimaFactura();
    const resultados = await Promise.allSettled(Array.from({ length: 6 }, () => emitir(contado([{ productoId: p.id, cantidad: 1 }]))));
    const numeros = resultados
      .filter((r): r is PromiseFulfilledResult<FacturaPublica> => r.status === "fulfilled")
      .map((r) => r.value.numero)
      .sort((x, y) => x - y);
    expect(numeros).toEqual([inicial + 1, inicial + 2, inicial + 3]);
    expect(await ultimaFactura()).toBe(inicial + 3);
    expect(await existencia(p.id)).toBe(0);
  });

  it("dos ventas a cuenta simultáneas respetan el límite de crédito", async () => {
    const p = await nuevoProducto({ precio: 6_000, stock: 10 });
    const c = await nuevoCliente({ cuentaCorriente: true, limiteCredito: 10_000 });
    const venta = { clienteId: c.id, items: [{ productoId: p.id, cantidad: 1 }], pago: { forma: "cuenta_corriente" } };
    const resultados = await Promise.allSettled([emitir(venta, vendedor), emitir(venta, admin)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazo = resultados.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(normalizarError(rechazo.reason)).toMatchObject({ code: "LIMITE_CREDITO_EXCEDIDO", details: { saldoActual: 6_000, limite: 10_000, excedente: 2_000 } });
    expect(await obtenerSaldo(db, c.id)).toBe(6_000);
    expect(await existencia(p.id)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Representación pública, permisos y código
// ---------------------------------------------------------------------------

describe("representación pública y permisos", () => {
  it("no expone columnas internas ni datos sensibles", async () => {
    const p = await nuevoProducto();
    const c = await nuevoCliente({ cuentaCorriente: true });
    const f = await emitir({
      clienteId: c.id,
      items: [{ productoId: p.id, cantidad: 1 }],
      pago: { forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Mastercard", ultimos4: "9999" } },
    });
    const texto = JSON.stringify(f);
    for (const interno of [
      "compradorNombre", "compradorTipoDoc", "compradorNroDoc", "compradorDomicilio", "vendedorId", "clienteId",
      "formaPago", "tarjetaTipo", "tarjetaMarca", "tarjetaUltimos4", "montoRecibido", "motivoAnulacion",
      "fechaAnulacion", "anuladaPorId", "creadoEn", "passwordHash", "email", "existencia", "facturaId",
    ]) {
      expect(texto).not.toContain(`"${interno}"`);
    }
    expect(Object.keys(f.vendedor)).toEqual(["id", "nombre"]);
    expect(Object.keys(f.cliente!)).toEqual(["id", "nombre", "tipoDoc", "nroDoc", "domicilio"]);
    expect(Object.keys(f.items[0])).toEqual(["productoId", "codigo", "descripcion", "cantidad", "precioUnitario", "subtotal"]);
    expect(f.pago).toEqual({ forma: "tarjeta", tarjeta: { tipo: "credito", marca: "Mastercard", ultimos4: "9999" } });
  });

  it("ambos roles pueden emitir; sin usuario → 401", async () => {
    const p = await nuevoProducto();
    expect((await emitir(contado([{ productoId: p.id, cantidad: 1 }]), admin)).vendedor.id).toBe(admin.id);
    expect((await emitir(contado([{ productoId: p.id, cantidad: 1 }]), vendedor)).vendedor.id).toBe(vendedor.id);
    expect((await fallo(emitirFactura(null as never, contado([{ productoId: p.id, cantidad: 1 }])))).code).toBe("NO_AUTENTICADO");
  });

  it("el servicio no modifica la existencia directamente: delega en moverStock() y registrarDebito()", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "servicios", "facturas.ts"), "utf8");
    expect(fuente).not.toMatch(/\.update\(\s*productos\s*\)/);
    expect(fuente).not.toMatch(/\.set\(\s*\{[^}]*\bexistencia\b/);
    expect(fuente).not.toMatch(/insert\(\s*(movimientosStock|movimientosCuenta)\s*\)/);
    expect(fuente).not.toMatch(/max\(\s*\$?\{?\s*facturas\.numero/i);
    expect(fuente).toMatch(/moverStock\(/);
    expect(fuente).toMatch(/registrarDebito\(/);
    expect(fuente).toMatch(/asignarNumero\(tx, NUMERACION\.factura\)/);
    // Regla 10: sin coma flotante en los importes.
    expect(fuente).not.toMatch(/parseFloat|toFixed|Math\.round/);
  });
});
