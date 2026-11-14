/**
 * Pruebas de integración de las cuatro rutas de /api/auth (sección 11.3).
 *
 * Se llama directamente a cada Route Handler con un NextRequest, igual que lo
 * haría Next.js, contra una base SQLite temporal (no toca local.db ni Turso).
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { resolverSesion } from "@/lib/sesion";
import { DURACION_SESION_SEGUNDOS, firmarSesion, NOMBRE_COOKIE_SESION } from "@/lib/sesion-token";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as me } from "./me/route";
import { PUT as cambiarPassword } from "./password/route";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

// Credenciales ficticias, solo para estas pruebas.
const CLAVE = "clave-de-prueba-123";
const contexto = { params: Promise.resolve({}) };

let contador = 0;
let usuarioId: number;
let email: string;

/** Cada prueba usa un usuario nuevo y activo, así no dependen entre sí. */
beforeEach(async () => {
  email = `usuario${++contador}@prueba.test`;
  const fila = await crearUsuarioDePrueba(db, {
    email,
    password: CLAVE,
    nombre: "Laura Méndez",
    rol: "vendedor",
  });
  usuarioId = fila.id;
});

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

/** Devuelve el encabezado Set-Cookie de la sesión, si la respuesta lo trae. */
function cookieDeSesion(respuesta: Response): string | undefined {
  return respuesta.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${NOMBRE_COOKIE_SESION}=`));
}

function valorCookie(setCookie: string): string {
  return setCookie.split(";")[0].slice(NOMBRE_COOKIE_SESION.length + 1);
}

async function iniciarSesion(): Promise<string> {
  const respuesta = await login(
    pedido("/api/auth/login", { metodo: "POST", cuerpo: { email, password: CLAVE } }),
    contexto,
  );
  expect(respuesta.status).toBe(200);
  return valorCookie(cookieDeSesion(respuesta)!);
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

// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  it("200 con id, nombre, email y rol, y cookie de sesión segura", async () => {
    const respuesta = await login(
      pedido("/api/auth/login", { metodo: "POST", cuerpo: { email, password: CLAVE } }),
      contexto,
    );
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ id: usuarioId, nombre: "Laura Méndez", email, rol: "vendedor" });
    expect(JSON.stringify(cuerpo)).not.toMatch(/password|hash/i);

    const setCookie = cookieDeSesion(respuesta)!;
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toContain(`Max-Age=${DURACION_SESION_SEGUNDOS}`);
    expect(setCookie).not.toMatch(/Secure/i); // en pruebas NODE_ENV no es production

    const sesion = await resolverSesion(valorCookie(setCookie));
    expect(sesion).toEqual({
      estado: "valida",
      usuario: { id: usuarioId, nombre: "Laura Méndez", email, rol: "vendedor" },
    });
  });

  it("401 CREDENCIALES_INVALIDAS en los tres casos, con el mismo mensaje y sin cookie", async () => {
    await crearUsuarioDePrueba(db, {
      email: "inactivo-login@prueba.test",
      password: CLAVE,
      activo: false,
    });

    const mensajes = new Set<string>();
    for (const datos of [
      { email: "nadie@prueba.test", password: CLAVE },
      { email, password: "equivocada-123" },
      { email: "inactivo-login@prueba.test", password: CLAVE },
    ]) {
      const respuesta = await login(
        pedido("/api/auth/login", { metodo: "POST", cuerpo: datos }),
        contexto,
      );
      const cuerpo = await esperarError(respuesta, 401, "CREDENCIALES_INVALIDAS");
      mensajes.add(cuerpo.error.message);
      expect(cookieDeSesion(respuesta)).toBeUndefined();
    }
    expect(mensajes.size).toBe(1);
  });

  it("400 JSON_INVALIDO si el cuerpo no es JSON", async () => {
    const respuesta = await login(
      pedido("/api/auth/login", { metodo: "POST", cuerpo: "{email:" }),
      contexto,
    );
    await esperarError(respuesta, 400, "JSON_INVALIDO");
  });

  it("422 VALIDACION con detalle por campo", async () => {
    const respuesta = await login(
      pedido("/api/auth/login", { metodo: "POST", cuerpo: { email: "no-es-email", extra: 1 } }),
      contexto,
    );
    const cuerpo = await esperarError(respuesta, 422, "VALIDACION");
    const campos = cuerpo.error.details.map((d: { campo: string }) => d.campo).sort();
    expect(campos).toEqual(["email", "extra", "password"]);
  });
});

describe("GET /api/auth/me", () => {
  it("200 con el usuario conectado", async () => {
    const cookie = await iniciarSesion();
    const respuesta = await me(pedido("/api/auth/me", { cookie }), contexto);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({
      id: usuarioId,
      nombre: "Laura Méndez",
      email,
      rol: "vendedor",
    });
  });

  it("401 NO_AUTENTICADO sin cookie", async () => {
    const respuesta = await me(pedido("/api/auth/me"), contexto);
    await esperarError(respuesta, 401, "NO_AUTENTICADO");
    expect(cookieDeSesion(respuesta)).toBeUndefined();
  });

  it("401 con una cookie manipulada o vencida, y la borra", async () => {
    const cookie = await iniciarSesion();
    const otroUsuario = cookie.replace(/\.([^.]+)\./, (_, contenido: string) => {
      const datos = JSON.parse(Buffer.from(contenido, "base64url").toString());
      datos.sub = "1";
      return `.${Buffer.from(JSON.stringify(datos)).toString("base64url")}.`;
    });
    const vencida = await firmarSesion(usuarioId, {
      ahora: Math.floor(Date.now() / 1000) - DURACION_SESION_SEGUNDOS - 60,
    });

    for (const valor of [otroUsuario, vencida, "basura"]) {
      const respuesta = await me(pedido("/api/auth/me", { cookie: valor }), contexto);
      await esperarError(respuesta, 401, "NO_AUTENTICADO");
      expect(cookieDeSesion(respuesta)).toMatch(/Max-Age=0/);
    }
  });

  it("un usuario desactivado pierde el acceso aunque conserve la cookie", async () => {
    const cookie = await iniciarSesion();
    expect((await me(pedido("/api/auth/me", { cookie }), contexto)).status).toBe(200);

    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, usuarioId));

    const respuesta = await me(pedido("/api/auth/me", { cookie }), contexto);
    await esperarError(respuesta, 401, "NO_AUTENTICADO");
    expect(await resolverSesion(cookie)).toEqual({ estado: "desactivado" });
  });

  it("un cambio de rol se refleja de inmediato con la misma cookie", async () => {
    const cookie = await iniciarSesion();
    await db.update(usuarios).set({ rol: "admin" }).where(eq(usuarios.id, usuarioId));
    const respuesta = await me(pedido("/api/auth/me", { cookie }), contexto);
    expect((await respuesta.json()).rol).toBe("admin");
  });
});

describe("POST /api/auth/logout", () => {
  it("204 sin cuerpo y borra la cookie", async () => {
    const cookie = await iniciarSesion();
    const respuesta = await logout(
      pedido("/api/auth/logout", { metodo: "POST", cookie }),
      contexto,
    );
    expect(respuesta.status).toBe(204);
    expect(await respuesta.text()).toBe("");
    const setCookie = cookieDeSesion(respuesta)!;
    expect(valorCookie(setCookie)).toBe("");
    expect(setCookie).toMatch(/Max-Age=0/);
    expect(setCookie).toMatch(/Path=\//);
  });

  it("401 NO_AUTENTICADO sin sesión", async () => {
    const respuesta = await logout(pedido("/api/auth/logout", { metodo: "POST" }), contexto);
    await esperarError(respuesta, 401, "NO_AUTENTICADO");
  });
});

describe("PUT /api/auth/password", () => {
  it("204 y la nueva contraseña permite iniciar sesión", async () => {
    const cookie = await iniciarSesion();
    const respuesta = await cambiarPassword(
      pedido("/api/auth/password", {
        metodo: "PUT",
        cookie,
        cuerpo: { actual: CLAVE, nueva: "nueva-clave-456" },
      }),
      contexto,
    );
    expect(respuesta.status).toBe(204);
    expect(await respuesta.text()).toBe("");

    const anterior = await login(
      pedido("/api/auth/login", { metodo: "POST", cuerpo: { email, password: CLAVE } }),
      contexto,
    );
    expect(anterior.status).toBe(401);
    const nueva = await login(
      pedido("/api/auth/login", {
        metodo: "POST",
        cuerpo: { email, password: "nueva-clave-456" },
      }),
      contexto,
    );
    expect(nueva.status).toBe(200);
  });

  it("422 CONTRASENA_ACTUAL_INCORRECTA", async () => {
    const cookie = await iniciarSesion();
    const respuesta = await cambiarPassword(
      pedido("/api/auth/password", {
        metodo: "PUT",
        cookie,
        cuerpo: { actual: "equivocada-123", nueva: "nueva-clave-456" },
      }),
      contexto,
    );
    await esperarError(respuesta, 422, "CONTRASENA_ACTUAL_INCORRECTA");
  });

  it("422 VALIDACION si la nueva tiene menos de 8 caracteres", async () => {
    const cookie = await iniciarSesion();
    const respuesta = await cambiarPassword(
      pedido("/api/auth/password", {
        metodo: "PUT",
        cookie,
        cuerpo: { actual: CLAVE, nueva: "corta" },
      }),
      contexto,
    );
    const cuerpo = await esperarError(respuesta, 422, "VALIDACION");
    expect(cuerpo.error.details).toEqual([
      { campo: "nueva", mensaje: "Debe tener al menos 8 caracteres." },
    ]);
  });

  it("400 JSON_INVALIDO con un cuerpo que no es JSON", async () => {
    const cookie = await iniciarSesion();
    const respuesta = await cambiarPassword(
      pedido("/api/auth/password", { metodo: "PUT", cookie, cuerpo: "no-json" }),
      contexto,
    );
    await esperarError(respuesta, 400, "JSON_INVALIDO");
  });

  it("401 NO_AUTENTICADO sin sesión (antes de leer el cuerpo)", async () => {
    const respuesta = await cambiarPassword(
      pedido("/api/auth/password", { metodo: "PUT", cuerpo: "no-json" }),
      contexto,
    );
    await esperarError(respuesta, 401, "NO_AUTENTICADO");
  });
});
