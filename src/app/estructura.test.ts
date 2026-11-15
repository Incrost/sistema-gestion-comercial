/**
 * Pruebas de estructura del rediseño: login fuera del layout protegido,
 * notificaciones en el layout raíz, contenido sin desbordamiento, atajos de
 * Nueva venta y confirmación de la anulación.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/ventas/nueva",
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }),
}));
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "fuente-geist" }),
  Geist_Mono: () => ({ variable: "fuente-geist-mono" }),
}));

import { Toaster } from "@/components/ui/sonner";

import RootLayout from "./layout";
import { AccionAnular } from "./(protegido)/ventas/accion-anular";
import { NuevaVenta } from "./(protegido)/ventas/nueva/nueva-venta";

const APP = join(process.cwd(), "src", "app");
const leer = (...partes: string[]) => readFileSync(join(APP, ...partes), "utf8");

/** Recorre un árbol de elementos de React (sin renderizarlo). */
function buscar(nodo: ReactNode, condicion: (e: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(nodo)) {
    for (const n of nodo) {
      const r = buscar(n, condicion);
      if (r) return r;
    }
    return null;
  }
  if (!isValidElement(nodo)) return null;
  if (condicion(nodo)) return nodo;
  return buscar((nodo.props as { children?: ReactNode }).children, condicion);
}

describe("login", () => {
  it("no está dentro del grupo protegido ni usa el panel lateral o la barra superior", () => {
    const pagina = leer("login", "page.tsx");
    expect(pagina).not.toMatch(/AppSidebar|Topbar|MobileSidebar|\(protegido\)/);
    expect(() => leer("(protegido)", "login", "page.tsx")).toThrow();
  });

  it("el layout protegido es el único que monta panel lateral y barra superior", () => {
    const protegido = leer("(protegido)", "layout.tsx");
    expect(protegido).toContain("<AppSidebar");
    expect(protegido).toContain("<Topbar");
    expect(leer("layout.tsx")).not.toMatch(/AppSidebar|Topbar/);
  });
});

describe("layout raíz", () => {
  // Props completas del tipo generado por Next.js 16 para el layout raíz.
  const props: LayoutProps<"/"> = { children: createElement("p", null, "contenido"), params: Promise.resolve({}) };
  const arbol = RootLayout(props);

  it("monta las notificaciones con botón X para cerrarlas", () => {
    const toaster = buscar(arbol, (e) => e.type === Toaster) as ReactElement<{ closeButton?: boolean }> | null;
    expect(toaster).not.toBeNull();
    expect(toaster!.props.closeButton).toBe(true);
  });

  it("declara el idioma español", () => {
    expect((arbol as ReactElement<{ lang: string }>).props.lang).toBe("es");
  });
});

describe("estructura sin desbordamientos", () => {
  it("el contenido principal puede achicarse (min-w-0) y el panel no ocupa ancho en móvil", () => {
    const protegido = leer("(protegido)", "layout.tsx");
    expect(protegido).toMatch(/<main id="contenido"[^>]*min-w-0/);
    expect(protegido).toContain("flex min-w-0 flex-1 flex-col");
  });

  it("los estilos globales respetan prefers-reduced-motion y definen la impresión", () => {
    const css = leer("globals.css");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("@media print");
  });
});

describe("Nueva venta", () => {
  const h = renderToStaticMarkup(createElement(NuevaVenta, { proximoNumero: "0001-00000051" }));

  it("conserva las tres secciones", () => {
    for (const id of ["titulo-comprador", "titulo-items", "titulo-pago"]) expect(h).toContain(`id="${id}"`);
  });

  it("conserva y muestra los atajos F2, F4, F8, F9, Enter y Escape", () => {
    for (const tecla of ["F2", "F4", "F8", "F9", "Enter", "Esc"]) expect(h).toContain(`>${tecla}<`);
    expect(h).toContain('aria-keyshortcuts="F2"');
    expect(h).toContain('aria-keyshortcuts="F4"');
    expect(h).toContain('aria-keyshortcuts="F9"');
    expect(h).toContain("Confirmar venta (F9)");
  });

  it("no muestra avisos persistentes en la página (se usan notificaciones temporales)", () => {
    expect(h).not.toContain("Se agregó");
    expect(h).not.toContain("Venta descartada");
  });

  it("Confirmar y Descartar están diferenciados y Descartar empieza deshabilitado sin datos", () => {
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>.*?Descartar venta/);
    expect(h).toContain('data-variant="default"');
    expect(h).toContain('data-variant="outline"');
  });

  it("el número de factura es informativo", () => {
    expect(h).toContain("0001-00000051");
    expect(h).toContain("el número se asigna al confirmar");
  });
});

describe("anulación de factura", () => {
  it("el botón Anular abre una confirmación con motivo en lugar de anular directamente", () => {
    const h = renderToStaticMarkup(createElement(AccionAnular, { facturaId: 3, numeroFormateado: "0001-00000003" }));
    expect(h).toContain("Anular");
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toContain("print:hidden");
  });

  it("todas las acciones irreversibles usan el diálogo de confirmación común", () => {
    const archivos = [
      ["(protegido)", "ventas", "accion-anular.tsx"],
      ["(protegido)", "ventas", "nueva", "nueva-venta.tsx"],
      ["(protegido)", "productos", "[id]", "acciones-producto.tsx"],
      ["(protegido)", "productos", "categorias", "gestion-categorias.tsx"],
      ["(protegido)", "clientes", "formulario-cliente.tsx"],
      ["(protegido)", "usuarios", "gestion-usuarios.tsx"],
    ];
    for (const partes of archivos) {
      const codigo = leer(...partes);
      expect(codigo, partes.join("/")).toContain("<ConfirmDialog");
      expect(codigo, partes.join("/")).not.toContain("window.confirm");
    }
  });
});
