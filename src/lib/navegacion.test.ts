/**
 * Pruebas de la navegación (src/lib/navegacion.ts): secciones según el rol,
 * enlace activo y comportamiento del menú móvil.
 */
import { describe, expect, it } from "vitest";

import { enlaceActivo, hrefsDe, NAVEGACION, navegacionPara, seccionActiva, siguienteEstadoMenu } from "./navegacion";

const TODOS = hrefsDe(NAVEGACION);

describe("navegación según el rol", () => {
  it("el administrador ve todos los módulos, incluido Usuarios", () => {
    const secciones = navegacionPara("admin").map((s) => s.texto);
    expect(secciones).toEqual(["Inicio", "Ventas", "Productos", "Clientes", "Usuarios"]);
    expect(hrefsDe(navegacionPara("admin"))).toContain("/usuarios");
  });

  it("el vendedor no ve Usuarios, pero sí el resto de los módulos", () => {
    const secciones = navegacionPara("vendedor").map((s) => s.texto);
    expect(secciones).toEqual(["Inicio", "Ventas", "Productos", "Clientes"]);
    expect(hrefsDe(navegacionPara("vendedor"))).not.toContain("/usuarios");
  });

  it("incluye las subpáginas pedidas en cada módulo", () => {
    expect(TODOS).toEqual([
      "/",
      "/ventas/nueva",
      "/ventas",
      "/productos",
      "/productos/categorias",
      "/clientes",
      "/clientes/saldos",
      "/usuarios",
    ]);
  });
});

describe("ruta activa", () => {
  it.each([
    ["/", "/"],
    ["/ventas/nueva", "/ventas/nueva"],
    ["/ventas", "/ventas"],
    ["/ventas/15", "/ventas"],
    ["/productos", "/productos"],
    ["/productos/9", "/productos"],
    ["/productos/categorias", "/productos/categorias"],
    ["/clientes/3", "/clientes"],
    ["/clientes/3/cuenta", "/clientes"],
    ["/clientes/recibos/8", "/clientes"],
    ["/clientes/saldos", "/clientes/saldos"],
    ["/usuarios", "/usuarios"],
    ["/ventas/", "/ventas"],
  ])("%s activa %s", (ruta, esperado) => {
    expect(enlaceActivo(ruta, TODOS)).toBe(esperado);
  });

  it("Inicio solo se activa en la raíz exacta", () => {
    expect(enlaceActivo("/ventas", ["/"])).toBeNull();
    expect(enlaceActivo("/otra", TODOS)).toBeNull();
  });

  it("no confunde prefijos de texto (/ventasx no es /ventas)", () => {
    expect(enlaceActivo("/ventasx", TODOS)).toBeNull();
  });

  it("el vendedor en /usuarios no tiene enlace activo (no lo ve)", () => {
    expect(enlaceActivo("/usuarios", hrefsDe(navegacionPara("vendedor")))).toBeNull();
  });

  it("resalta el módulo que contiene la página activa", () => {
    const ventas = NAVEGACION.find((s) => s.texto === "Ventas")!;
    const productos = NAVEGACION.find((s) => s.texto === "Productos")!;
    expect(seccionActiva(ventas, "/ventas/nueva")).toBe(true);
    expect(seccionActiva(productos, "/ventas/nueva")).toBe(false);
    expect(seccionActiva(ventas, null)).toBe(false);
  });
});

describe("menú móvil", () => {
  it("se abre con el botón", () => {
    expect(siguienteEstadoMenu(false, "abrir")).toBe(true);
  });

  it.each(["escape", "fuera", "navegar", "cerrar", "pantalla-ancha"] as const)("se cierra con «%s»", (evento) => {
    expect(siguienteEstadoMenu(true, evento)).toBe(false);
  });

  it("cerrado sigue cerrado ante Escape", () => {
    expect(siguienteEstadoMenu(false, "escape")).toBe(false);
  });
});
