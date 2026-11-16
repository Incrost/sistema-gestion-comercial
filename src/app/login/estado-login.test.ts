/**
 * Pruebas del estado del login conservado por <Activity> (Cache Components).
 *
 * Next.js oculta /login en lugar de desmontarlo al entrar al área protegida.
 * Sin reinicio, al cerrar sesión el formulario reaparecía en «Ingresando…».
 * Como en el resto del proyecto (sin DOM ni bibliotecas de componentes), el
 * ciclo se prueba con el reductor puro que usa el formulario y se verifica
 * en la fuente que la limpieza de useLayoutEffect lo despache.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }),
}));

import { visibilidadContrasena } from "@/components/formularios/password-field";

import { ESTADO_INICIAL_LOGIN, reducirLogin, type AccionLogin, type EstadoLogin } from "./estado-login";
import { cuerpoLogin, FormularioLogin } from "./formulario-login";

const SRC = join(process.cwd(), "src");
const leer = (...partes: string[]) => readFileSync(join(SRC, ...partes), "utf8");
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const html = renderToStaticMarkup(createElement(FormularioLogin, { destino: "/" }));
const inputPassword = html.match(/<input[^>]*id="login-password"[^>]*>/)?.[0] ?? "";
const botonOjo = html.match(/<button[^>]*aria-controls="login-password"[^>]*>/)?.[0] ?? "";
const fuente = sinComentarios(leer("app", "login", "formulario-login.tsx"));

const aplicar = (estado: EstadoLogin, ...acciones: AccionLogin[]) => acciones.reduce(reducirLogin, estado);

/** Lo que el usuario ve al volver a /login: habilitado, vacío y sin error. */
function esperarFormularioLimpio(estado: EstadoLogin) {
  expect(estado.enviando).toBe(false);
  expect(estado.error).toBeNull();
  expect(estado.password).toBe("");
  expect(estado.email).toBe("");
}

/** Ingreso correcto: escribe, envía y /login queda oculto al navegar (reinicio). */
function cicloCompleto(estado: EstadoLogin) {
  const enviado = aplicar(estado, { tipo: "email", valor: "admin@ejemplo.test" }, { tipo: "password", valor: "clave" }, { tipo: "enviar" });
  expect(enviado.enviando).toBe(true); // «Ingresando…» mientras navega
  return aplicar(enviado, { tipo: "reiniciar" }); // Activity oculta /login → limpieza
}

describe("login: envío", () => {
  it("comienza sin envío pendiente y el botón dice «Ingresar» habilitado", () => {
    esperarFormularioLimpio(ESTADO_INICIAL_LOGIN);
    const boton = html.match(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(boton).toContain("Ingresar");
    expect(boton).not.toMatch(/disabled=""/);
    expect(html).not.toContain("Ingresando");
  });

  it("al enviar pasa a pendiente («Ingresando…») y limpia el error anterior", () => {
    const estado = aplicar(ESTADO_INICIAL_LOGIN, { tipo: "enviar" }, { tipo: "fallo", intento: 1, mensaje: "Credenciales inválidas" }, { tipo: "enviar" });
    expect(estado.enviando).toBe(true);
    expect(estado.error).toBeNull();
    expect(fuente).toContain('{enviando ? "Ingresando…" : "Ingresar"}');
    expect(fuente).toContain("disabled={enviando}");
  });

  it("bloquea el doble envío: el reductor no inicia otro intento y el formulario lo corta antes del fetch", () => {
    const uno = aplicar(ESTADO_INICIAL_LOGIN, { tipo: "enviar" });
    expect(aplicar(uno, { tipo: "enviar" })).toBe(uno);
    expect(fuente).toMatch(/if \(enCurso\.current\) return;[\s\S]*fetch\("\/api\/auth\/login"/);
  });

  it("un ingreso correcto navega al destino (replace + refresh) con el botón todavía bloqueado", () => {
    expect(fuente).toMatch(/if \(respuesta\.ok\) \{\s*router\.replace\(destino\);\s*router\.refresh\(\);\s*return;/);
  });

  it("un ingreso fallido reactiva el formulario con el mensaje del servidor", () => {
    const estado = aplicar(ESTADO_INICIAL_LOGIN, { tipo: "password", valor: "mala" }, { tipo: "enviar" }, { tipo: "fallo", intento: 1, mensaje: "Credenciales inválidas" });
    expect(estado).toMatchObject({ enviando: false, error: "Credenciales inválidas" });
    expect(fuente).toContain("fallar(cuerpo.error.message)");
  });

  it("una falla de red reactiva el formulario con un mensaje propio", () => {
    expect(fuente).toMatch(/catch \{\s*fallar\("No fue posible comunicarse con el servidor\. Intente nuevamente\."\);/);
    const estado = aplicar(ESTADO_INICIAL_LOGIN, { tipo: "enviar" }, { tipo: "fallo", intento: 1, mensaje: "sin red" });
    expect(estado).toMatchObject({ enviando: false, error: "sin red" });
  });

  it("correo y contraseña nunca van en la URL: POST con cuerpo JSON y formulario sin action ni GET", () => {
    expect(fuente).toMatch(/fetch\("\/api\/auth\/login", \{\s*method: "POST"/);
    expect(html).not.toMatch(/<form[^>]*(action=|method="get")/i);
    expect(fuente).not.toMatch(/URLSearchParams|\?email=|router\.(push|replace)\([^)]*(email|password)/);
  });

  it("el cuerpo sigue siendo solamente { email, password }", () => {
    expect(fuente).toContain("body: cuerpoLogin(datos)");
    const datos = new FormData();
    datos.set("email", "a@b.test");
    datos.set("password", "x");
    datos.set("extra", "y");
    expect(JSON.parse(cuerpoLogin(datos))).toEqual({ email: "a@b.test", password: "x" });
  });
});

describe("login: estado conservado por <Activity> (Cache Components)", () => {
  it("al ocultarse o desmontarse, la limpieza de useLayoutEffect cancela el envío y reinicia el estado", () => {
    expect(fuente).toMatch(
      /useLayoutEffect\(\s*\(\) => \(\) => \{\s*enCurso\.current\?\.abort\(\);\s*enCurso\.current = null;\s*despachar\(\{ tipo: "reiniciar" \}\);\s*\},\s*\[\],\s*\)/,
    );
    esperarFormularioLimpio(aplicar(ESTADO_INICIAL_LOGIN, { tipo: "enviar" }, { tipo: "reiniciar" }));
  });

  it("tras cerrar sesión el botón vuelve a «Ingresar» y el ciclo login → logout → login se repite (5 veces)", () => {
    let estado = ESTADO_INICIAL_LOGIN;
    for (let ciclo = 1; ciclo <= 5; ciclo++) {
      estado = cicloCompleto(estado);
      esperarFormularioLimpio(estado);
      expect(estado.generacion).toBe(ciclo);
    }
    expect(aplicar(estado, { tipo: "enviar" }).enviando).toBe(true); // se puede volver a ingresar
  });

  it("al volver no se dispara un ingreso automático: solo el submit llama a la API", () => {
    expect(fuente.match(/fetch\(/g)).toHaveLength(1);
    expect(fuente).toContain("onSubmit={enviar}");
    expect(fuente).not.toMatch(/useEffect\(|requestSubmit|\.submit\(\)/);
    const efecto = fuente.match(/useLayoutEffect\([\s\S]*?\[\],\s*\)/)?.[0] ?? "";
    expect(efecto).not.toMatch(/fetch|enviar\(/);
  });

  it("la contraseña se limpia y vuelve a quedar oculta (el campo se monta de nuevo por generación)", () => {
    expect(cicloCompleto(ESTADO_INICIAL_LOGIN).password).toBe("");
    expect(fuente).toMatch(/<PasswordField\s+key=\{generacion\}/);
    expect(fuente).toContain("valor={password}");
    expect(inputPassword).toContain('type="password"');
    expect(botonOjo).toContain('aria-pressed="false"');
  });

  it("el correo también se limpia: es un campo controlado por el estado que se reinicia", () => {
    expect(fuente).toContain("value={email}");
    expect(cicloCompleto(ESTADO_INICIAL_LOGIN).email).toBe("");
  });

  it("los errores anteriores no reaparecen al volver", () => {
    const conError = aplicar(ESTADO_INICIAL_LOGIN, { tipo: "enviar" }, { tipo: "fallo", intento: 1, mensaje: "Credenciales inválidas" });
    expect(conError.error).toBe("Credenciales inválidas");
    expect(aplicar(conError, { tipo: "reiniciar" }).error).toBeNull();
  });

  it("una respuesta tardía de un intento anterior no modifica la instancia reiniciada ni un intento nuevo", () => {
    const reiniciado = aplicar(ESTADO_INICIAL_LOGIN, { tipo: "enviar" }, { tipo: "reiniciar" });
    expect(aplicar(reiniciado, { tipo: "fallo", intento: 1, mensaje: "tarde" })).toBe(reiniciado);
    const nuevo = aplicar(reiniciado, { tipo: "enviar" });
    expect(aplicar(nuevo, { tipo: "fallo", intento: 1, mensaje: "tarde" })).toBe(nuevo);
    expect(aplicar(nuevo, { tipo: "fallo", intento: nuevo.intento, mensaje: "vigente" }).error).toBe("vigente");
    expect(fuente).toContain("signal: controlador.signal");
    expect(fuente.match(/enCurso\.current !== controlador/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("el ojo de contraseña sigue funcionando", () => {
    expect(botonOjo).toContain('aria-label="Mostrar contraseña"');
    expect(visibilidadContrasena(true, "Contraseña").type).toBe("text");
    expect(visibilidadContrasena(false, "Contraseña").type).toBe("password");
  });

  it("no recarga la página, no toca cookies desde JavaScript ni usa claves aleatorias", () => {
    expect(fuente).not.toMatch(/location\.(reload|href)|document\.cookie|Math\.random|randomUUID|Date\.now/);
  });

  it("el cierre de sesión conserva su reinicio de «cerrando» al ocultarse", () => {
    const hook = sinComentarios(leer("components", "auth", "boton-cerrar-sesion.tsx"));
    expect(hook).toMatch(/useLayoutEffect\(\(\) => \(\) => setCerrando\(false\), \[\]\)/);
  });

  it("cacheComponents sigue activado", () => {
    expect(readFileSync(join(process.cwd(), "next.config.ts"), "utf8")).toMatch(/cacheComponents: true/);
  });
});
