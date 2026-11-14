/**
 * Pruebas del servicio de usuarios sin pasar por HTTP: confirman que las
 * reglas viven en el servicio (las rutas solo adaptan), contra una base
 * SQLite temporal con las migraciones reales (no toca local.db ni Turso).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { aUsuarioPublico, type UsuarioAutenticado } from "./auth";
import {
  actualizarUsuario,
  aUsuarioGestion,
  crearUsuario,
  listarUsuarios,
  restablecerContrasena,
} from "./usuarios";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

// Contraseña ficticia, solo para estas pruebas.
const CLAVE = "clave-de-prueba-123";

let admin: UsuarioAutenticado;
let vendedor: UsuarioAutenticado;

beforeAll(async () => {
  admin = aUsuarioPublico(
    await crearUsuarioDePrueba(db, { email: "admin@servicio.test", password: CLAVE, rol: "admin" }),
  );
  vendedor = aUsuarioPublico(
    await crearUsuarioDePrueba(db, { email: "vende@servicio.test", password: CLAVE }),
  );
});

async function capturar(promesa: Promise<unknown>): Promise<ApiError | Error> {
  const error = await promesa.then(
    () => {
      throw new Error("Se esperaba un error");
    },
    (e: unknown) => e,
  );
  return error as ApiError | Error;
}

const alta = { nombre: "Nuevo", email: "nuevo@servicio.test", rol: "vendedor", password: CLAVE };

describe("aUsuarioGestion", () => {
  it("copia solo los campos públicos aunque la fila traiga el hash", async () => {
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, admin.id));
    const publico = aUsuarioGestion(fila);
    expect(Object.keys(publico).sort()).toEqual([
      "activo",
      "creadoEn",
      "email",
      "id",
      "nombre",
      "rol",
    ]);
    expect(JSON.stringify(publico)).not.toContain(fila.passwordHash);
  });
});

describe("orden: validar → permiso → reglas → base", () => {
  it("los datos inválidos se rechazan antes de mirar el rol (ZodError → 422)", async () => {
    const error = await capturar(crearUsuario(vendedor, { nombre: "" }));
    expect(error.name).toBe("ZodError");
  });

  it("con datos válidos, el vendedor recibe SIN_PERMISO en las cuatro operaciones", async () => {
    const operaciones = [
      listarUsuarios(vendedor, {}),
      crearUsuario(vendedor, { ...alta, email: "otro@servicio.test" }),
      actualizarUsuario(vendedor, { id: String(admin.id) }, { activo: false }),
      restablecerContrasena(vendedor, { id: String(admin.id) }),
    ];
    for (const operacion of operaciones) {
      expect(await capturar(operacion)).toMatchObject({ status: 403, code: "SIN_PERMISO" });
    }
    expect(await db.$count(usuarios, eq(usuarios.email, "otro@servicio.test"))).toBe(0);
  });

  it("sin usuario autenticado responde NO_AUTENTICADO", async () => {
    const sinUsuario = null as unknown as UsuarioAutenticado;
    expect(await capturar(listarUsuarios(sinUsuario, {}))).toMatchObject({
      code: "NO_AUTENTICADO",
    });
  });

  it("la regla sobre sí mismo se aplica antes de tocar la base", async () => {
    const actualizar = vi.spyOn(db, "update");
    const error = await capturar(actualizarUsuario(admin, { id: String(admin.id) }, { activo: false }));
    expect(error).toMatchObject({ status: 422, code: "OPERACION_SOBRE_SI_MISMO" });
    expect(actualizar).not.toHaveBeenCalled();
    actualizar.mockRestore();
  });
});

describe("reglas", () => {
  it("crearUsuario crea siempre activo y devuelve la forma pública", async () => {
    const creado = await crearUsuario(admin, alta);
    expect(creado).toMatchObject({ nombre: "Nuevo", email: "nuevo@servicio.test", activo: true });
  });

  it("crearUsuario: duplicado → EMAIL_DUPLICADO", async () => {
    const error = await capturar(crearUsuario(admin, { ...alta, email: "NUEVO@servicio.test" }));
    expect(error).toMatchObject({ status: 409, code: "EMAIL_DUPLICADO" });
  });

  it("actualizarUsuario: quitarse el rol → OPERACION_SOBRE_SI_MISMO", async () => {
    const error = await capturar(
      actualizarUsuario(admin, { id: String(admin.id) }, { rol: "vendedor" }),
    );
    expect(error).toMatchObject({ status: 422, code: "OPERACION_SOBRE_SI_MISMO" });
  });

  it("actualizarUsuario y restablecerContrasena: inexistente → NO_ENCONTRADO", async () => {
    expect(await capturar(actualizarUsuario(admin, { id: "999999" }, { nombre: "X" }))).toMatchObject(
      { status: 404, code: "NO_ENCONTRADO" },
    );
    expect(await capturar(restablecerContrasena(admin, { id: "999999" }))).toMatchObject({
      status: 404,
      code: "NO_ENCONTRADO",
    });
  });

  it("listarUsuarios devuelve la forma paginada", async () => {
    const lista = await listarUsuarios(admin, { pageSize: "1" });
    expect(lista).toMatchObject({ page: 1, pageSize: 1, total: await db.$count(usuarios) });
    expect(lista.data).toHaveLength(1);
  });
});
