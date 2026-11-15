/**
 * Pruebas de integración de la pantalla de Nueva venta (`/ventas/nueva`)
 * contra la API REST existente.
 *
 * `fetch` se reemplaza por los Route Handlers reales (GET /api/productos,
 * GET y POST /api/clientes, GET /api/facturas/proximo-numero y
 * POST /api/facturas) sobre una base SQLite temporal: el borrador se arma con
 * las mismas funciones que la pantalla (src/lib/borrador-venta.ts) y las
 * respuestas, incluidos los errores, son las del servidor. No toca local.db
 * ni Turso.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { clientes, usuarios } from "@/db/schema";
import {
  aClienteVenta,
  actualizarExistencias,
  actualizarPago,
  agregarProducto,
  borradorInicial,
  calcularRenglones,
  cambiarFormaPago,
  clientesSeleccionables,
  construirCuerpoEmision,
  enviarVenta,
  interpretarErrorEmision,
  prepararAltaRapida,
  productosVendibles,
  rutaComprobante,
  seleccionarCliente,
  urlBusquedaClientes,
  urlBusquedaProductos,
  type BorradorVenta,
  type CuerpoEmision,
  type ProductoVenta,
} from "@/lib/borrador-venta";
import { ErrorDeApi, llamarApi } from "@/lib/cliente-api";
import type { ListaPaginada } from "@/lib/paginacion";
import { resolverSesion } from "@/lib/sesion";
import { firmarSesion } from "@/lib/sesion-token";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { crearCategoria } from "@/servicios/categorias";
import { crearCliente, type ClientePublico } from "@/servicios/clientes";
import { crearProducto, type ProductoPublico } from "@/servicios/productos";
import { pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import * as rutaClientes from "../clientes/route";
import * as rutaProductos from "../productos/route";
import * as rutaProximo from "./proximo-numero/route";
import * as rutaFacturas from "./route";

const { cerrarBaseDePrueba } = moduloDb as unknown as ModuloDbPrueba;
afterAll(() => cerrarBaseDePrueba());
afterEach(() => vi.unstubAllGlobals());

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
  const a = await crearUsuarioDePrueba(db, { email: "admin@nv.test", password: "clave-prueba-1", rol: "admin", nombre: "Laura Méndez" });
  const v = await crearUsuarioDePrueba(db, { email: "vende@nv.test", password: "clave-prueba-1", rol: "vendedor", nombre: "Pablo Ruiz" });
  admin = { id: a.id, nombre: a.nombre, email: a.email, rol: a.rol };
  cookieAdmin = await firmarSesion(a.id);
  cookieVendedor = await firmarSesion(v.id);
  categoriaId = (await crearCategoria(admin, { nombre: "Nueva venta" })).id;
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

type Manejador = (req: ReturnType<typeof pedido>, ctx: typeof sinParametros) => Promise<Response>;
const RUTAS: Record<string, Record<string, Manejador>> = {
  "/api/productos": rutaProductos as unknown as Record<string, Manejador>,
  "/api/clientes": rutaClientes as unknown as Record<string, Manejador>,
  "/api/facturas": rutaFacturas as unknown as Record<string, Manejador>,
  "/api/facturas/proximo-numero": rutaProximo as unknown as Record<string, Manejador>,
};

/** Reemplaza `fetch` por los Route Handlers, como si el navegador tuviera la cookie indicada. */
function usarSesion(cookie: string) {
  const llamadas: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? "GET";
    const { pathname, search } = new URL(url, "http://localhost");
    const manejador = RUTAS[pathname]?.[metodo];
    if (!manejador) throw new Error(`Ruta no prevista en la prueba: ${metodo} ${pathname}`);
    llamadas.push({ metodo, ruta: pathname, cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
    return manejador(pedido(pathname + search, { metodo, cookie, cuerpo: init.body as string | undefined }), sinParametros);
  });
  return llamadas;
}

let n = 0;
async function nuevoProducto(stock: number, precio: number, descripcion = `Producto ${n + 1}`) {
  n++;
  return crearProducto(admin, { codigo: `NV-${n}`, descripcion, categoriaId, precio, stockMinimo: 0, stockInicial: stock });
}

async function buscarProductos(texto: string): Promise<ProductoVenta[]> {
  const lista = await llamarApi<ListaPaginada<ProductoPublico>>(urlBusquedaProductos(texto)!);
  return productosVendibles(lista.data);
}

function agregar(b: BorradorVenta, producto: ProductoVenta, cantidad: string): BorradorVenta {
  const r = agregarProducto(b, producto, cantidad);
  if (!r.ok) throw new Error(r.mensaje);
  return r.borrador;
}

function cuerpo(b: BorradorVenta): CuerpoEmision {
  const r = construirCuerpoEmision(b);
  if (!r.ok) throw new Error(JSON.stringify(r.errores));
  return r.cuerpo;
}

// ---------------------------------------------------------------------------
// Flujo completo
// ---------------------------------------------------------------------------

describe("Nueva venta contra la API existente", () => {
  it.each([
    ["administrador", () => cookieAdmin],
    ["vendedor", () => cookieVendedor],
  ])("el %s busca productos por código y descripción y emite a consumidor final de contado", async (_rol, cookie) => {
    const p = await nuevoProducto(10, 150_000, `Tornillo autoperforante ${n + 1}`);
    const llamadas = usarSesion(cookie());

    const proximo = await llamarApi<{ numeroFormateado: string }>("/api/facturas/proximo-numero");
    expect(proximo.numeroFormateado).toMatch(/^0001-\d{8}$/);

    expect((await buscarProductos(p.codigo)).map((x) => x.id)).toContain(p.id);
    const [encontrado] = (await buscarProductos("autoperforante")).filter((x) => x.id === p.id);
    expect(encontrado).toEqual({ id: p.id, codigo: p.codigo, descripcion: p.descripcion, precio: 150_000, existencia: 10 });

    const b = actualizarPago(agregar(borradorInicial(), encontrado, "2"), { montoRecibido: "5000" });
    const factura = await enviarVenta(cuerpo(b));

    expect(factura.numeroFormateado).toBe(proximo.numeroFormateado);
    expect(factura.cliente).toBeNull();
    expect(factura.total).toBe(300_000);
    expect(factura.pago).toEqual({ forma: "contado", montoRecibido: 500_000, vuelto: 200_000 });
    expect(rutaComprobante(factura.id)).toBe(`/ventas/${factura.id}`);

    // La única escritura fue POST /api/facturas, sin precios ni totales.
    const escrituras = llamadas.filter((l) => l.metodo !== "GET");
    expect(escrituras).toEqual([
      { metodo: "POST", ruta: "/api/facturas", cuerpo: { clienteId: null, items: [{ productoId: p.id, cantidad: 2 }], pago: { forma: "contado", montoRecibido: 500_000 } } },
    ]);
  });

  it("contado sin monto: el servidor toma el total", async () => {
    const p = await nuevoProducto(5, 99_999);
    usarSesion(cookieVendedor);
    const f = await enviarVenta(cuerpo(agregar(borradorInicial(), (await buscarProductos(p.codigo))[0], "1")));
    expect(f.pago).toEqual({ forma: "contado", montoRecibido: 99_999, vuelto: 0 });
  });

  it("venta con tarjeta: solo tipo, marca y últimos 4", async () => {
    const p = await nuevoProducto(5, 250_000);
    usarSesion(cookieVendedor);
    const b = actualizarPago(cambiarFormaPago(agregar(borradorInicial(), (await buscarProductos(p.codigo))[0], "1"), "tarjeta"), {
      tarjetaTipo: "debito",
      tarjetaMarca: "Visa",
      tarjetaUltimos4: "4242",
    });
    const f = await enviarVenta(cuerpo(b));
    expect(f.pago).toEqual({ forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "4242" } });
  });

  it("búsqueda de clientes por nombre o documento sin inactivos", async () => {
    const activo = await crearCliente(admin, { tipoDoc: "DNI", nroDoc: "31.222.333", nombre: "Rosa Benítez" });
    const inactivo = await crearCliente(admin, { tipoDoc: "DNI", nroDoc: "31.222.334", nombre: "Rosa Inactiva" });
    await db.update(clientes).set({ activo: false }).where(eq(clientes.id, inactivo.id));
    usarSesion(cookieVendedor);

    const porNombre = await llamarApi<ListaPaginada<ClientePublico>>(urlBusquedaClientes("Rosa")!);
    expect(clientesSeleccionables(porNombre.data).map((c) => c.id)).toEqual([activo.id]);
    const porDocumento = await llamarApi<ListaPaginada<ClientePublico>>(urlBusquedaClientes("31222333")!);
    expect(clientesSeleccionables(porDocumento.data).map((c) => c.id)).toEqual([activo.id]);
  });

  it("alta rápida conserva los ítems y el cliente nuevo compra en cuenta corriente", async () => {
    const p = await nuevoProducto(10, 1_000_000);
    usarSesion(cookieVendedor);
    let b = agregar(borradorInicial(), (await buscarProductos(p.codigo))[0], "2");
    const items = b.renglones;

    const alta = prepararAltaRapida({
      tipoDoc: "CUIT", nroDoc: "20-30444555-6", nombre: "Corralón Norte", domicilio: "Ruta 9 km 3", telefono: "381 400-0000",
      email: "compras@corralon.test", cuentaCorriente: true, limiteCredito: "50000",
    });
    if (!alta.ok) throw new Error(JSON.stringify(alta.errores));
    const creado = await llamarApi<ClientePublico>("/api/clientes", { method: "POST", body: JSON.stringify(alta.cuerpo) });
    expect(creado).toMatchObject({ nombre: "Corralón Norte", cuentaCorriente: true, limiteCredito: 5_000_000, saldo: 0, disponible: 5_000_000 });

    b = cambiarFormaPago(seleccionarCliente(b, aClienteVenta(creado)), "cuenta_corriente");
    expect(b.renglones).toEqual(items);
    const f = await enviarVenta(cuerpo(b));
    expect(f.cliente?.id).toBe(creado.id);
    expect(f.pago).toEqual({ forma: "cuenta_corriente" });
    expect(f.saldoCliente).toBe(2_000_000);

    // Documento duplicado: el error queda junto al campo.
    const repetido = await llamarApi("/api/clientes", { method: "POST", body: JSON.stringify(alta.cuerpo) }).catch((e) => e);
    expect(repetido).toBeInstanceOf(ErrorDeApi);
    expect((repetido as ErrorDeApi).code).toBe("DOCUMENTO_DUPLICADO");
    expect((repetido as ErrorDeApi).campos.nroDoc).toBe("Ya existe un cliente con ese documento.");
  });

  it("STOCK_INSUFICIENTE: el stock cambió antes de confirmar; se informa por producto y la venta se conserva", async () => {
    const p1 = await nuevoProducto(3, 100_000);
    const p2 = await nuevoProducto(5, 100_000);
    usarSesion(cookieVendedor);
    let b = agregar(agregar(borradorInicial(), (await buscarProductos(p1.codigo))[0], "3"), (await buscarProductos(p2.codigo))[0], "1");

    // Otro vendedor vende 2 unidades del primero mientras tanto.
    usarSesion(cookieAdmin);
    await enviarVenta({ clienteId: null, items: [{ productoId: p1.id, cantidad: 2 }], pago: { forma: "contado" } });

    usarSesion(cookieVendedor);
    const error = await enviarVenta(cuerpo(b)).catch((e) => e);
    const i = interpretarErrorEmision(error, b);
    expect(i.code).toBe("STOCK_INSUFICIENTE");
    expect(i.productos).toEqual({ [p1.id]: "Existencia insuficiente: solicitado 3, disponible 1." });
    expect(i.faltantes).toEqual([{ productoId: p1.id, solicitado: 3, disponible: 1 }]);

    b = actualizarExistencias(b, i.faltantes);
    expect(b.renglones.map((r) => r.cantidad)).toEqual(["3", "1"]);
    expect(calcularRenglones(b)[0].error).toBe("Supera la existencia disponible (1).");
    expect(construirCuerpoEmision(b).ok).toBe(false);
  });

  it("errores del servidor: monto, límite, cuenta corriente y validación", async () => {
    const p = await nuevoProducto(10, 1_000_000);
    const limitado = await crearCliente(admin, { tipoDoc: "DNI", nroDoc: "32.000.001", nombre: "Con límite", cuentaCorriente: true, limiteCredito: 1_500_000 });
    const sinCuenta = await crearCliente(admin, { tipoDoc: "DNI", nroDoc: "32.000.002", nombre: "Sin cuenta" });
    usarSesion(cookieVendedor);
    const b = agregar(borradorInicial(), (await buscarProductos(p.codigo))[0], "2");
    const items = [{ productoId: p.id, cantidad: 2 }];
    const fallar = (c: unknown) =>
      llamarApi("/api/facturas", { method: "POST", body: JSON.stringify(c) }).then(
        () => { throw new Error("Se esperaba un error."); },
        (e: unknown) => interpretarErrorEmision(e, b),
      );

    const monto = await fallar({ clienteId: null, items, pago: { forma: "contado", montoRecibido: 1_000_000 } });
    expect(monto.code).toBe("MONTO_INSUFICIENTE");
    expect(monto.campos["pago.montoRecibido"]).toBe("El monto recibido no cubre el total de $ 20.000,00: faltan $ 10.000,00.");

    const limite = await fallar({ clienteId: limitado.id, items, pago: { forma: "cuenta_corriente" } });
    expect(limite.code).toBe("LIMITE_CREDITO_EXCEDIDO");
    expect(limite.general).toContain("Excedente: $ 5.000,00");

    const cuenta = await fallar({ clienteId: sinCuenta.id, items, pago: { forma: "cuenta_corriente" } });
    expect(cuenta.code).toBe("CUENTA_CORRIENTE_NO_HABILITADA");
    expect(cuenta.campos["pago.forma"]).toBe("El cliente no tiene la cuenta corriente habilitada.");

    const validacion = await fallar({ clienteId: null, items: [{ productoId: p.id, cantidad: 1.5 }], pago: { forma: "tarjeta", tarjeta: { tipo: "debito", marca: "Visa", ultimos4: "4242", numero: "4242424242424242" } } });
    expect(validacion.code).toBe("VALIDACION");
    expect(validacion.productos[p.id]).toBe("Debe ser un número entero.");
    expect(validacion.campos["pago.tarjeta.numero"]).toContain("No se admite el número completo");
  });

  it("PRODUCTO_INACTIVO se informa en el renglón", async () => {
    const p = await nuevoProducto(5, 100_000);
    usarSesion(cookieVendedor);
    const b = agregar(borradorInicial(), (await buscarProductos(p.codigo))[0], "1");
    await db.run(`UPDATE productos SET activo = 0 WHERE id = ${p.id}`);
    const i = interpretarErrorEmision(await enviarVenta(cuerpo(b)).catch((e) => e), b);
    expect(i.code).toBe("PRODUCTO_INACTIVO");
    expect(i.productos[p.id]).toBe("El producto está dado de baja.");
    expect(await buscarProductos(p.codigo)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------

describe("acceso a Nueva venta", () => {
  it("ambos roles pueden abrir /ventas/nueva: la página solo exige sesión válida", async () => {
    const pagina = readFileSync(join(process.cwd(), "src/app/(protegido)/ventas/nueva/page.tsx"), "utf8");
    expect(pagina).toContain("exigirUsuarioDePagina()");
    expect(pagina).not.toMatch(/exigirRol|tieneRol/);
    expect((await resolverSesion(cookieAdmin)).estado).toBe("valida");
    expect((await resolverSesion(cookieVendedor)).estado).toBe("valida");
  });

  it("un usuario desactivado pierde el acceso a la pantalla y a la API", async () => {
    const d = await crearUsuarioDePrueba(db, { email: "baja@nv.test", password: "clave-prueba-1", rol: "vendedor", nombre: "Dado de baja" });
    const cookie = await firmarSesion(d.id);
    const p = await nuevoProducto(5, 100_000);
    usarSesion(cookie);
    const b = agregar(borradorInicial(), (await buscarProductos(p.codigo))[0], "1");

    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, d.id));
    expect(await resolverSesion(cookie)).toEqual({ estado: "desactivado" });
    const busqueda = await buscarProductos(p.codigo).catch((e) => e);
    expect((busqueda as ErrorDeApi).code).toBe("NO_AUTENTICADO");
    const i = interpretarErrorEmision(await enviarVenta(cuerpo(b)).catch((e) => e), b);
    expect(i).toMatchObject({ code: "NO_AUTENTICADO", sesionVencida: true });
  });

  it("no modifica local.db", () => {
    expect(huella()).toBe(huellaInicial);
  });
});