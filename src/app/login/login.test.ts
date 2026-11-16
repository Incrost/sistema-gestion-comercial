/**
 * Pruebas del inicio de sesión: botón para mostrar u ocultar la contraseña,
 * autocompletado, cuerpo enviado al servidor y ausencia de almacenamiento
 * del navegador o de credenciales visibles.
 *
 * Como el resto del proyecto, se renderiza con react-dom/server (sin
 * bibliotecas de pruebas de componentes). El cambio de estado del botón se
 * prueba con la función pura que usa el componente (visibilidadContrasena);
 * la activación con Enter y Espacio la da el <button> nativo, y se verifica
 * que nada la intercepte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }),
}));

import { PasswordField, visibilidadContrasena } from "@/components/formularios/password-field";

import { cuerpoLogin, FormularioLogin } from "./formulario-login";

const SRC = join(process.cwd(), "src");
const leer = (...partes: string[]) => readFileSync(join(SRC, ...partes), "utf8");
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const html = renderToStaticMarkup(createElement(FormularioLogin, { destino: "/" }));
/** Etiqueta <input> de la contraseña y <button> del ojo, tal como se renderizan. */
const inputPassword = html.match(/<input[^>]*id="login-password"[^>]*>/)?.[0] ?? "";
const botonOjo = html.match(/<button[^>]*aria-controls="login-password"[^>]*>/)?.[0] ?? "";

describe("login: botón para mostrar u ocultar la contraseña", () => {
  it("el campo de contraseña tiene un botón con ícono de ojo", () => {
    expect(botonOjo).not.toBe("");
    expect(botonOjo).toContain('aria-label="Mostrar contraseña"');
    expect(html).toMatch(/aria-controls="login-password"[^>]*>\s*<svg[^>]*lucide-eye/);
  });

  it("la contraseña empieza oculta y el botón no presionado", () => {
    expect(inputPassword).toContain('type="password"');
    expect(html).not.toContain('type="text"');
    expect(botonOjo).toContain('aria-pressed="false"');
  });

  it("un clic la muestra y otro la vuelve a ocultar, con aria-label y aria-pressed coherentes", () => {
    let visible = false;
    expect(visibilidadContrasena(visible, "Contraseña")).toEqual({ type: "password", accion: "Mostrar contraseña", pressed: false });
    visible = !visible; // primer clic
    expect(visibilidadContrasena(visible, "Contraseña")).toEqual({ type: "text", accion: "Ocultar contraseña", pressed: true });
    visible = !visible; // segundo clic
    expect(visibilidadContrasena(visible, "Contraseña")).toEqual({ type: "password", accion: "Mostrar contraseña", pressed: false });
  });

  it("Enter y Espacio lo operan: es un <button type=\"button\"> nativo, alcanzable con Tab y sin manejo de teclas que lo bloquee", () => {
    expect(botonOjo).toContain('type="button"');
    expect(botonOjo).not.toMatch(/tabindex="-1"| disabled=""/i);
    const campo = sinComentarios(leer("components", "formularios", "password-field.tsx"));
    expect(campo).toContain("onClick={() => setVisible((v) => !v)}");
    expect(campo).not.toMatch(/onKeyDown|onKeyUp|preventDefault/);
  });

  it("mostrar u ocultar no altera el valor: solo cambia el tipo del campo", () => {
    const campo = renderToStaticMarkup(
      createElement(PasswordField, { id: "p", etiqueta: "Contraseña", valor: "secreto-123", onCambiar: () => {}, autoComplete: "current-password" }),
    );
    expect(campo).toContain('value="secreto-123"');
    expect(Object.keys(visibilidadContrasena(true, "Contraseña")).sort()).toEqual(["accion", "pressed", "type"]);
  });

  it("el botón no envía el formulario (no es de tipo submit) y hay un único botón de envío", () => {
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html.match(/type="button"/g)).toHaveLength(1);
  });
});

describe("login: campos, envío y validación", () => {
  it("mantiene autocomplete current-password en la contraseña y username en el correo", () => {
    expect(inputPassword).toContain('autoComplete="current-password"');
    expect(inputPassword).toContain('name="password"');
    expect(html).toMatch(/<input[^>]*id="login-email"[^>]*autoComplete="username"/);
  });

  it("el cuerpo enviado contiene únicamente email y password", () => {
    const datos = new FormData();
    datos.set("email", "persona@ejemplo.test");
    datos.set("password", "clave");
    datos.set("visible", "true");
    datos.set("recordarme", "on");
    expect(JSON.parse(cuerpoLogin(datos))).toEqual({ email: "persona@ejemplo.test", password: "clave" });
    expect(sinComentarios(leer("app", "login", "formulario-login.tsx"))).toContain("body: cuerpoLogin(datos)");
  });

  it("conserva la validación existente: ambos campos obligatorios, error del servidor junto al formulario", () => {
    expect(inputPassword).toContain('required=""');
    expect(html).toMatch(/<input[^>]*id="login-email"[^>]*required=""/);
    expect(html).toContain("noValidate");
    const fuente = leer("app", "login", "formulario-login.tsx");
    expect(fuente).toContain('id="error-login"');
    expect(fuente).toContain("fallar(cuerpo.error.message)");
  });

  it("no ofrece «Recordarme» ni usa almacenamiento del navegador", () => {
    expect(html).not.toMatch(/recordar/i);
    for (const archivo of [leer("app", "login", "formulario-login.tsx"), leer("app", "login", "page.tsx"), leer("components", "formularios", "password-field.tsx")]) {
      expect(sinComentarios(archivo)).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });

  it("no muestra credenciales académicas en la pantalla", () => {
    for (const texto of [html, sinComentarios(leer("app", "login", "page.tsx"))]) {
      expect(texto).not.toMatch(/@comercio\.test|Prueba-2026/);
    }
  });

  it("el botón Ingresar tiene altura táctil de al menos 44 px (h-11)", () => {
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*class="[^"]*\bh-11\b)[^>]*>/);
  });
});

describe("login: diseño móvil", () => {
  const pagina = leer("app", "login", "page.tsx");

  it("en móvil muestra ícono, nombre, descripción, tarjeta y nota de acceso", () => {
    expect(pagina).toMatch(/className="items-center text-center lg:hidden"/);
    expect(pagina).toContain("<StoreIcon");
    expect(pagina).toContain("APLICACION.descripcion");
    expect(pagina).toContain("Iniciar sesión");
    expect(pagina).toMatch(/lg:hidden">\s*<LockKeyholeIcon/);
  });

  it("usa márgenes laterales de 16 px y menos espacio superior que inferior; escritorio conserva dos sectores", () => {
    expect(pagina).toContain("px-4 pt-6 pb-10");
    expect(pagina).toContain("lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]");
    expect(pagina).toContain("min-h-svh");
    expect(pagina).not.toMatch(/<img|<Image|https?:\/\//);
  });
});
