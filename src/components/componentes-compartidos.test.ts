/**
 * Pruebas de los componentes compartidos del rediseño. Se renderizan con
 * react-dom/server (HTML inicial), igual que las demás pruebas de interfaz:
 * se verifica estructura, accesibilidad, estados e impresión sin agregar
 * bibliotecas de pruebas de componentes. El router de Next.js se reemplaza
 * por uno falso.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navegacion = vi.hoisted(() => ({ ruta: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacion.ruta,
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }),
}));

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable } from "./datos/data-table";
import { MetricCard } from "./datos/metric-card";
import { Pagination } from "./datos/pagination";
import { StatusBadge } from "./datos/status-badge";
import { EmptyState } from "./estados/empty-state";
import { ErrorState } from "./estados/error-state";
import { LoadingState } from "./estados/loading-state";
import { ErrorCampo, FormField, propsCampo } from "./formularios/form-field";
import { MoneyField } from "./formularios/money-field";
import { BotonImprimir } from "./impresion/boton-imprimir";
import { PageContainer } from "./layout/page-container";
import { PageHeader } from "./layout/page-header";
import { AppSidebar } from "./navegacion/app-sidebar";
import { ListaNavegacion } from "./navegacion/lista-navegacion";
import { iniciales } from "./navegacion/menu-usuario";
import { MobileSidebar } from "./navegacion/mobile-sidebar";
import { Topbar } from "./navegacion/topbar";
import { Toaster } from "./ui/sonner";

const html = (elemento: ReactElement) => renderToStaticMarkup(elemento);

beforeEach(() => {
  navegacion.ruta = "/";
});

describe("navegación lateral", () => {
  it("el administrador ve Usuarios; el vendedor no", () => {
    expect(html(createElement(ListaNavegacion, { rol: "admin" }))).toContain('href="/usuarios"');
    const vendedor = html(createElement(ListaNavegacion, { rol: "vendedor" }));
    expect(vendedor).not.toContain('href="/usuarios"');
    for (const href of ["/", "/ventas/nueva", "/ventas", "/productos", "/productos/categorias", "/clientes", "/clientes/saldos"]) {
      expect(vendedor).toContain(`href="${href}"`);
    }
  });

  it("marca la página activa con aria-current (no solo con color)", () => {
    navegacion.ruta = "/ventas/nueva";
    const h = html(createElement(ListaNavegacion, { rol: "vendedor" }));
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toMatch(/href="\/ventas\/nueva"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/ventas\/nueva"/);
  });

  it("una factura activa «Facturas» y no «Nueva venta»", () => {
    navegacion.ruta = "/ventas/27";
    const h = html(createElement(ListaNavegacion, { rol: "admin" }));
    expect(h).toMatch(/<a[^>]*href="\/ventas"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/ventas"/);
    expect(h).not.toMatch(/href="\/ventas\/nueva"[^>]*aria-current/);
  });

  it("es una región de navegación con nombre accesible", () => {
    expect(html(createElement(ListaNavegacion, { rol: "admin" }))).toContain('<nav aria-label="Navegación principal"');
  });

  it("el panel fijo se muestra desde 1024 px y se oculta al imprimir", () => {
    const h = html(createElement(AppSidebar, { rol: "admin" }));
    expect(h).toContain("lg:flex");
    expect(h).toContain("hidden");
    expect(h).toContain("print:hidden");
  });
});

describe("barra superior y menú móvil", () => {
  const usuario = { nombre: "Ana María Pérez", email: "ana@comercio.test", rol: "vendedor" as const };

  it("muestra el usuario conectado y su rol, y se oculta al imprimir", () => {
    const h = html(createElement(Topbar, { usuario }));
    expect(h).toContain("Ana María Pérez");
    expect(h).toContain("Vendedor");
    expect(h).toContain("print:hidden");
    expect(h).toContain("Abrir menú de la cuenta");
  });

  it("el botón del menú móvil tiene nombre accesible, controla un diálogo y solo aparece en pantallas chicas", () => {
    const h = html(createElement(MobileSidebar, { rol: "admin" }));
    expect(h).toContain('aria-label="Abrir menú de navegación"');
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain("lg:hidden");
  });

  it("el nombre largo se recorta en lugar de desbordar la barra", () => {
    const h = html(createElement(Topbar, { usuario: { ...usuario, nombre: "Nombre extremadamente largo para una pantalla de 360 px" } }));
    expect(h).toContain("truncate");
    expect(h).toContain("min-w-0");
  });

  it("iniciales del avatar", () => {
    expect(iniciales("Ana María Pérez")).toBe("AP");
    expect(iniciales("vendedor")).toBe("V");
    expect(iniciales("  ")).toBe("?");
  });
});

describe("notificaciones", () => {
  it("el contenedor tiene X para cerrar, etiquetas en español y región con nombre", () => {
    const elemento = Toaster({}) as ReactElement<{ containerAriaLabel: string; toastOptions: { closeButtonAriaLabel: string } }>;
    expect(elemento.props.containerAriaLabel).toBe("Notificaciones");
    expect(elemento.props.toastOptions.closeButtonAriaLabel).toBe("Cerrar notificación");
  });
});

describe("campos de formulario", () => {
  it("la etiqueta queda vinculada al control y el error queda junto al campo", () => {
    const h = html(
      // FormField exige `children` en sus props: createElement con hijos como
      // tercer argumento no lo satisface en React 19 y la regla
      // react/no-children-prop impide pasarlo en las props de createElement.
      // FormField no usa hooks, así que se invoca directamente (como Toaster).
      FormField({
        id: "nombre",
        etiqueta: "Nombre",
        error: "Es obligatorio.",
        children: createElement("input", propsCampo("nombre", "Es obligatorio.")),
      }),
    );
    expect(h).toContain('for="nombre"');
    expect(h).toContain('id="nombre"');
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('aria-describedby="nombre-error"');
    expect(h).toContain('id="nombre-error"');
    expect(h).toContain("Es obligatorio.");
    // El error está dentro del mismo bloque del campo (no en una notificación).
    expect(h.indexOf('id="nombre"')).toBeLessThan(h.indexOf('id="nombre-error"'));
  });

  it("sin error no marca el campo como inválido", () => {
    expect(propsCampo("x")).toEqual({ id: "x", "aria-invalid": undefined, "aria-describedby": undefined });
    expect(propsCampo("x", undefined, true)["aria-describedby"]).toBe("x-ayuda");
  });

  it("el campo de importe muestra el símbolo y usa teclado decimal", () => {
    const h = html(createElement(MoneyField, { id: "importe", etiqueta: "Importe", valor: "1500", onCambiar: () => {}, error: "No puede superar la deuda." }));
    expect(h).toContain("$");
    expect(h).toContain('inputMode="decimal"');
    expect(h).toContain("No puede superar la deuda.");
    expect(h).toContain('aria-describedby="importe-error"');
  });

  it("ErrorCampo se anuncia como alerta", () => {
    expect(html(createElement(ErrorCampo, null, "Dato inválido."))).toContain('role="alert"');
  });
});

describe("estados de los listados", () => {
  it("carga: anuncia el estado y marca la zona como ocupada", () => {
    const h = html(createElement(LoadingState, { texto: "Cargando facturas…" }));
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain("Cargando facturas…");
  });

  it("vacío: título, descripción y acción", () => {
    const h = html(createElement(EmptyState, { titulo: "No hay facturas.", descripcion: "Pruebe otros filtros.", accion: createElement("a", { href: "/ventas" }, "Limpiar") }));
    expect(h).toContain("No hay facturas.");
    expect(h).toContain("Pruebe otros filtros.");
    expect(h).toContain('href="/ventas"');
  });

  it("error: alerta con mensaje y botón Reintentar", () => {
    const h = html(createElement(ErrorState, { titulo: "No se pudieron cargar", mensaje: "Intente nuevamente." }));
    expect(h).toContain('role="alert"');
    expect(h).toContain("Reintentar");
  });

  it("resultados: la tabla de datos usa el estado vacío cuando no hay filas", () => {
    const columnas = [{ id: "n", encabezado: "Nombre", celda: (f: { n: string }) => f.n, principal: true }];
    const vacio = html(createElement(DataTable<{ n: string }>, { etiqueta: "Lista", columnas, filas: [], clave: (f) => f.n, vacio: createElement(EmptyState, { titulo: "Sin datos." }) }));
    expect(vacio).toContain("Sin datos.");
    expect(vacio).not.toContain("<table");
    const conDatos = html(createElement(DataTable<{ n: string }>, { etiqueta: "Lista", columnas, filas: [{ n: "Ana" }], clave: (f) => f.n }));
    expect(conDatos).toContain("<table");
    expect(conDatos).toContain("Ana");
  });
});

describe("tablas y desbordamiento", () => {
  type Fila = { id: number; nombre: string; total: string };
  const columnas = [
    { id: "nombre", encabezado: "Nombre", celda: (f: Fila) => f.nombre, principal: true },
    { id: "total", encabezado: "Total", celda: (f: Fila) => f.total, alinear: "derecha" as const },
  ];
  const filas: Fila[] = [{ id: 1, nombre: "Ana", total: "$ 10,00" }];

  it("en móvil se transforma en tarjetas y desde 768 px es una tabla con desplazamiento contenido", () => {
    const h = html(createElement(DataTable<Fila>, { etiqueta: "Clientes", columnas, filas, clave: (f) => f.id }));
    expect(h).toContain("md:hidden"); // tarjetas
    expect(h).toContain("hidden md:block"); // tabla
    expect(h).toContain("overflow-x-auto"); // el desplazamiento queda dentro de la tabla
    expect(h).toContain("min-w-0");
    expect(h).toContain('aria-label="Clientes"');
  });

  it("modo desplazamiento: solo la tabla, con su contenedor desplazable", () => {
    const h = html(createElement(DataTable<Fila>, { etiqueta: "Detalle", columnas, filas, clave: (f) => f.id, movil: "desplazamiento" }));
    expect(h).not.toContain("md:hidden");
    expect(h).toContain("overflow-x-auto");
  });

  it("el contenedor de página no permite que el contenido lo ensanche", () => {
    expect(html(createElement(PageContainer, null, "x"))).toContain("min-w-0");
  });
});

describe("impresión", () => {
  it("botones, acciones del encabezado, paginación y filtros se ocultan al imprimir", () => {
    expect(html(createElement(BotonImprimir, { texto: "Imprimir comprobante" }))).toContain("print:hidden");
    const encabezado = html(createElement(PageHeader, { titulo: "Factura", acciones: createElement("button", null, "Anular") }));
    expect(encabezado).toMatch(/print:hidden[^>]*><button>Anular/);
    expect(html(createElement(Pagination, { pagina: 1, totalPaginas: 3, total: 50, unidad: ["factura", "facturas"] as const, enlace: (n: number) => `/ventas?page=${n}` }))).toContain(
      "print:hidden",
    );
  });

  it("en la tabla adaptable, al imprimir se usa la tabla y no las tarjetas", () => {
    const h = html(
      createElement(DataTable<{ id: number }>, { etiqueta: "X", columnas: [{ id: "id", encabezado: "Id", celda: (f: { id: number }) => f.id }], filas: [{ id: 1 }], clave: (f) => f.id }),
    );
    expect(h).toContain("print:block");
    expect(h).toContain("print:hidden");
  });
});

describe("acciones destructivas", () => {
  it("el disparador abre un diálogo de confirmación en lugar de ejecutar la acción", () => {
    let ejecutada = false;
    const h = html(
      createElement(ConfirmDialog, {
        titulo: "¿Desactivar?",
        descripcion: "Perderá el acceso.",
        textoConfirmar: "Desactivar",
        alConfirmar: () => {
          ejecutada = true;
        },
        disparador: createElement("button", { type: "button" }, "Desactivar"),
      }),
    );
    expect(h).toContain('aria-haspopup="dialog"');
    expect(h).toContain('aria-expanded="false"');
    expect(ejecutada).toBe(false);
  });
});

describe("insignias e indicadores", () => {
  it("cada estado combina ícono y texto", () => {
    for (const [estado, texto] of [
      ["anulada", "Anulada"],
      ["emitida", "Emitida"],
      ["bajo-minimo", "Bajo mínimo"],
      ["admin", "Administrador"],
      ["inactivo", "Inactivo"],
    ] as const) {
      const h = html(createElement(StatusBadge, { estado }));
      expect(h).toContain(texto);
      expect(h).toContain("<svg");
    }
  });

  it("la tarjeta de indicador muestra título, valor y detalle", () => {
    const h = html(createElement(MetricCard, { titulo: "Ventas de hoy", valor: "$ 1.000,00" }, "3 facturas"));
    expect(h).toContain("Ventas de hoy");
    expect(h).toContain("$ 1.000,00");
    expect(h).toContain("3 facturas");
  });
});
