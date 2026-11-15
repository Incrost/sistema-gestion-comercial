/**
 * Pruebas del seed académico de facturas, anulaciones y pagos (secciones 8 y
 * 10.7). Corren sobre una base SQLite temporal RECIÉN MIGRADA: nunca tocan
 * local.db ni Turso.
 *
 * Los servicios emitirFactura(), anularFactura() y registrarPago() se
 * envuelven con espías que llaman a la implementación REAL: así se comprueba
 * que el seed los usa (y cuántas veces) sin cambiar su comportamiento.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { asc, count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());
vi.mock("@/servicios/facturas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/servicios/facturas")>();
  return { ...real, emitirFactura: vi.fn(real.emitirFactura), anularFactura: vi.fn(real.anularFactura) };
});
vi.mock("@/servicios/pagos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/servicios/pagos")>();
  return { ...real, registrarPago: vi.fn(real.registrarPago) };
});

import * as moduloDb from "@/db";
import { db } from "@/db";
import {
  clientes,
  facturaItems,
  facturas,
  movimientosCuenta,
  movimientosStock,
  pagos,
  productos,
  secuencias,
  usuarios,
} from "@/db/schema";
import { diaEnArgentina } from "@/lib/fechas";
import { obtenerUsuarioActivo, type UsuarioAutenticado } from "@/servicios/auth";
import { crearCliente } from "@/servicios/clientes";
import { obtenerSaldo } from "@/servicios/cuenta-corriente";
import { anularFactura, emitirFactura, obtenerFactura } from "@/servicios/facturas";
import { registrarPago } from "@/servicios/pagos";
import { actualizarProducto, crearProducto } from "@/servicios/productos";
import { conFechaSimulada } from "@/servicios/reloj";
import type { ModuloDbPrueba } from "@/test/base-de-prueba";

import { PRODUCTOS_SEMILLA, sembrarCatalogo } from "./catalogo";
import { sembrarClientes } from "./clientes";
import {
  ANULACIONES_PLAN,
  CANTIDAD_FACTURAS_ACADEMICAS,
  FACTURAS_PLAN,
  PAGOS_PLAN,
  calcularReposiciones,
  construirCronograma,
  fechaStockInicialSemilla,
  idsFacturasAcademicas,
  inicioDeVentana,
  REPOSICIONES_PLAN,
  sembrarFacturas,
  type ResultadoSemillaFacturas,
} from "./facturas";
import { sembrarUsuarios } from "./usuarios";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

/** Huella de local.db (si existe) para comprobar que las pruebas no la modifican. */
function huellaLocalDb(): string | null {
  return existsSync("local.db") ? createHash("sha256").update(readFileSync("local.db")).digest("hex") : null;
}

const referencia = new Date();
const huellaAntes = huellaLocalDb();

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;
let primera: ResultadoSemillaFacturas;
let ids: number[];
/** Datos cargados por «el usuario» ANTES del seed: no deben cambiar. */
let ajenos: { productoId: number; clienteId: number; facturaId: number };
/** Precios del catálogo al momento de emitir (para la regla 3). */
let preciosAlEmitir: Map<number, number>;

async function totales() {
  const tablas = { facturas, facturaItems, movimientosStock, movimientosCuenta, pagos, productos, clientes, usuarios };
  const resultado: Record<string, number> = {};
  for (const [nombre, tabla] of Object.entries(tablas)) {
    const [{ n }] = await db.select({ n: count() }).from(tabla);
    resultado[nombre] = n;
  }
  const filasSecuencias = await db.select({ clave: secuencias.clave, ultimo: secuencias.ultimoNumero }).from(secuencias);
  return { ...resultado, filasSecuencias };
}

async function facturasAcademicas() {
  return db.select().from(facturas).where(inArray(facturas.id, ids)).orderBy(asc(facturas.numero));
}

beforeAll(async () => {
  // Base vacía recién migrada → usuarios, catálogo y clientes del seed.
  await sembrarUsuarios(db);
  const filas = await db.select({ id: usuarios.id, rol: usuarios.rol }).from(usuarios);
  admin = (await obtenerUsuarioActivo(filas.find((u) => u.rol === "admin")!.id))!;
  vendedor = (await obtenerUsuarioActivo(filas.find((u) => u.rol === "vendedor")!.id))!;
  await conFechaSimulada(fechaStockInicialSemilla(referencia), () => sembrarCatalogo(admin));
  await sembrarClientes(admin);

  // Datos «del usuario», cargados antes del seed con la fecha real.
  const [categoria] = await db.select({ id: productos.categoriaId }).from(productos).limit(1);
  const producto = await crearProducto(admin, {
    codigo: "US-001", descripcion: "Producto cargado por el usuario", categoriaId: categoria.id,
    precio: 100000, stockMinimo: 1, stockInicial: 10,
  });
  const cliente = await crearCliente(admin, {
    tipoDoc: "DNI", nroDoc: "11.222.333", nombre: "Cliente del usuario", cuentaCorriente: true,
  });
  const factura = await emitirFactura(vendedor, {
    clienteId: cliente.id, items: [{ productoId: producto.id, cantidad: 2 }], pago: { forma: "cuenta_corriente" },
  });
  ajenos = { productoId: producto.id, clienteId: cliente.id, facturaId: factura.id };
  vi.mocked(emitirFactura).mockClear();

  preciosAlEmitir = new Map((await db.select({ id: productos.id, precio: productos.precio }).from(productos)).map((p) => [p.id, p.precio]));
  primera = await sembrarFacturas({ admin, vendedor }, referencia);
  ids = await idsFacturasAcademicas();
});

describe("plan del seed de facturas", () => {
  it("define 50 facturas, 20 de contado, 15 con tarjeta y 15 en cuenta corriente", () => {
    expect(FACTURAS_PLAN).toHaveLength(CANTIDAD_FACTURAS_ACADEMICAS);
    expect(new Set(FACTURAS_PLAN.map((f) => f.ref)).size).toBe(50);
    const formas = FACTURAS_PLAN.map((f) => f.pago.forma);
    expect(formas.filter((f) => f === "contado")).toHaveLength(20);
    expect(formas.filter((f) => f === "tarjeta")).toHaveLength(15);
    expect(formas.filter((f) => f === "cuenta_corriente")).toHaveLength(15);
    expect(FACTURAS_PLAN.every((f) => f.dia >= 0 && f.dia < 30)).toBe(true);
    expect(new Set(FACTURAS_PLAN.map((f) => f.items.length))).toEqual(new Set([1, 2, 3]));
    expect(FACTURAS_PLAN.every((f) => f.items.every(([, c]) => Number.isInteger(c) && c > 0 && c <= 100))).toBe(true);
  });

  it("es determinista: el mismo día produce el mismo cronograma, en orden y sin fechas futuras", () => {
    const a = construirCronograma(referencia);
    const b = construirCronograma(new Date(referencia.getTime()));
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i].instante.getTime()).toBeGreaterThan(a[i - 1].instante.getTime());
    expect(a.at(-1)!.instante.getTime()).toBeLessThan(referencia.getTime());
    // Un seed ejecutado a las 00:30 de Argentina igual deja todo en el pasado.
    const madrugada = new Date("2026-11-15T03:30:00.000Z");
    const temprano = construirCronograma(madrugada);
    expect(temprano.at(-1)!.instante.getTime()).toBeLessThan(madrugada.getTime());
  });

  it("calcula la reposición: en el catálogo académico es exactamente la planificada", () => {
    const existencias = new Map(
      PRODUCTOS_SEMILLA.map((p) => [p.codigo, p.stockInicial + (p.movimientos ?? []).reduce((s, m) => s + (m.tipo === "ingreso" ? m.cantidad : -m.cantidad), 0)]),
    );
    expect(calcularReposiciones(existencias, construirCronograma(referencia))).toEqual(REPOSICIONES_PLAN);
    // Si falta stock (p. ej. el usuario hizo un egreso), repone lo necesario.
    existencias.set("BU-003", 100);
    expect(calcularReposiciones(existencias, construirCronograma(referencia))).toContainEqual({ codigo: "BU-003", cantidad: 200 });
  });
});

describe("sembrarFacturas() en una base vacía recién migrada", () => {
  it("1. crea exactamente 50 facturas académicas", async () => {
    expect(primera).toEqual({ estado: "creado", reposiciones: REPOSICIONES_PLAN, facturas: 50, anulaciones: 6, pagos: 6 });
    expect(ids).toHaveLength(50);
    expect(ids).not.toContain(ajenos.facturaId);
    const [{ n }] = await db.select({ n: count() }).from(facturas);
    expect(n).toBe(51); // 50 académicas + la del usuario
  });

  it("2. las distribuye en los últimos 30 días, en orden cronológico", async () => {
    const lista = await facturasAcademicas();
    const desde = inicioDeVentana(referencia).getTime();
    for (const f of lista) {
      expect(f.fecha.getTime()).toBeGreaterThanOrEqual(desde);
      expect(f.fecha.getTime()).toBeLessThanOrEqual(referencia.getTime());
    }
    expect(new Set(lista.map((f) => diaEnArgentina(f.fecha))).size).toBeGreaterThanOrEqual(25);
    // El número crece junto con la fecha.
    for (let i = 1; i < lista.length; i++) expect(lista[i].fecha.getTime()).toBeGreaterThan(lista[i - 1].fecha.getTime());
  });

  it("3. incluye facturas del día actual (hora de Argentina)", async () => {
    const hoy = diaEnArgentina(referencia);
    const delDia = (await facturasAcademicas()).filter((f) => diaEnArgentina(f.fecha) === hoy);
    expect(delDia.length).toBeGreaterThanOrEqual(1);
    expect(delDia.some((f) => f.estado === "emitida")).toBe(true);
  });

  it("4. incluye las tres formas de pago (20 / 15 / 15)", async () => {
    const lista = await facturasAcademicas();
    const por = (forma: string) => lista.filter((f) => f.formaPago === forma).length;
    expect([por("contado"), por("tarjeta"), por("cuenta_corriente")]).toEqual([20, 15, 15]);
    // Contado con y sin vuelto; tarjeta sin número completo (regla 9).
    expect(lista.some((f) => f.formaPago === "contado" && f.montoRecibido! > f.total)).toBe(true);
    expect(lista.some((f) => f.formaPago === "contado" && f.montoRecibido === f.total)).toBe(true);
    expect(lista.filter((f) => f.formaPago === "tarjeta").every((f) => /^\d{4}$/.test(f.tarjetaUltimos4!))).toBe(true);
  });

  it("5. utiliza ambos vendedores", async () => {
    const vendedores = new Set((await facturasAcademicas()).map((f) => f.vendedorId));
    expect(vendedores).toEqual(new Set([admin.id, vendedor.id]));
  });

  it("6. incluye consumidor final (al menos 15) y clientes registrados", async () => {
    const lista = await facturasAcademicas();
    expect(lista.filter((f) => f.clienteId === null).length).toBeGreaterThanOrEqual(15);
    expect(new Set(lista.filter((f) => f.clienteId !== null).map((f) => f.clienteId)).size).toBeGreaterThanOrEqual(8);
  });

  it("7. incluye facturas anuladas que revierten stock y, si eran a cuenta, el saldo", async () => {
    const anuladas = (await facturasAcademicas()).filter((f) => f.estado === "anulada");
    expect(anuladas).toHaveLength(ANULACIONES_PLAN.length);
    expect(new Set(anuladas.map((f) => f.formaPago))).toEqual(new Set(["contado", "tarjeta", "cuenta_corriente"]));
    for (const f of anuladas) {
      expect(f.anuladaPorId).toBe(admin.id);
      expect(f.fechaAnulacion!.getTime()).toBeGreaterThan(f.fecha.getTime());
      const items = await db.select().from(facturaItems).where(eq(facturaItems.facturaId, f.id));
      const reingresos = await db.select().from(movimientosStock).where(sql`${movimientosStock.facturaId} = ${f.id} and ${movimientosStock.tipo} = 'anulacion'`);
      expect(reingresos).toHaveLength(items.length);
      for (const item of items) {
        expect(reingresos.find((m) => m.productoId === item.productoId)!.cantidad).toBe(item.cantidad);
      }
      const creditos = await db.select().from(movimientosCuenta).where(sql`${movimientosCuenta.facturaId} = ${f.id} and ${movimientosCuenta.tipo} = 'credito'`);
      expect(creditos).toHaveLength(f.formaPago === "cuenta_corriente" ? 1 : 0);
      if (creditos[0]) expect(creditos[0].importe).toBe(f.total);
    }
  });

  it("8 y 18. crea facturas, anulaciones y pagos mediante los servicios", async () => {
    expect(emitirFactura).toHaveBeenCalledTimes(50);
    expect(anularFactura).toHaveBeenCalledTimes(6);
    expect(registrarPago).toHaveBeenCalledTimes(6);
    // Huellas que solo deja emitirFactura(): un movimiento de venta por renglón
    // y, a cuenta corriente, el débito por el total.
    for (const f of await facturasAcademicas()) {
      const items = await db.select().from(facturaItems).where(eq(facturaItems.facturaId, f.id));
      const ventas = await db.select().from(movimientosStock).where(sql`${movimientosStock.facturaId} = ${f.id} and ${movimientosStock.tipo} = 'venta'`);
      expect(ventas).toHaveLength(items.length);
      expect(ventas.every((m) => m.fecha.getTime() === f.fecha.getTime())).toBe(true);
      const debitos = await db.select().from(movimientosCuenta).where(sql`${movimientosCuenta.facturaId} = ${f.id} and ${movimientosCuenta.tipo} = 'debito'`);
      expect(debitos.map((d) => d.importe)).toEqual(f.formaPago === "cuenta_corriente" ? [f.total] : []);
    }
    const listaPagos = await db.select().from(pagos);
    expect(listaPagos).toHaveLength(PAGOS_PLAN.length);
    for (const p of listaPagos) {
      const [credito] = await db.select().from(movimientosCuenta).where(eq(movimientosCuenta.pagoId, p.id));
      expect(credito).toMatchObject({ tipo: "credito", importe: p.importe, clienteId: p.clienteId });
      expect(credito.fecha.getTime()).toBe(p.fecha.getTime());
    }
  });

  it("9. incluye los tres medios de pago de la cuenta corriente", async () => {
    const medios = new Set((await db.select({ medio: pagos.medio }).from(pagos)).map((p) => p.medio));
    expect(medios).toEqual(new Set(["efectivo", "transferencia", "tarjeta_debito"]));
  });

  it("10. incluye pagos parciales y totales coherentes", async () => {
    const lista = await db.select().from(pagos);
    expect(lista.some((p) => p.saldoResultante === 0)).toBe(true);
    expect(lista.some((p) => p.saldoResultante > 0)).toBe(true);
    expect(lista.every((p) => p.importe > 0 && p.saldoResultante >= 0)).toBe(true);
  });

  it("11 y 12. deja al menos tres clientes con deuda y ningún saldo negativo", async () => {
    const todos = await db.select({ id: clientes.id }).from(clientes);
    const saldos = await Promise.all(todos.map((c) => obtenerSaldo(db, c.id)));
    expect(saldos.every((s) => s >= 0)).toBe(true);
    expect(saldos.filter((s) => s > 0).length).toBeGreaterThanOrEqual(4); // 5 académicos + el del usuario
  });

  it("13 y 14. ningún stock es negativo y cada existencia coincide con sus movimientos, en orden cronológico", async () => {
    const lista = await db.select().from(productos);
    for (const p of lista) {
      expect(p.existencia).toBeGreaterThanOrEqual(0);
      const movimientos = await db
        .select()
        .from(movimientosStock)
        .where(eq(movimientosStock.productoId, p.id))
        .orderBy(asc(movimientosStock.fecha), asc(movimientosStock.id));
      let acumulado = 0;
      for (const m of movimientos) {
        acumulado += m.cantidad;
        expect(m.existenciaResultante).toBe(acumulado);
      }
      expect(acumulado).toBe(p.existencia);
    }
    // Productos bajo el mínimo y con distintas existencias (tablero).
    const activos = lista.filter((p) => p.activo);
    expect(activos.filter((p) => p.existencia < p.stockMinimo).length).toBeGreaterThanOrEqual(5);
    expect(new Set(activos.map((p) => p.existencia)).size).toBeGreaterThanOrEqual(15);
  });

  it("15. cada saldo es débitos − créditos y se respetan los límites de crédito", async () => {
    const lista = await db.select().from(clientes);
    for (const c of lista) {
      const movimientos = await db.select().from(movimientosCuenta).where(eq(movimientosCuenta.clienteId, c.id)).orderBy(asc(movimientosCuenta.fecha), asc(movimientosCuenta.id));
      let saldo = 0;
      let maximo = 0;
      for (const m of movimientos) {
        saldo += m.tipo === "debito" ? m.importe : -m.importe;
        expect(saldo).toBeGreaterThanOrEqual(0); // ningún pago ni anulación dejó saldo a favor
        maximo = Math.max(maximo, saldo);
      }
      expect(await obtenerSaldo(db, c.id)).toBe(saldo);
      if (c.limiteCredito !== null) expect(maximo).toBeLessThanOrEqual(c.limiteCredito);
    }
  });

  it("16. numeraciones correlativas, sin duplicados ni huecos", async () => {
    const numeros = (await db.select({ n: facturas.numero }).from(facturas).orderBy(asc(facturas.numero))).map((f) => f.n);
    expect(numeros).toEqual(Array.from({ length: 51 }, (_, i) => i + 1));
    const recibos = (await db.select({ n: pagos.numero }).from(pagos).orderBy(asc(pagos.numero))).map((p) => p.n);
    expect(recibos).toEqual([1, 2, 3, 4, 5, 6]);
    const filas = await db.select().from(secuencias);
    expect(filas.find((s) => s.clave === "factura")!.ultimoNumero).toBe(51);
    expect(filas.find((s) => s.clave === "recibo")!.ultimoNumero).toBe(6);
    // Los recibos también crecen con la fecha.
    const porNumero = await db.select().from(pagos).orderBy(asc(pagos.numero));
    for (let i = 1; i < porNumero.length; i++) expect(porNumero[i].fecha.getTime()).toBeGreaterThan(porNumero[i - 1].fecha.getTime());
  });

  it("17. precios, ítems y comprador quedan congelados en cada factura", async () => {
    for (const f of await facturasAcademicas()) {
      const items = await db.select().from(facturaItems).where(eq(facturaItems.facturaId, f.id));
      for (const item of items) {
        expect(item.precioUnitario).toBe(preciosAlEmitir.get(item.productoId));
        expect(item.subtotal).toBe(item.precioUnitario * item.cantidad);
      }
      expect(f.total).toBe(items.reduce((s, i) => s + i.subtotal, 0));
      if (f.clienteId === null) expect(f.compradorNombre).toBe("Consumidor final");
    }
    // Cambiar el precio del catálogo no altera las facturas emitidas (regla 3).
    const muestra = ids[0];
    const antes = await obtenerFactura(admin, { id: String(muestra) });
    const productoId = antes.items[0].productoId;
    await actualizarProducto(admin, { id: String(productoId) }, { precio: preciosAlEmitir.get(productoId)! * 2 });
    expect(await obtenerFactura(admin, { id: String(muestra) })).toEqual(antes);
    await actualizarProducto(admin, { id: String(productoId) }, { precio: preciosAlEmitir.get(productoId)! });
  });

  it("19. una segunda ejecución no duplica nada ni consume numeración", async () => {
    const antes = await totales();
    vi.mocked(emitirFactura).mockClear();
    vi.mocked(anularFactura).mockClear();
    vi.mocked(registrarPago).mockClear();

    expect(await sembrarFacturas({ admin, vendedor }, new Date())).toEqual({ estado: "existente", facturas: 50 });
    expect(await sembrarCatalogo(admin)).toMatchObject({ productosCreados: 0, categoriasCreadas: 0, movimientosCreados: 0 });
    expect(await sembrarClientes(admin)).toMatchObject({ clientesCreados: 0 });
    expect((await sembrarUsuarios(db)).every((u) => u.estado === "existente")).toBe(true);

    expect(await totales()).toEqual(antes);
    expect(emitirFactura).not.toHaveBeenCalled();
    expect(anularFactura).not.toHaveBeenCalled();
    expect(registrarPago).not.toHaveBeenCalled();
    expect(await idsFacturasAcademicas()).toEqual(ids);
  });

  it("20. no modifica los datos ajenos al conjunto académico", async () => {
    const [producto] = await db.select().from(productos).where(eq(productos.id, ajenos.productoId));
    expect(producto.existencia).toBe(8);
    const movimientos = await db.select().from(movimientosStock).where(eq(movimientosStock.productoId, ajenos.productoId));
    expect(movimientos).toHaveLength(2); // stock inicial + la venta del usuario
    expect(await obtenerSaldo(db, ajenos.clienteId)).toBe(200000);
    const [factura] = await db.select().from(facturas).where(eq(facturas.id, ajenos.facturaId));
    expect(factura).toMatchObject({ numero: 1, estado: "emitida", vendedorId: vendedor.id });
    const [{ n }] = await db.select({ n: count() }).from(facturas).where(eq(facturas.clienteId, ajenos.clienteId));
    expect(n).toBe(1);
  });

  it("22. las pruebas no modifican local.db", () => {
    expect(huellaLocalDb()).toBe(huellaAntes);
  });
});
