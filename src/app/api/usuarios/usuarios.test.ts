/**
 * Pruebas de integración de las rutas de /api/usuarios (RF-U4, RF-U5; sección 11.3).
 *
 * Se llama directamente a cada Route Handler con un NextRequest, igual que lo
 * haría Next.js, contra una base SQLite temporal (no toca local.db ni Turso).
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { verificarContrasena } from "@/lib/contrasenas";
import { firmarSesion, NOMBRE_COOKIE_SESION } from "@/lib/sesion-token";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { POST as login } from "../auth/login/route";
import { GET as me } from "../auth/me/route";
import * as rutaId from "./[id]/route";
import { POST as resetPassword } from "./[id]/reset-password/route";
import * as rutaUsuarios from "./route";

const { GET: listar, POST: crear } = rutaUsuarios;
const { PATCH: editar } = rutaId;

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());
afterEach(() => vi.restoreAllMocks());

// Credenciales ficticias, solo para estas pruebas.
const CLAVE = "clave-de-prueba-123";

let adminId: number;
let cookieAdmin: string;
let cookieVendedor: string;
let vendedorId: number;

beforeAll(async () => {
  const admin = await crearUsuarioDePrueba(db, {
    email: "admin@prueba.test",
    password: CLAVE,
    nombre: "Ana Administradora",
    rol: "admin",
  });
  const vendedor = await crearUsuarioDePrueba(db, {
    email: "vendedor@prueba.test",
    password: CLAVE,
    nombre: "Victor Vendedor",
    rol: "vendedor",
  });
  adminId = admin.id;
  vendedorId = vendedor.id;
  cookieAdmin = await firmarSesion(adminId);
  cookieVendedor = await firmarSesion(vendedorId);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

function pedido(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: string | object; cookie?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opciones.cookie !== undefined) {
    headers.set("cookie", `${NOMBRE_COOKIE_SESION}=${opciones.cookie}`);
  }
  const cuerpo =
    typeof opciones.cuerpo === "object" ? JSON.stringify(opciones.cuerpo) : opciones.cuerpo;
  return new NextRequest(`http://localhost${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers,
    body: cuerpo,
  });
}

const sinParametros = { params: Promise.resolve({}) };
const conId = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

function listarComo(cookie: string, consulta = "") {
  return listar(pedido(`/api/usuarios${consulta}`, { cookie }), sinParametros);
}

function crearComo(cookie: string, cuerpo: object | string) {
  return crear(pedido("/api/usuarios", { metodo: "POST", cookie, cuerpo }), sinParametros);
}

function editarComo(cookie: string, id: number | string, cuerpo: object | string) {
  return editar(
    pedido(`/api/usuarios/${id}`, { metodo: "PATCH", cookie, cuerpo }),
    conId(id),
  );
}

function resetComo(cookie: string, id: number | string) {
  return resetPassword(
    pedido(`/api/usuarios/${id}/reset-password`, { metodo: "POST", cookie }),
    conId(id),
  );
}

function iniciarSesion(email: string, password: string) {
  return login(
    pedido("/api/auth/login", { metodo: "POST", cuerpo: { email, password } }),
    sinParametros,
  );
}

let contador = 0;
/** Crea un usuario nuevo por la API (como admin) y devuelve su cuerpo. */
async function altaPorApi(datos: Partial<Record<"nombre" | "email" | "rol", string>> = {}) {
  const n = ++contador;
  const respuesta = await crearComo(cookieAdmin, {
    nombre: `Usuario ${n}`,
    email: `usuario${n}@prueba.test`,
    rol: "vendedor",
    password: CLAVE,
    ...datos,
  });
  expect(respuesta.status).toBe(201);
  return respuesta.json();
}

async function esperarError(respuesta: Response, status: number, code: string) {
  expect(respuesta.status).toBe(status);
  expect(respuesta.headers.get("content-type")).toContain("application/json");
  const cuerpo = await respuesta.json();
  expect(Object.keys(cuerpo)).toEqual(["error"]);
  expect(cuerpo.error.code).toBe(code);
  expect(typeof cuerpo.error.message).toBe("string");
  return cuerpo;
}

/** El texto de la respuesta nunca menciona hashes ni contraseñas. */
function sinSecretos(cuerpo: unknown) {
  expect(JSON.stringify(cuerpo)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
}

const camposPublicos = ["activo", "creadoEn", "email", "id", "nombre", "rol"];

// ---------------------------------------------------------------------------
// Permisos (requisitos 1 y 2)
// ---------------------------------------------------------------------------

describe("permisos: solo el administrador gestiona usuarios", () => {
  it("el administrador puede listar", async () => {
    expect((await listarComo(cookieAdmin)).status).toBe(200);
  });

  it("el vendedor recibe 403 SIN_PERMISO en las cuatro rutas, sin efectos", async () => {
    const otro = await altaPorApi();
    const antes = await db.select().from(usuarios).where(eq(usuarios.id, otro.id));

    await esperarError(await listarComo(cookieVendedor), 403, "SIN_PERMISO");
    await esperarError(
      await crearComo(cookieVendedor, {
        nombre: "Intruso",
        email: "intruso@prueba.test",
        rol: "admin",
        password: CLAVE,
      }),
      403,
      "SIN_PERMISO",
    );
    await esperarError(
      await editarComo(cookieVendedor, otro.id, { activo: false }),
      403,
      "SIN_PERMISO",
    );
    await esperarError(await resetComo(cookieVendedor, otro.id), 403, "SIN_PERMISO");

    // Nada cambió: ni alta, ni edición, ni contraseña nueva.
    expect(await db.select().from(usuarios).where(eq(usuarios.email, "intruso@prueba.test"))).toEqual([]);
    expect(await db.select().from(usuarios).where(eq(usuarios.id, otro.id))).toEqual(antes);
  });

  it("un vendedor tampoco puede subirse el rol a sí mismo", async () => {
    await esperarError(
      await editarComo(cookieVendedor, vendedorId, { rol: "admin" }),
      403,
      "SIN_PERMISO",
    );
  });

  it("sin sesión las cuatro rutas responden 401 NO_AUTENTICADO", async () => {
    await esperarError(await listar(pedido("/api/usuarios"), sinParametros), 401, "NO_AUTENTICADO");
    await esperarError(
      await crear(pedido("/api/usuarios", { metodo: "POST", cuerpo: {} }), sinParametros),
      401,
      "NO_AUTENTICADO",
    );
    await esperarError(
      await editar(pedido("/api/usuarios/1", { metodo: "PATCH", cuerpo: {} }), conId(1)),
      401,
      "NO_AUTENTICADO",
    );
    await esperarError(
      await resetPassword(pedido("/api/usuarios/1/reset-password", { metodo: "POST" }), conId(1)),
      401,
      "NO_AUTENTICADO",
    );
  });

  it("no existe ninguna ruta DELETE (baja lógica)", () => {
    expect(Object.keys(rutaUsuarios).sort()).toEqual(["GET", "POST"]);
    expect(Object.keys(rutaId)).toEqual(["PATCH"]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/usuarios (requisitos 3, 4 y 5)
// ---------------------------------------------------------------------------

describe("GET /api/usuarios", () => {
  beforeAll(async () => {
    await crearUsuarioDePrueba(db, {
      email: "zulema.busqueda@prueba.test",
      password: CLAVE,
      nombre: "Zulema Quiroga",
    });
    await crearUsuarioDePrueba(db, {
      email: "zz-inactivo@otro.test",
      password: CLAVE,
      nombre: "Zacarías Inactivo",
      activo: false,
    });
    await crearUsuarioDePrueba(db, {
      email: "comodin@prueba.test",
      password: CLAVE,
      nombre: "Con 100% de_comodines",
    });
  });

  it("200 con { data, page, pageSize, total } y sin passwordHash", async () => {
    const respuesta = await listarComo(cookieAdmin);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toContain("application/json");
    const cuerpo = await respuesta.json();
    expect(Object.keys(cuerpo).sort()).toEqual(["data", "page", "pageSize", "total"]);
    expect(cuerpo.page).toBe(1);
    expect(cuerpo.pageSize).toBe(20);
    expect(cuerpo.total).toBe(await db.$count(usuarios));
    for (const usuario of cuerpo.data) {
      expect(Object.keys(usuario).sort()).toEqual(camposPublicos);
      expect(usuario.creadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    }
    sinSecretos(cuerpo);
  });

  it("pagina con page y pageSize, ordenado por nombre", async () => {
    const total = await db.$count(usuarios);
    const primera = await (await listarComo(cookieAdmin, "?pageSize=2")).json();
    const segunda = await (await listarComo(cookieAdmin, "?pageSize=2&page=2")).json();
    expect(primera).toMatchObject({ page: 1, pageSize: 2, total });
    expect(segunda).toMatchObject({ page: 2, pageSize: 2, total });
    expect(primera.data).toHaveLength(2);
    expect(segunda.data).toHaveLength(2);

    const todos = await (await listarComo(cookieAdmin, "?pageSize=100")).json();
    const nombres = todos.data.map((u: { nombre: string }) => u.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect([...primera.data, ...segunda.data]).toEqual(todos.data.slice(0, 4));

    const fuera = await (await listarComo(cookieAdmin, "?page=999")).json();
    expect(fuera).toMatchObject({ data: [], page: 999, total });
  });

  it("filtra por activo", async () => {
    const inactivos = await (await listarComo(cookieAdmin, "?activo=false&pageSize=100")).json();
    expect(inactivos.data.length).toBeGreaterThan(0);
    expect(inactivos.data.every((u: { activo: boolean }) => !u.activo)).toBe(true);
    expect(inactivos.total).toBe(await db.$count(usuarios, eq(usuarios.activo, false)));

    const activos = await (await listarComo(cookieAdmin, "?activo=true&pageSize=100")).json();
    expect(activos.data.every((u: { activo: boolean }) => u.activo)).toBe(true);
    expect(activos.total + inactivos.total).toBe(await db.$count(usuarios));
  });

  it("busca por nombre y por email sin distinguir mayúsculas", async () => {
    const porNombre = await (await listarComo(cookieAdmin, "?q=QUIROGA")).json();
    expect(porNombre.data.map((u: { email: string }) => u.email)).toEqual([
      "zulema.busqueda@prueba.test",
    ]);
    expect(porNombre.total).toBe(1);

    const porEmail = await (await listarComo(cookieAdmin, "?q=%40otro.test")).json();
    expect(porEmail.data.map((u: { nombre: string }) => u.nombre)).toEqual(["Zacarías Inactivo"]);
  });

  it("combina búsqueda y filtro de estado", async () => {
    const cuerpo = await (await listarComo(cookieAdmin, "?q=Za&activo=true")).json();
    expect(cuerpo.data.map((u: { nombre: string }) => u.nombre)).not.toContain(
      "Zacarías Inactivo",
    );
  });

  it("los comodines % y _ se buscan como texto literal", async () => {
    const porciento = await (await listarComo(cookieAdmin, "?q=100%25")).json();
    expect(porciento.data.map((u: { email: string }) => u.email)).toEqual(["comodin@prueba.test"]);
    const guion = await (await listarComo(cookieAdmin, "?q=_")).json();
    expect(guion.data.map((u: { email: string }) => u.email)).toEqual(["comodin@prueba.test"]);
  });

  it("422 VALIDACION con parámetros inválidos o no previstos", async () => {
    const cuerpo = await esperarError(
      await listarComo(cookieAdmin, "?pageSize=500&activo=quizas&orden=nombre"),
      422,
      "VALIDACION",
    );
    const campos = cuerpo.error.details.map((d: { campo: string }) => d.campo).sort();
    expect(campos).toEqual(["activo", "orden", "pageSize"]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/usuarios (requisitos 6, 7 y 8)
// ---------------------------------------------------------------------------

describe("POST /api/usuarios", () => {
  it("201 con el usuario público, activo, email normalizado y solo el hash guardado", async () => {
    const respuesta = await crearComo(cookieAdmin, {
      nombre: "  Nora Nueva  ",
      email: "  Nora.Nueva@Prueba.TEST ",
      rol: "vendedor",
      password: CLAVE,
    });
    expect(respuesta.status).toBe(201);
    const cuerpo = await respuesta.json();
    expect(Object.keys(cuerpo).sort()).toEqual(camposPublicos);
    expect(cuerpo).toMatchObject({
      nombre: "Nora Nueva",
      email: "nora.nueva@prueba.test",
      rol: "vendedor",
      activo: true,
    });
    sinSecretos(cuerpo);

    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, cuerpo.id));
    expect(fila.email).toBe("nora.nueva@prueba.test");
    expect(fila.passwordHash).not.toBe(CLAVE);
    expect(fila.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(await verificarContrasena(CLAVE, fila.passwordHash)).toBe(true);

    // Puede iniciar sesión con la contraseña temporal y el email en cualquier formato.
    expect((await iniciarSesion("NORA.nueva@prueba.test", CLAVE)).status).toBe(200);
  });

  it("puede crear administradores", async () => {
    const cuerpo = await altaPorApi({ rol: "admin" });
    expect(cuerpo.rol).toBe("admin");
  });

  it("409 EMAIL_DUPLICADO aunque cambien mayúsculas o espacios", async () => {
    const existente = await altaPorApi();
    const cuerpo = await esperarError(
      await crearComo(cookieAdmin, {
        nombre: "Repetido",
        email: ` ${existente.email.toUpperCase()} `,
        rol: "vendedor",
        password: CLAVE,
      }),
      409,
      "EMAIL_DUPLICADO",
    );
    expect(cuerpo.error.details).toEqual([
      { campo: "email", mensaje: "Ya existe un usuario con ese email." },
    ]);
    expect(await db.$count(usuarios, eq(usuarios.email, existente.email))).toBe(1);
  });

  it("422 VALIDACION con detalle por campo, incluidos activo y passwordHash", async () => {
    const cuerpo = await esperarError(
      await crearComo(cookieAdmin, {
        nombre: " ",
        email: "no-es-email",
        rol: "gerente",
        password: "corta",
        activo: false,
        passwordHash: "x",
      }),
      422,
      "VALIDACION",
    );
    const campos = cuerpo.error.details.map((d: { campo: string }) => d.campo).sort();
    expect(campos).toEqual(["activo", "email", "nombre", "password", "passwordHash", "rol"]);
  });

  it("400 JSON_INVALIDO si el cuerpo no es JSON", async () => {
    await esperarError(await crearComo(cookieAdmin, "{nombre:"), 400, "JSON_INVALIDO");
  });

  it("un error inesperado de la base responde 500 ERROR_INTERNO, no EMAIL_DUPLICADO", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    });
    const cuerpo = await esperarError(
      await crearComo(cookieAdmin, {
        nombre: "Falla",
        email: "falla@prueba.test",
        rol: "vendedor",
        password: CLAVE,
      }),
      500,
      "ERROR_INTERNO",
    );
    expect(cuerpo.error.details).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain("locked");
    expect(log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/usuarios/{id} (requisitos 9 a 14)
// ---------------------------------------------------------------------------

describe("PATCH /api/usuarios/{id}", () => {
  it("200 con el usuario modificado (nombre, email normalizado y rol)", async () => {
    const usuario = await altaPorApi();
    const respuesta = await editarComo(cookieAdmin, usuario.id, {
      nombre: " Nombre Editado ",
      email: " EDITADO@Prueba.test",
      rol: "admin",
    });
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(Object.keys(cuerpo).sort()).toEqual(camposPublicos);
    expect(cuerpo).toMatchObject({
      id: usuario.id,
      nombre: "Nombre Editado",
      email: "editado@prueba.test",
      rol: "admin",
      activo: true,
    });
    sinSecretos(cuerpo);
  });

  it("modifica solo los campos enviados y no toca el hash", async () => {
    const usuario = await altaPorApi();
    const [antes] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    await editarComo(cookieAdmin, usuario.id, { nombre: "Solo Nombre" });
    const [despues] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(despues).toEqual({ ...antes, nombre: "Solo Nombre" });
  });

  it("permite conservar el propio email", async () => {
    const usuario = await altaPorApi();
    const respuesta = await editarComo(cookieAdmin, usuario.id, { email: usuario.email });
    expect(respuesta.status).toBe(200);
  });

  it("409 EMAIL_DUPLICADO al usar el email de otro usuario", async () => {
    const a = await altaPorApi();
    const b = await altaPorApi();
    await esperarError(
      await editarComo(cookieAdmin, b.id, { email: a.email.toUpperCase() }),
      409,
      "EMAIL_DUPLICADO",
    );
  });

  it.each([
    [{}, [""]],
    [{ passwordHash: "x" }, ["passwordHash"]],
    [{ nombre: "Válido", password: CLAVE }, ["password"]],
    [{ id: 99 }, ["id"]],
    [{ activo: "false" }, ["activo"]],
  ])("422 VALIDACION con el cuerpo %j", async (cuerpoPedido, camposEsperados) => {
    const usuario = await altaPorApi();
    const cuerpo = await esperarError(
      await editarComo(cookieAdmin, usuario.id, cuerpoPedido),
      422,
      "VALIDACION",
    );
    expect(cuerpo.error.details.map((d: { campo: string }) => d.campo)).toEqual(camposEsperados);
  });

  it("422 VALIDACION con un id que no es entero positivo", async () => {
    const cuerpo = await esperarError(
      await editarComo(cookieAdmin, "abc", { nombre: "X" }),
      422,
      "VALIDACION",
    );
    expect(cuerpo.error.details).toEqual([
      { campo: "id", mensaje: "Debe ser un identificador numérico." },
    ]);
  });

  it("404 NO_ENCONTRADO si el usuario no existe", async () => {
    await esperarError(await editarComo(cookieAdmin, 999999, { nombre: "X" }), 404, "NO_ENCONTRADO");
  });

  it("422 OPERACION_SOBRE_SI_MISMO: el admin no puede desactivarse", async () => {
    await esperarError(
      await editarComo(cookieAdmin, adminId, { activo: false }),
      422,
      "OPERACION_SOBRE_SI_MISMO",
    );
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, adminId));
    expect(fila.activo).toBe(true);
  });

  it("422 OPERACION_SOBRE_SI_MISMO: el admin no puede quitarse el rol", async () => {
    await esperarError(
      await editarComo(cookieAdmin, adminId, { nombre: "Ana", rol: "vendedor" }),
      422,
      "OPERACION_SOBRE_SI_MISMO",
    );
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, adminId));
    expect(fila).toMatchObject({ rol: "admin", nombre: "Ana Administradora" });
  });

  it("el admin sí puede editar sus otros datos y confirmar su rol", async () => {
    const respuesta = await editarComo(cookieAdmin, adminId, { rol: "admin", activo: true });
    expect(respuesta.status).toBe(200);
  });

  it("puede desactivar y reactivar a otro usuario", async () => {
    const usuario = await altaPorApi();
    const desactivado = await editarComo(cookieAdmin, usuario.id, { activo: false });
    expect(desactivado.status).toBe(200);
    expect((await desactivado.json()).activo).toBe(false);

    const reactivado = await editarComo(cookieAdmin, usuario.id, { activo: true });
    expect((await reactivado.json()).activo).toBe(true);
  });

  it("el usuario desactivado pierde el acceso aunque conserve la cookie", async () => {
    const usuario = await altaPorApi({ rol: "admin" });
    const sesion = await iniciarSesion(usuario.email, CLAVE);
    expect(sesion.status).toBe(200);
    const cookie = sesion.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${NOMBRE_COOKIE_SESION}=`))!
      .split(";")[0]
      .slice(NOMBRE_COOKIE_SESION.length + 1);
    expect((await me(pedido("/api/auth/me", { cookie }), sinParametros)).status).toBe(200);
    expect((await listarComo(cookie)).status).toBe(200);

    await editarComo(cookieAdmin, usuario.id, { activo: false });

    await esperarError(
      await me(pedido("/api/auth/me", { cookie }), sinParametros),
      401,
      "NO_AUTENTICADO",
    );
    await esperarError(await listarComo(cookie), 401, "NO_AUTENTICADO");
    await esperarError(await iniciarSesion(usuario.email, CLAVE), 401, "CREDENCIALES_INVALIDAS");
  });

  it("un cambio de rol a vendedor quita el acceso a la gestión de inmediato", async () => {
    const usuario = await altaPorApi({ rol: "admin" });
    const cookie = await firmarSesion(usuario.id);
    expect((await listarComo(cookie)).status).toBe(200);
    await editarComo(cookieAdmin, usuario.id, { rol: "vendedor" });
    await esperarError(await listarComo(cookie), 403, "SIN_PERMISO");
  });
});

// ---------------------------------------------------------------------------
// POST /api/usuarios/{id}/reset-password (requisitos 15 a 18)
// ---------------------------------------------------------------------------

describe("POST /api/usuarios/{id}/reset-password", () => {
  it("200 con { passwordTemporal } válida; la anterior deja de funcionar", async () => {
    const usuario = await altaPorApi();
    const [antes] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));

    const respuesta = await resetComo(cookieAdmin, usuario.id);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toContain("application/json");
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
    const cuerpo = await respuesta.json();
    expect(Object.keys(cuerpo)).toEqual(["passwordTemporal"]);
    const { passwordTemporal } = cuerpo;
    expect(passwordTemporal).toMatch(/^[A-Za-z0-9]{16}$/);

    // Solo se guardó el hash, distinto del anterior.
    const [despues] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(despues.passwordHash).not.toBe(antes.passwordHash);
    expect(despues.passwordHash).not.toContain(passwordTemporal);
    expect(await verificarContrasena(passwordTemporal, despues.passwordHash)).toBe(true);

    await esperarError(await iniciarSesion(usuario.email, CLAVE), 401, "CREDENCIALES_INVALIDAS");
    expect((await iniciarSesion(usuario.email, passwordTemporal)).status).toBe(200);
  });

  it("cada restablecimiento genera una contraseña distinta", async () => {
    const usuario = await altaPorApi();
    const a = (await (await resetComo(cookieAdmin, usuario.id)).json()).passwordTemporal;
    const b = (await (await resetComo(cookieAdmin, usuario.id)).json()).passwordTemporal;
    expect(a).not.toBe(b);
  });

  it("la contraseña temporal no aparece en los logs", async () => {
    const usuario = await altaPorApi();
    const metodos = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const espias = metodos.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const escrituras = [
      vi.spyOn(process.stdout, "write").mockImplementation(() => true),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    ];

    const respuesta = await resetComo(cookieAdmin, usuario.id);
    const { passwordTemporal } = await respuesta.json();

    const registrado = [...espias, ...escrituras]
      .flatMap((espia) => espia.mock.calls.flat())
      .map((argumento) => (typeof argumento === "string" ? argumento : JSON.stringify(argumento)))
      .join("\n");
    expect(registrado).not.toContain(passwordTemporal);
  });

  it("404 NO_ENCONTRADO si el usuario no existe", async () => {
    await esperarError(await resetComo(cookieAdmin, 999999), 404, "NO_ENCONTRADO");
  });

  it("422 VALIDACION con un id inválido", async () => {
    await esperarError(await resetComo(cookieAdmin, "0"), 422, "VALIDACION");
  });
});
