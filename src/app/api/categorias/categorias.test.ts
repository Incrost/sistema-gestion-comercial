/**
 * Pruebas de integración de /api/categorias (RF-P7; sección 11.4).
 *
 * Se llama a cada Route Handler con un NextRequest, igual que Next.js, contra
 * una base SQLite temporal (no toca local.db ni Turso).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { firmarSesion } from "@/lib/sesion-token";
import { conId, esperarError, esperarJson, pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { POST as crearProductoRuta } from "../productos/route";
import * as rutaId from "./[id]/route";
import * as rutaCategorias from "./route";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

let cookieAdmin: string;
let cookieVendedor: string;

beforeAll(async () => {
  const admin = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin" });
  const vendedor = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
  cookieAdmin = await firmarSesion(admin.id);
  cookieVendedor = await firmarSesion(vendedor.id);
});

const listar = (cookie?: string, consulta = "") =>
  rutaCategorias.GET(pedido(`/api/categorias${consulta}`, { cookie }), sinParametros);
const crear = (cookie: string | undefined, cuerpo: object | string) =>
  rutaCategorias.POST(pedido("/api/categorias", { metodo: "POST", cookie, cuerpo }), sinParametros);
const editar = (cookie: string | undefined, id: number | string, cuerpo: object | string) =>
  rutaId.PATCH(pedido(`/api/categorias/${id}`, { metodo: "PATCH", cookie, cuerpo }), conId(id));

type Categoria = { id: number; nombre: string; activa: boolean };

describe("POST y PATCH /api/categorias (admin)", () => {
  it("el admin crea una categoría (201) con el nombre normalizado", async () => {
    const cat = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "  Ferretería   general " }), 201);
    expect(cat).toEqual({ id: expect.any(Number), nombre: "Ferretería general", activa: true });
  });

  it("el admin edita el nombre (200)", async () => {
    const cat = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "Electricida" }), 201);
    const editada = await esperarJson<Categoria>(await editar(cookieAdmin, cat.id, { nombre: "Electricidad" }), 200);
    expect(editada).toEqual({ id: cat.id, nombre: "Electricidad", activa: true });
  });

  it("nombre repetido → 409 NOMBRE_DUPLICADO (también sin distinguir mayúsculas)", async () => {
    await esperarJson(await crear(cookieAdmin, { nombre: "Jardín" }), 201);
    const r1 = await esperarError(await crear(cookieAdmin, { nombre: "Jardín" }), 409, "NOMBRE_DUPLICADO");
    expect(r1.error.details).toEqual([{ campo: "nombre", mensaje: expect.any(String) }]);
    await esperarError(await crear(cookieAdmin, { nombre: "jardín" }), 409, "NOMBRE_DUPLICADO");
    const otra = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "Riego" }), 201);
    await esperarError(await editar(cookieAdmin, otra.id, { nombre: "Jardín" }), 409, "NOMBRE_DUPLICADO");
  });

  it("valida el cuerpo: vacío, campos extra, JSON inválido y PATCH sin campos", async () => {
    await esperarError(await crear(cookieAdmin, { nombre: "  " }), 422, "VALIDACION");
    await esperarError(await crear(cookieAdmin, { nombre: "X", activa: false }), 422, "VALIDACION");
    await esperarError(await crear(cookieAdmin, "{no es json"), 400, "JSON_INVALIDO");
    const cat = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "Varios" }), 201);
    await esperarError(await editar(cookieAdmin, cat.id, {}), 422, "VALIDACION");
    await esperarError(await editar(cookieAdmin, cat.id, { nombre: "Y", color: "rojo" }), 422, "VALIDACION");
  });

  it("categoría inexistente → 404; id inválido → 422", async () => {
    await esperarError(await editar(cookieAdmin, 99999, { nombre: "Nada" }), 404, "NO_ENCONTRADO");
    await esperarError(await editar(cookieAdmin, "abc", { nombre: "Nada" }), 422, "VALIDACION");
  });

  it("no se puede desactivar con productos activos (409 CATEGORIA_EN_USO); sin ellos, sí", async () => {
    const cat = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "Con productos" }), 201);
    const respuesta = await crearProductoRuta(
      pedido("/api/productos", {
        metodo: "POST",
        cookie: cookieAdmin,
        cuerpo: { codigo: "CAT-1", descripcion: "Producto", categoriaId: cat.id, precio: 100, stockMinimo: 0 },
      }),
      sinParametros,
    );
    const producto = await esperarJson<{ id: number }>(respuesta, 201);

    await esperarError(await editar(cookieAdmin, cat.id, { activa: false }), 409, "CATEGORIA_EN_USO");

    // Se da de baja el producto y ahora sí puede desactivarse.
    const { PATCH: editarProducto } = await import("../productos/[id]/route");
    await esperarJson(
      await editarProducto(
        pedido(`/api/productos/${producto.id}`, { metodo: "PATCH", cookie: cookieAdmin, cuerpo: { activo: false } }),
        conId(producto.id),
      ),
      200,
    );
    const desactivada = await esperarJson<Categoria>(await editar(cookieAdmin, cat.id, { activa: false }), 200);
    expect(desactivada.activa).toBe(false);
    // Reactivación lógica.
    expect((await esperarJson<Categoria>(await editar(cookieAdmin, cat.id, { activa: true }), 200)).activa).toBe(true);
  });
});

describe("GET /api/categorias", () => {
  it("ambos roles la listan: solo activas, ordenadas por nombre, sin paginar", async () => {
    const inactiva = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "Zeta inactiva" }), 201);
    await esperarJson(await editar(cookieAdmin, inactiva.id, { activa: false }), 200);

    for (const cookie of [cookieAdmin, cookieVendedor]) {
      const lista = await esperarJson<Categoria[]>(await listar(cookie), 200);
      expect(Array.isArray(lista)).toBe(true);
      expect(lista.every((c) => c.activa)).toBe(true);
      expect(lista.some((c) => c.id === inactiva.id)).toBe(false);
      const nombres = lista.map((c) => c.nombre);
      expect(nombres).toEqual([...nombres].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it("incluirInactivas=true: el admin las ve todas; el vendedor recibe 403", async () => {
    const todas = await esperarJson<Categoria[]>(await listar(cookieAdmin, "?incluirInactivas=true"), 200);
    expect(todas.some((c) => !c.activa)).toBe(true);
    await esperarError(await listar(cookieVendedor, "?incluirInactivas=true"), 403, "SIN_PERMISO");
  });
});

describe("permisos y sesión", () => {
  it("el vendedor recibe 403 al crear o editar", async () => {
    await esperarError(await crear(cookieVendedor, { nombre: "Del vendedor" }), 403, "SIN_PERMISO");
    const cat = await esperarJson<Categoria>(await crear(cookieAdmin, { nombre: "Protegida" }), 201);
    await esperarError(await editar(cookieVendedor, cat.id, { nombre: "Cambio" }), 403, "SIN_PERMISO");
    await esperarError(await editar(cookieVendedor, cat.id, { activa: false }), 403, "SIN_PERMISO");
  });

  it("sin sesión → 401 en todas las operaciones", async () => {
    await esperarError(await listar(undefined), 401, "NO_AUTENTICADO");
    await esperarError(await crear(undefined, { nombre: "X" }), 401, "NO_AUTENTICADO");
    await esperarError(await editar(undefined, 1, { nombre: "X" }), 401, "NO_AUTENTICADO");
  });

  it("no existe DELETE (baja lógica, regla 12)", () => {
    expect("DELETE" in rutaCategorias).toBe(false);
    expect("DELETE" in rutaId).toBe(false);
  });
});
