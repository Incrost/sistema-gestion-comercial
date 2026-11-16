/**
 * Pruebas de /perfil (RF-U5): acceso por rol, datos mostrados, formulario de
 * contraseña, flujo completo contra PUT /api/auth/password, menú del usuario
 * y diseño adaptable.
 *
 * Usan una base SQLite temporal (no tocan local.db ni Turso). La cookie de la
 * página se reemplaza con un next/headers falso y `redirect` lanza un error
 * reconocible, como hace Next.js.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

const entorno = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  ruta: "/perfil",
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (entorno.cookie ? { value: entorno.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
  usePathname: () => entorno.ruta,
  useRouter: () => entorno.router,
  // El envoltorio de las rutas relanza las señales internas de Next.js; aquí no hay ninguna.
  unstable_rethrow: () => {},
}));

import * as moduloDb from "@/db";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { POST as login } from "@/app/api/auth/login/route";
import { PUT as cambiarPassword } from "@/app/api/auth/password/route";
import { useCerrarSesion } from "@/components/auth/boton-cerrar-sesion";
import { PasswordField } from "@/components/formularios/password-field";
import { ENLACES_CUENTA } from "@/components/navegacion/menu-usuario";
import { enviarCambioContrasena } from "@/lib/cambio-contrasena";
import { ErrorDeApi } from "@/lib/cliente-api";
import { enlaceActivo } from "@/lib/navegacion";
import { firmarSesion, NOMBRE_COOKIE_SESION } from "@/lib/sesion-token";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import { ContenidoPerfil } from "./contenido-perfil";
import { DatosCuenta } from "./datos-cuenta";
import { FormularioContrasena } from "./formulario-contrasena";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

// Credenciales ficticias, solo para estas pruebas.
const CLAVE = "clave-de-prueba-123";
const contexto = { params: Promise.resolve({}) };
let contador = 0;

async function crearUsuario(rol: "admin" | "vendedor", nombre = "Laura Méndez") {
  const email = `perfil${++contador}@prueba.test`;
  const fila = await crearUsuarioDePrueba(db, { email, password: CLAVE, nombre, rol });
  return { ...fila, email };
}

/** Renderiza /perfil como el usuario indicado (su cookie firmada). */
async function abrirPerfil(usuarioId: number): Promise<string> {
  entorno.cookie = await firmarSesion(usuarioId);
  return renderToStaticMarkup((await ContenidoPerfil()) as ReactElement);
}

const RAIZ = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(RAIZ, "src", ...partes), "utf8");
/** Código sin comentarios (para buscar usos reales, no menciones en la documentación). */
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  entorno.cookie = undefined;
  entorno.ruta = "/perfil";
  vi.clearAllMocks();
});

describe("acceso a /perfil", () => {
  it("el administrador puede abrirla", async () => {
    const admin = await crearUsuario("admin", "Ana Administradora");
    const html = await abrirPerfil(admin.id);
    expect(html).toContain("Mi perfil");
    expect(html).toContain("Ana Administradora");
    expect(html).toContain("Administrador");
  });

  it("el vendedor puede abrirla", async () => {
    const vendedor = await crearUsuario("vendedor", "Víctor Vendedor");
    const html = await abrirPerfil(vendedor.id);
    expect(html).toContain("Mi perfil");
    expect(html).toContain("Víctor Vendedor");
    expect(html).toContain("Vendedor");
  });

  it("sin sesión redirige al login", async () => {
    await expect(ContenidoPerfil()).rejects.toThrow("REDIRECT:/login");
  });

  it("un usuario desactivado pierde el acceso de inmediato, aunque conserve la cookie", async () => {
    const usuario = await crearUsuario("vendedor");
    await abrirPerfil(usuario.id); // primero entra
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, usuario.id));
    await expect(ContenidoPerfil()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("datos de la cuenta", () => {
  it("muestra nombre, email, rol, estado activo y quién administra los datos", async () => {
    const usuario = await crearUsuario("vendedor", "Mariana López");
    const html = await abrirPerfil(usuario.id);
    for (const texto of ["Datos de la cuenta", "Mariana López", usuario.email, "Vendedor", "Activo", "los administra un administrador"]) {
      expect(html).toContain(texto);
    }
  });

  it("nunca muestra el hash de la contraseña", async () => {
    const usuario = await crearUsuario("admin");
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    const html = await abrirPerfil(usuario.id);
    expect(html).not.toContain(fila.passwordHash);
    expect(html).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(html).not.toContain(CLAVE);
  });

  it("los datos se muestran como texto, no como campos editables", () => {
    const html = renderToStaticMarkup(createElement(DatosCuenta, { usuario: { nombre: "Ana", email: "ana@prueba.test", rol: "admin" } }));
    expect(html).not.toContain("<input");
    expect(html).toContain("<dl");
  });
});

describe("formulario de contraseña", () => {
  const formulario = () => renderToStaticMarkup(createElement(FormularioContrasena));

  it("tiene los tres campos, ocultos por defecto y con autocomplete correcto", () => {
    const html = formulario();
    expect(html.match(/type="password"/g)).toHaveLength(3);
    expect(html).not.toContain('type="text"');
    expect(html).toMatch(/id="perfil-actual"[^>]*autoComplete="current-password"|autoComplete="current-password"[^>]*id="perfil-actual"/);
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html.match(/autoComplete="current-password"/g)).toHaveLength(1);
    for (const etiqueta of ["Contraseña actual", "Contraseña nueva", "Confirmación de la contraseña nueva"]) expect(html).toContain(etiqueta);
  });

  it("cada campo tiene un botón accesible para mostrar u ocultar la contraseña", () => {
    const html = formulario();
    expect(html).toContain('aria-label="Mostrar contraseña actual"');
    expect(html).toContain('aria-label="Mostrar contraseña nueva"');
    expect(html).toContain('aria-label="Mostrar confirmación de la contraseña nueva"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    // Los botones de mostrar no envían el formulario.
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });

  it("nunca pone las contraseñas en la URL: usa POST y no se envía de forma nativa", () => {
    const html = formulario();
    expect(html).toContain('method="post"');
    expect(html).not.toMatch(/method="get"/i);
    // Hasta que React toma el control, el botón de envío está deshabilitado.
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
  });

  it("el código del formulario no usa almacenamiento del navegador ni la consola", () => {
    for (const archivo of [
      leer("app", "(protegido)", "perfil", "formulario-contrasena.tsx"),
      leer("components", "formularios", "password-field.tsx"),
      leer("lib", "cambio-contrasena.ts"),
    ]) {
      expect(sinComentarios(archivo)).not.toMatch(/localStorage|sessionStorage|console\.|searchParams|history\.(push|replace)State/);
    }
  });

  it("los avisos de éxito o error no incluyen valores del formulario", () => {
    const fuente = leer("app", "(protegido)", "perfil", "formulario-contrasena.tsx");
    for (const llamada of fuente.match(/avisos\.\w+\([^)]*\)/g) ?? []) expect(llamada).not.toMatch(/campos|actual|nueva|confirmacion/);
  });

  it("el botón se deshabilita y un candado evita el doble envío", () => {
    const fuente = leer("app", "(protegido)", "perfil", "formulario-contrasena.tsx");
    expect(fuente).toContain("disabled={!listo || enviando}");
    expect(fuente).toContain("envio.current.ejecutar(");
  });

  it("muestra el error junto al campo con aria-invalid y aria-describedby", () => {
    const html = renderToStaticMarkup(
      createElement(PasswordField, {
        id: "campo",
        etiqueta: "Contraseña actual",
        autoComplete: "current-password",
        valor: "",
        onCambiar: () => {},
        error: "La contraseña actual es incorrecta.",
      }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="campo-error"');
    expect(html).toContain('id="campo-error" role="alert"');
  });
});

describe("cambio de contraseña de punta a punta (PUT /api/auth/password)", () => {
  /** Adaptador: el formulario «llama» al Route Handler real con la cookie de sesión. */
  function llamarConCookie(cookie: string | undefined, cuerpos: unknown[] = []) {
    return async (url: string, init: RequestInit) => {
      cuerpos.push(JSON.parse(init.body as string));
      const headers = new Headers({ "Content-Type": "application/json" });
      if (cookie) headers.set("cookie", `${NOMBRE_COOKIE_SESION}=${cookie}`);
      const respuesta = await cambiarPassword(new NextRequest(`http://localhost${url}`, { method: init.method, headers, body: init.body }), contexto);
      if (respuesta.status === 204) return null;
      const { error } = await respuesta.json();
      const campos = Object.fromEntries((error.details ?? []).map((d: { campo: string; mensaje: string }) => [d.campo, d.mensaje]));
      throw new ErrorDeApi(error.message, respuesta.status, error.code, campos);
    };
  }

  async function iniciarSesion(email: string, password: string) {
    return login(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
      contexto,
    );
  }

  it("éxito: envía solo actual y nueva, la nueva permite entrar y no cambian nombre, email ni rol", async () => {
    const usuario = await crearUsuario("vendedor", "Pedro Gómez");
    const cuerpos: unknown[] = [];
    const nueva = "otra-clave-segura-1";
    const resultado = await enviarCambioContrasena(
      { actual: CLAVE, nueva, confirmacion: nueva },
      llamarConCookie(await firmarSesion(usuario.id), cuerpos),
    );
    expect(resultado).toEqual({ tipo: "exito" });
    expect(cuerpos).toEqual([{ actual: CLAVE, nueva }]);

    expect((await iniciarSesion(usuario.email, CLAVE)).status).toBe(401);
    const respuesta = await iniciarSesion(usuario.email, nueva);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ id: usuario.id, nombre: "Pedro Gómez", email: usuario.email, rol: "vendedor" });

    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect({ nombre: fila.nombre, email: fila.email, rol: fila.rol, activo: fila.activo }).toEqual({
      nombre: "Pedro Gómez",
      email: usuario.email,
      rol: "vendedor",
      activo: true,
    });
  });

  it("contraseña actual incorrecta: el error queda en su campo y no cambia nada", async () => {
    const usuario = await crearUsuario("admin");
    const resultado = await enviarCambioContrasena(
      { actual: "equivocada-123", nueva: "otra-clave-segura-1", confirmacion: "otra-clave-segura-1" },
      llamarConCookie(await firmarSesion(usuario.id)),
    );
    expect(resultado).toEqual({ tipo: "campos", errores: { actual: "La contraseña actual es incorrecta." } });
    expect((await iniciarSesion(usuario.email, CLAVE)).status).toBe(200);
  });

  it("sin sesión o con el usuario desactivado: vuelve al login", async () => {
    const campos = { actual: CLAVE, nueva: "otra-clave-segura-1", confirmacion: "otra-clave-segura-1" };
    expect(await enviarCambioContrasena(campos, llamarConCookie(undefined))).toEqual({ tipo: "sesion" });

    const usuario = await crearUsuario("vendedor");
    const cookie = await firmarSesion(usuario.id);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, usuario.id));
    expect(await enviarCambioContrasena(campos, llamarConCookie(cookie))).toEqual({ tipo: "sesion" });
  });

  it("la API responde 204 sin cuerpo: nunca devuelve el hash", async () => {
    const usuario = await crearUsuario("vendedor");
    const respuesta = await cambiarPassword(
      new NextRequest("http://localhost/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: `${NOMBRE_COOKIE_SESION}=${await firmarSesion(usuario.id)}` },
        body: JSON.stringify({ actual: CLAVE, nueva: "otra-clave-segura-1" }),
      }),
      contexto,
    );
    expect(respuesta.status).toBe(204);
    expect(await respuesta.text()).toBe("");
  });
});

describe("menú del usuario", () => {
  it("ofrece «Mi perfil» a cualquier rol, con ruta activa en /perfil", () => {
    expect(ENLACES_CUENTA).toEqual([{ href: "/perfil", texto: "Mi perfil" }]);
    expect(enlaceActivo("/perfil", ["/perfil"])).toBe("/perfil");
    expect(enlaceActivo("/ventas", ["/perfil"])).toBeNull();
    const menu = leer("components", "navegacion", "menu-usuario.tsx");
    expect(menu).toContain('aria-current={esActivo ? "page" : undefined}');
    expect(menu).toMatch(/DropdownMenuItem[^>]*asChild/);
    expect(menu).not.toMatch(/rol\s*===\s*"admin"/);
  });

  it("«Perfil» no se agrega al panel lateral principal", () => {
    expect(leer("lib", "navegacion.ts")).not.toContain("/perfil");
  });

  it("«Cerrando sesión…» no sobrevive a la ruta oculta por <Activity> (Cache Components)", () => {
    const hook = leer("components", "auth", "boton-cerrar-sesion.tsx");
    expect(hook).toMatch(/useLayoutEffect\(\(\) => \(\) => setCerrando\(false\), \[\]\)/);
  });

  it("«Cerrar sesión» sigue en el menú y llama a POST /api/auth/logout antes de volver al login", async () => {
    expect(leer("components", "navegacion", "menu-usuario.tsx")).toContain("onSelect={() => void cerrarSesion()}");
    const fetchFalso = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchFalso);
    let cerrar!: () => Promise<void>;
    function Prueba() {
      cerrar = useCerrarSesion().cerrarSesion;
      return null;
    }
    renderToStaticMarkup(createElement(Prueba));
    await cerrar();
    vi.unstubAllGlobals();
    expect(fetchFalso).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(entorno.router.replace).toHaveBeenCalledWith("/login");
  });
});

describe("diseño adaptable (desde 360 px)", () => {
  it("una columna en móvil, sin anchos fijos y con el email partido si es largo", async () => {
    const usuario = await crearUsuario("vendedor", "Nombre extremadamente largo para una pantalla de 360 píxeles");
    const html = await abrirPerfil(usuario.id);
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("break-all");
    expect(html).toContain("min-w-0");
    expect(html).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/);
  });

  it("el botón ocupa todo el ancho en móvil y la página usa el contenedor común", () => {
    expect(renderToStaticMarkup(createElement(FormularioContrasena))).toContain("w-full sm:w-auto");
    expect(leer("app", "(protegido)", "perfil", "page.tsx")).toContain('<PageContainer ancho="documento">');
  });
});
