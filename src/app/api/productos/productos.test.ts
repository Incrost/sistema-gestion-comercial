/**
 * Pruebas de integración de /api/productos, /api/productos/{id}/movimientos y
 * /api/movimientos-stock (RF-P1 a RF-P6; sección 11.4).
 *
 * Se llama a cada Route Handler con un NextRequest, igual que Next.js, contra
 * una base SQLite temporal (no toca local.db ni Turso).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { movimientosStock, productos } from "@/db/schema";
import { firmarSesion } from "@/lib/sesion-token";
import type { MovimientoPublico } from "@/servicios/stock";
import type { ProductoPublico } from "@/servicios/productos";
import { conId, esperarError, esperarJson, pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import * as rutaCategorias from "../categorias/route";
import * as rutaMovimientosStock from "../movimientos-stock/route";
import * as rutaMovimientos from "./[id]/movimientos/route";
import * as rutaId from "./[id]/route";
import * as rutaProductos from "./route";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

type Lista<T> = { data: T[]; page: number; pageSize: number; total: number };

let cookieAdmin: string;
let cookieVendedor: string;
let adminId: number;
let catHerramientas: number;
let catPintura: number;

const crearCategoria = async (nombre: string) =>
  (
    await esperarJson<{ id: number }>(
      await rutaCategorias.POST(
        pedido("/api/categorias", { metodo: "POST", cookie: cookieAdmin, cuerpo: { nombre } }),
        sinParametros,
      ),
      201,
    )
  ).id;

beforeAll(async () => {
  const admin = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin", nombre: "Ana Admin" });
  const vendedor = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
  adminId = admin.id;
  cookieAdmin = await firmarSesion(admin.id);
  cookieVendedor = await firmarSesion(vendedor.id);
  catHerramientas = await crearCategoria("Herramientas");
  catPintura = await crearCategoria("Pintura");
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

const listar = (cookie: string | undefined, consulta = "") =>
  rutaProductos.GET(pedido(`/api/productos${consulta}`, { cookie }), sinParametros);
const crear = (cookie: string | undefined, cuerpo: object | string) =>
  rutaProductos.POST(pedido("/api/productos", { metodo: "POST", cookie, cuerpo }), sinParametros);
const obtener = (cookie: string | undefined, id: number | string) =>
  rutaId.GET(pedido(`/api/productos/${id}`, { cookie }), conId(id));
const editar = (cookie: string | undefined, id: number | string, cuerpo: object | string) =>
  rutaId.PATCH(pedido(`/api/productos/${id}`, { metodo: "PATCH", cookie, cuerpo }), conId(id));
const historial = (cookie: string | undefined, id: number | string, consulta = "") =>
  rutaMovimientos.GET(pedido(`/api/productos/${id}/movimientos${consulta}`, { cookie }), conId(id));
const mover = (cookie: string | undefined, id: number | string, cuerpo: object | string) =>
  rutaMovimientos.POST(
    pedido(`/api/productos/${id}/movimientos`, { metodo: "POST", cookie, cuerpo }),
    conId(id),
  );
const movimientosGlobal = (cookie: string | undefined, consulta = "") =>
  rutaMovimientosStock.GET(pedido(`/api/movimientos-stock${consulta}`, { cookie }), sinParametros);

let n = 0;
async function altaProducto(datos: Partial<Record<string, unknown>> = {}) {
  const codigo = `PR-${String(++n).padStart(3, "0")}`;
  return esperarJson<ProductoPublico>(
    await crear(cookieAdmin, {
      codigo,
      descripcion: `Producto ${codigo}`,
      categoriaId: catHerramientas,
      precio: 150000,
      stockMinimo: 0,
      ...datos,
    }),
    201,
  );
}

const CLAVES_PRODUCTO = [
  "id", "codigo", "descripcion", "categoria", "precio", "existencia", "stockMinimo", "bajoMinimo", "activo",
].sort();

// ---------------------------------------------------------------------------
// Alta y edición — RF-P2, RF-P3
// ---------------------------------------------------------------------------

describe("POST /api/productos (admin)", () => {
  it("crea un producto sin stock inicial: existencia 0 y sin movimientos", async () => {
    const p = await altaProducto({ codigo: "HE-001", descripcion: "Martillo  carpintero 500 g", precio: 1250000, stockMinimo: 5 });
    expect(Object.keys(p).sort()).toEqual(CLAVES_PRODUCTO);
    expect(p).toMatchObject({
      codigo: "HE-001",
      descripcion: "Martillo carpintero 500 g",
      categoria: { id: catHerramientas, nombre: "Herramientas" },
      precio: 1250000,
      existencia: 0,
      stockMinimo: 5,
      bajoMinimo: true,
      activo: true,
    });
    expect(await db.select().from(movimientosStock).where(eq(movimientosStock.productoId, p.id))).toHaveLength(0);
  });

  it("crea un producto con stock inicial y su movimiento «Stock inicial»", async () => {
    const p = await altaProducto({ stockInicial: 24 });
    expect(p.existencia).toBe(24);
    const h = await esperarJson<Lista<MovimientoPublico>>(await historial(cookieAdmin, p.id), 200);
    expect(h.total).toBe(1);
    expect(h.data[0]).toMatchObject({
      tipo: "ingreso",
      cantidad: 24,
      existenciaResultante: 24,
      motivo: "Stock inicial",
      usuario: { id: adminId, nombre: "Ana Admin" },
      referencia: null,
    });
  });

  it("rechaza `existencia` con 422 VALIDACION", async () => {
    const cuerpo = await esperarError(
      await crear(cookieAdmin, { codigo: "EX-1", descripcion: "X", categoriaId: catHerramientas, precio: 100, stockMinimo: 0, existencia: 50 }),
      422,
      "VALIDACION",
    );
    expect(cuerpo.error.details).toEqual([{ campo: "existencia", mensaje: expect.stringMatching(/existencia/) }]);
  });

  it("código repetido → 409 CODIGO_DUPLICADO (también sin distinguir mayúsculas)", async () => {
    await altaProducto({ codigo: "DUP-1" });
    const cuerpo = await esperarError(
      await crear(cookieAdmin, { codigo: "DUP-1", descripcion: "Otro", categoriaId: catHerramientas, precio: 100, stockMinimo: 0 }),
      409,
      "CODIGO_DUPLICADO",
    );
    expect(cuerpo.error.details).toEqual([{ campo: "codigo", mensaje: expect.any(String) }]);
    await esperarError(
      await crear(cookieAdmin, { codigo: "dup-1", descripcion: "Otro", categoriaId: catHerramientas, precio: 100, stockMinimo: 0 }),
      409,
      "CODIGO_DUPLICADO",
    );
  });

  it("categoría inexistente o inactiva → 422 VALIDACION en categoriaId", async () => {
    const r1 = await esperarError(
      await crear(cookieAdmin, { codigo: "CAT-X", descripcion: "X", categoriaId: 9999, precio: 100, stockMinimo: 0 }),
      422,
      "VALIDACION",
    );
    expect(r1.error.details).toEqual([{ campo: "categoriaId", mensaje: "La categoría no existe." }]);

    const inactiva = await crearCategoria("Inactiva para alta");
    const { PATCH } = await import("../categorias/[id]/route");
    await PATCH(
      pedido(`/api/categorias/${inactiva}`, { metodo: "PATCH", cookie: cookieAdmin, cuerpo: { activa: false } }),
      conId(inactiva),
    );
    const r2 = await esperarError(
      await crear(cookieAdmin, { codigo: "CAT-Y", descripcion: "X", categoriaId: inactiva, precio: 100, stockMinimo: 0 }),
      422,
      "VALIDACION",
    );
    expect(r2.error.details).toEqual([{ campo: "categoriaId", mensaje: "La categoría está inactiva." }]);
  });

  it("importes en centavos: rechaza decimales", async () => {
    await esperarError(
      await crear(cookieAdmin, { codigo: "DEC-1", descripcion: "X", categoriaId: catHerramientas, precio: 1250.5, stockMinimo: 0 }),
      422,
      "VALIDACION",
    );
  });

  it("el vendedor recibe 403", async () => {
    await esperarError(
      await crear(cookieVendedor, { codigo: "VEN-1", descripcion: "X", categoriaId: catHerramientas, precio: 100, stockMinimo: 0 }),
      403,
      "SIN_PERMISO",
    );
  });
});

describe("PATCH /api/productos/{id} (admin)", () => {
  it("edita los datos sin alterar la existencia", async () => {
    const p = await altaProducto({ stockInicial: 7 });
    const editado = await esperarJson<ProductoPublico>(
      await editar(cookieAdmin, p.id, { descripcion: "Nueva descripción", precio: 99900, stockMinimo: 10, categoriaId: catPintura }),
      200,
    );
    expect(editado).toMatchObject({
      descripcion: "Nueva descripción",
      precio: 99900,
      stockMinimo: 10,
      categoria: { id: catPintura, nombre: "Pintura" },
      existencia: 7,
      bajoMinimo: true,
    });
  });

  it("rechaza existencia y stockInicial (422) sin modificar nada", async () => {
    const p = await altaProducto({ stockInicial: 3 });
    await esperarError(await editar(cookieAdmin, p.id, { existencia: 100 }), 422, "VALIDACION");
    await esperarError(await editar(cookieAdmin, p.id, { stockInicial: 100 }), 422, "VALIDACION");
    await esperarError(await editar(cookieAdmin, p.id, { precio: 5, existencia: 100 }), 422, "VALIDACION");
    await esperarError(await editar(cookieAdmin, p.id, {}), 422, "VALIDACION");
    const [fila] = await db.select().from(productos).where(eq(productos.id, p.id));
    expect(fila).toMatchObject({ existencia: 3, precio: 150000 });
  });

  it("código de otro producto → 409; el propio código se puede reenviar", async () => {
    const a = await altaProducto();
    const b = await altaProducto();
    await esperarError(await editar(cookieAdmin, b.id, { codigo: a.codigo }), 409, "CODIGO_DUPLICADO");
    await esperarJson(await editar(cookieAdmin, b.id, { codigo: b.codigo }), 200);
  });

  it("inexistente → 404; vendedor → 403", async () => {
    await esperarError(await editar(cookieAdmin, 99999, { precio: 100 }), 404, "NO_ENCONTRADO");
    const p = await altaProducto();
    await esperarError(await editar(cookieVendedor, p.id, { precio: 100 }), 403, "SIN_PERMISO");
    await esperarError(await editar(cookieVendedor, p.id, { activo: false }), 403, "SIN_PERMISO");
  });

  it("baja lógica: conserva existencia e historial y se puede reactivar", async () => {
    const p = await altaProducto({ stockInicial: 5 });
    await esperarJson(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1, motivo: "Rotura" }), 201);
    const baja = await esperarJson<ProductoPublico>(await editar(cookieAdmin, p.id, { activo: false }), 200);
    expect(baja).toMatchObject({ activo: false, existencia: 4 });
    const h = await esperarJson<Lista<MovimientoPublico>>(await historial(cookieAdmin, p.id), 200);
    expect(h.total).toBe(2);
    const alta = await esperarJson<ProductoPublico>(await editar(cookieAdmin, p.id, { activo: true }), 200);
    expect(alta.activo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Catálogo — RF-P1
// ---------------------------------------------------------------------------

describe("GET /api/productos y /api/productos/{id}", () => {
  let catCatalogo: number;
  beforeAll(async () => {
    catCatalogo = await crearCategoria("Catálogo");
    const base = { categoriaId: catCatalogo, precio: 1000 };
    await altaProducto({ ...base, codigo: "CA-001", descripcion: "Tornillo largo", stockMinimo: 5, stockInicial: 4 }); // bajo
    await altaProducto({ ...base, codigo: "CA-002", descripcion: "Tuerca", stockMinimo: 5, stockInicial: 5 }); // igual: NO bajo
    await altaProducto({ ...base, codigo: "CA-003", descripcion: "Arandela", stockMinimo: 5, stockInicial: 6 });
    await altaProducto({ ...base, codigo: "CA-004", descripcion: "Tornillo corto", stockMinimo: 0, stockInicial: 0 }); // 0 < 0 no
    const inactivo = await altaProducto({ ...base, codigo: "CA-005", descripcion: "Tornillo viejo", stockMinimo: 9, stockInicial: 1 });
    await esperarJson(await editar(cookieAdmin, inactivo.id, { activo: false }), 200);
  });

  it("responde { data, page, pageSize, total } y pagina", async () => {
    const consulta = `?categoriaId=${catCatalogo}&pageSize=2`;
    const p1 = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, consulta), 200);
    expect(Object.keys(p1).sort()).toEqual(["data", "page", "pageSize", "total"]);
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total: 4 });
    expect(p1.data.map((p) => p.codigo)).toEqual(["CA-001", "CA-002"]);
    const p3 = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, `${consulta}&page=3`), 200);
    expect(p3.data).toEqual([]);
    expect(p3.total).toBe(4);
    for (const p of p1.data) expect(Object.keys(p).sort()).toEqual(CLAVES_PRODUCTO);
  });

  it("busca por código o descripción, sin distinguir mayúsculas", async () => {
    const porDescripcion = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, "?q=TORNILLO"), 200);
    expect(porDescripcion.data.map((p) => p.codigo).sort()).toEqual(["CA-001", "CA-004"]);
    const porCodigo = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, "?q=ca-00"), 200);
    expect(porCodigo.total).toBe(4);
    const literal = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, "?q=%25"), 200);
    expect(literal.total).toBe(0); // el % se busca literal, no como comodín
  });

  it("filtra por categoría", async () => {
    const r = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, `?categoriaId=${catCatalogo}`), 200);
    expect(r.data.every((p) => p.categoria.id === catCatalogo)).toBe(true);
  });

  it("bajo mínimo usa existencia < stockMínimo (no <=)", async () => {
    const r = await esperarJson<Lista<ProductoPublico>>(
      await listar(cookieAdmin, `?categoriaId=${catCatalogo}&bajoMinimo=true`),
      200,
    );
    expect(r.data.map((p) => p.codigo)).toEqual(["CA-001"]);
    const todos = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, `?categoriaId=${catCatalogo}`), 200);
    const marca = Object.fromEntries(todos.data.map((p) => [p.codigo, p.bajoMinimo]));
    expect(marca).toEqual({ "CA-001": true, "CA-002": false, "CA-003": false, "CA-004": false });
  });

  it("activo: por defecto true; el admin puede pedir false o todos", async () => {
    const c = `?categoriaId=${catCatalogo}`;
    expect((await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, c), 200)).total).toBe(4);
    const inactivos = await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, `${c}&activo=false`), 200);
    expect(inactivos.data.map((p) => p.codigo)).toEqual(["CA-005"]);
    expect((await esperarJson<Lista<ProductoPublico>>(await listar(cookieAdmin, `${c}&activo=todos`), 200)).total).toBe(5);
  });

  it("el vendedor no obtiene productos inactivos", async () => {
    const c = `?categoriaId=${catCatalogo}`;
    const lista = await esperarJson<Lista<ProductoPublico>>(await listar(cookieVendedor, c), 200);
    expect(lista.total).toBe(4);
    expect(lista.data.every((p) => p.activo)).toBe(true);
    await esperarError(await listar(cookieVendedor, `${c}&activo=false`), 403, "SIN_PERMISO");
    await esperarError(await listar(cookieVendedor, `${c}&activo=todos`), 403, "SIN_PERMISO");

    const [inactivo] = await db.select().from(productos).where(eq(productos.codigo, "CA-005"));
    await esperarError(await obtener(cookieVendedor, inactivo.id), 404, "NO_ENCONTRADO");
    await esperarError(await historial(cookieVendedor, inactivo.id), 404, "NO_ENCONTRADO");
    expect((await esperarJson<ProductoPublico>(await obtener(cookieAdmin, inactivo.id), 200)).activo).toBe(false);
  });

  it("GET /{id}: ambos roles ven un producto activo; inexistente → 404; id inválido → 422", async () => {
    const [activo] = await db.select().from(productos).where(eq(productos.codigo, "CA-002"));
    for (const cookie of [cookieAdmin, cookieVendedor]) {
      const p = await esperarJson<ProductoPublico>(await obtener(cookie, activo.id), 200);
      expect(p).toMatchObject({ codigo: "CA-002", existencia: 5, bajoMinimo: false });
    }
    await esperarError(await obtener(cookieAdmin, 99999), 404, "NO_ENCONTRADO");
    await esperarError(await obtener(cookieAdmin, "x1"), 422, "VALIDACION");
  });

  it("parámetros inválidos → 422", async () => {
    await esperarError(await listar(cookieAdmin, "?pageSize=101"), 422, "VALIDACION");
    await esperarError(await listar(cookieAdmin, "?bajoMinimo=si"), 422, "VALIDACION");
    await esperarError(await listar(cookieAdmin, "?orden=precio"), 422, "VALIDACION");
  });
});

// ---------------------------------------------------------------------------
// Movimientos — RF-P4, RF-P5, RF-P6
// ---------------------------------------------------------------------------

describe("POST /api/productos/{id}/movimientos (admin)", () => {
  it("ingreso: 201 con el movimiento y la existencia resultante", async () => {
    const p = await altaProducto({ stockInicial: 2 });
    const mov = await esperarJson<MovimientoPublico>(
      await mover(cookieAdmin, p.id, { tipo: "ingreso", cantidad: 5, motivo: "Reposición", observacion: "Remito 15" }),
      201,
    );
    expect(Object.keys(mov).sort()).toEqual(
      ["cantidad", "existenciaResultante", "fecha", "id", "motivo", "observacion", "producto", "referencia", "tipo", "usuario"].sort(),
    );
    expect(mov).toMatchObject({
      producto: { id: p.id, codigo: p.codigo },
      tipo: "ingreso",
      cantidad: 5,
      existenciaResultante: 7,
      motivo: "Reposición",
      observacion: "Remito 15",
      referencia: null,
      usuario: { id: adminId, nombre: "Ana Admin" },
    });
    expect(mov.fecha).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect((await esperarJson<ProductoPublico>(await obtener(cookieAdmin, p.id), 200)).existencia).toBe(7);
  });

  it("egreso: disminuye la existencia y graba la cantidad negativa", async () => {
    const p = await altaProducto({ stockInicial: 10 });
    const mov = await esperarJson<MovimientoPublico>(
      await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 3, motivo: "Rotura" }),
      201,
    );
    expect(mov).toMatchObject({ tipo: "egreso", cantidad: -3, existenciaResultante: 7 });
  });

  it("egreso insuficiente: 409 STOCK_INSUFICIENTE, sin modificar existencia ni crear movimiento", async () => {
    const p = await altaProducto({ stockInicial: 2 });
    const cuerpo = await esperarError(
      await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 3, motivo: "Vencimiento" }),
      409,
      "STOCK_INSUFICIENTE",
    );
    expect(cuerpo.error.details).toEqual([{ productoId: p.id, solicitado: 3, disponible: 2 }]);
    expect((await esperarJson<ProductoPublico>(await obtener(cookieAdmin, p.id), 200)).existencia).toBe(2);
    expect((await esperarJson<Lista<MovimientoPublico>>(await historial(cookieAdmin, p.id), 200)).total).toBe(1);
  });

  it.each(["venta", "anulacion"])("rechaza el tipo %s (422)", async (tipo) => {
    const p = await altaProducto({ stockInicial: 5 });
    const cuerpo = await esperarError(
      await mover(cookieAdmin, p.id, { tipo, cantidad: 1, motivo: "Venta", facturaId: 1 }),
      422,
      "VALIDACION",
    );
    expect(JSON.stringify(cuerpo.error.details)).toContain("tipo");
  });

  it("valida cantidad, motivo y campos extra", async () => {
    const p = await altaProducto({ stockInicial: 5 });
    await esperarError(await mover(cookieAdmin, p.id, { tipo: "ingreso", cantidad: 0, motivo: "Reposición" }), 422, "VALIDACION");
    await esperarError(await mover(cookieAdmin, p.id, { tipo: "ingreso", cantidad: -1, motivo: "Reposición" }), 422, "VALIDACION");
    await esperarError(await mover(cookieAdmin, p.id, { tipo: "ingreso", cantidad: 1.5, motivo: "Reposición" }), 422, "VALIDACION");
    await esperarError(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1 }), 422, "VALIDACION");
    await esperarError(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1, motivo: "Reposición" }), 422, "VALIDACION");
    await esperarError(await mover(cookieAdmin, p.id, { tipo: "ingreso", cantidad: 1, motivo: "Reposición", existencia: 9 }), 422, "VALIDACION");
    await esperarError(await mover(cookieAdmin, p.id, "no-json"), 400, "JSON_INVALIDO");
    expect((await esperarJson<ProductoPublico>(await obtener(cookieAdmin, p.id), 200)).existencia).toBe(5);
  });

  it("producto inexistente → 404; vendedor → 403 sin cambiar nada", async () => {
    await esperarError(await mover(cookieAdmin, 99999, { tipo: "ingreso", cantidad: 1, motivo: "Reposición" }), 404, "NO_ENCONTRADO");
    const p = await altaProducto({ stockInicial: 5 });
    await esperarError(await mover(cookieVendedor, p.id, { tipo: "egreso", cantidad: 1, motivo: "Rotura" }), 403, "SIN_PERMISO");
    expect((await esperarJson<ProductoPublico>(await obtener(cookieAdmin, p.id), 200)).existencia).toBe(5);
  });

  it("dos egresos simultáneos sobre la última unidad: uno 201 y otro 409", async () => {
    const p = await altaProducto({ stockInicial: 1 });
    const respuestas = await Promise.all([
      mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1, motivo: "Rotura" }),
      mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1, motivo: "Rotura" }),
    ]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    const fallida = respuestas.find((r) => r.status === 409)!;
    await esperarError(fallida, 409, "STOCK_INSUFICIENTE");
    expect((await esperarJson<ProductoPublico>(await obtener(cookieAdmin, p.id), 200)).existencia).toBe(0);
    expect((await esperarJson<Lista<MovimientoPublico>>(await historial(cookieAdmin, p.id), 200)).total).toBe(2);
  });
});

describe("GET /api/productos/{id}/movimientos", () => {
  it("historial del más nuevo al más viejo, paginado, para ambos roles", async () => {
    const p = await altaProducto({ stockInicial: 10 });
    await esperarJson(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1, motivo: "Rotura" }), 201);
    await esperarJson(await mover(cookieAdmin, p.id, { tipo: "ingreso", cantidad: 4, motivo: "Reposición" }), 201);
    await esperarJson(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 2, motivo: "Uso interno" }), 201);

    for (const cookie of [cookieAdmin, cookieVendedor]) {
      const todo = await esperarJson<Lista<MovimientoPublico>>(await historial(cookie, p.id), 200);
      expect(todo.total).toBe(4);
      expect(todo.data.map((m) => m.existenciaResultante)).toEqual([11, 13, 9, 10]);
      const fechas = todo.data.map((m) => Date.parse(m.fecha));
      expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
    }
    const p2 = await esperarJson<Lista<MovimientoPublico>>(await historial(cookieAdmin, p.id, "?page=2&pageSize=3"), 200);
    expect(p2).toMatchObject({ page: 2, pageSize: 3, total: 4 });
    expect(p2.data.map((m) => m.motivo)).toEqual(["Stock inicial"]);
  });

  it("producto inexistente → 404", async () => {
    await esperarError(await historial(cookieAdmin, 99999), 404, "NO_ENCONTRADO");
  });
});

describe("GET /api/movimientos-stock", () => {
  let filtroId: number;
  beforeAll(async () => {
    const p = await altaProducto({ stockInicial: 20 });
    filtroId = p.id;
    await esperarJson(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 2, motivo: "Rotura" }), 201);
    await esperarJson(await mover(cookieAdmin, p.id, { tipo: "egreso", cantidad: 1, motivo: "Vencimiento" }), 201);
  });

  it("filtra por producto y tipo, en orden descendente, con usuario y referencia", async () => {
    const r = await esperarJson<Lista<MovimientoPublico>>(
      await movimientosGlobal(cookieAdmin, `?productoId=${filtroId}&tipo=egreso`),
      200,
    );
    expect(r.total).toBe(2);
    expect(r.data.map((m) => m.motivo)).toEqual(["Vencimiento", "Rotura"]);
    expect(r.data.every((m) => m.producto.id === filtroId && m.usuario.id === adminId && m.referencia === null)).toBe(true);
  });

  it("filtra por fechas interpretadas en hora de Argentina", async () => {
    // Se fija la fecha de un movimiento a las 01:30 UTC del 15/10/2026,
    // que en Argentina (UTC−3) es el 14/10/2026 a las 22:30.
    const [mov] = await db
      .select({ id: movimientosStock.id })
      .from(movimientosStock)
      .where(eq(movimientosStock.productoId, filtroId))
      .limit(1);
    await db
      .update(movimientosStock)
      .set({ fecha: new Date("2026-10-15T01:30:00Z") })
      .where(eq(movimientosStock.id, mov.id));

    const dia14 = await esperarJson<Lista<MovimientoPublico>>(
      await movimientosGlobal(cookieAdmin, `?productoId=${filtroId}&desde=2026-10-14&hasta=2026-10-14`),
      200,
    );
    expect(dia14.data.map((m) => m.id)).toEqual([mov.id]);
    const dia15 = await esperarJson<Lista<MovimientoPublico>>(
      await movimientosGlobal(cookieAdmin, `?productoId=${filtroId}&desde=2026-10-15&hasta=2026-10-15`),
      200,
    );
    expect(dia15.total).toBe(0);
    const desde = await esperarJson<Lista<MovimientoPublico>>(
      await movimientosGlobal(cookieAdmin, `?productoId=${filtroId}&desde=2026-10-15`),
      200,
    );
    expect(desde.total).toBe(2);
  });

  it("valida los filtros y pagina", async () => {
    await esperarError(await movimientosGlobal(cookieAdmin, "?tipo=robo"), 422, "VALIDACION");
    await esperarError(await movimientosGlobal(cookieAdmin, "?desde=14/10/2026"), 422, "VALIDACION");
    await esperarError(await movimientosGlobal(cookieAdmin, "?desde=2026-10-20&hasta=2026-10-01"), 422, "VALIDACION");
    const r = await esperarJson<Lista<MovimientoPublico>>(await movimientosGlobal(cookieVendedor, "?pageSize=1"), 200);
    expect(r.data).toHaveLength(1);
    expect(r.total).toBeGreaterThan(1);
  });

  it("al vendedor no se le muestran movimientos de productos inactivos", async () => {
    const p = await altaProducto({ stockInicial: 3 });
    await esperarJson(await editar(cookieAdmin, p.id, { activo: false }), 200);
    const vend = await esperarJson<Lista<MovimientoPublico>>(await movimientosGlobal(cookieVendedor, `?productoId=${p.id}`), 200);
    expect(vend.total).toBe(0);
    const adm = await esperarJson<Lista<MovimientoPublico>>(await movimientosGlobal(cookieAdmin, `?productoId=${p.id}`), 200);
    expect(adm.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sesión y métodos
// ---------------------------------------------------------------------------

describe("sesión, formatos y métodos", () => {
  it("sin sesión todas las rutas responden 401 NO_AUTENTICADO en JSON", async () => {
    await esperarError(await listar(undefined), 401, "NO_AUTENTICADO");
    await esperarError(await crear(undefined, {}), 401, "NO_AUTENTICADO");
    await esperarError(await obtener(undefined, 1), 401, "NO_AUTENTICADO");
    await esperarError(await editar(undefined, 1, {}), 401, "NO_AUTENTICADO");
    await esperarError(await historial(undefined, 1), 401, "NO_AUTENTICADO");
    await esperarError(await mover(undefined, 1, {}), 401, "NO_AUTENTICADO");
    await esperarError(await movimientosGlobal(undefined), 401, "NO_AUTENTICADO");
  });

  it("con una cookie manipulada también responde 401", async () => {
    await esperarError(await listar(`${cookieAdmin}x`), 401, "NO_AUTENTICADO");
  });

  it("no existe DELETE en ninguna ruta del módulo", () => {
    for (const modulo of [rutaProductos, rutaId, rutaMovimientos, rutaMovimientosStock, rutaCategorias]) {
      expect("DELETE" in modulo).toBe(false);
    }
  });
});
