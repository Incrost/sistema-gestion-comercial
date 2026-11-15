/**
 * Estructura del panel lateral (sección 4 de la consigna) como DATOS, para que
 * el panel de escritorio y el menú móvil muestren exactamente lo mismo y para
 * poder probar la lógica sin navegador.
 *
 * Ocultar «Usuarios» al vendedor es solo una ayuda visual: el permiso lo
 * decide siempre el servicio (sección 10.5).
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */
import type { Rol } from "@/db/schema"; // solo el tipo

export type IconoNavegacion = "inicio" | "ventas" | "productos" | "clientes" | "usuarios";

export type EnlaceNavegacion = { href: string; texto: string };

export type SeccionNavegacion = {
  texto: string;
  icono: IconoNavegacion;
  /** Sección sin subpáginas: el enlace es la propia sección. */
  href?: string;
  enlaces?: readonly EnlaceNavegacion[];
  /** Si se indica, solo la ven esos roles. */
  roles?: readonly Rol[];
};

export const NAVEGACION: readonly SeccionNavegacion[] = [
  { texto: "Inicio", icono: "inicio", href: "/" },
  {
    texto: "Ventas",
    icono: "ventas",
    enlaces: [
      { href: "/ventas/nueva", texto: "Nueva venta" },
      { href: "/ventas", texto: "Facturas" },
    ],
  },
  {
    texto: "Productos",
    icono: "productos",
    enlaces: [
      { href: "/productos", texto: "Catálogo" },
      { href: "/productos/categorias", texto: "Categorías" },
    ],
  },
  {
    texto: "Clientes",
    icono: "clientes",
    enlaces: [
      { href: "/clientes", texto: "Clientes" },
      { href: "/clientes/saldos", texto: "Saldos" },
    ],
  },
  { texto: "Usuarios", icono: "usuarios", href: "/usuarios", roles: ["admin"] },
];

export const NOMBRES_ROL: Record<Rol, string> = { admin: "Administrador", vendedor: "Vendedor" };

/** Secciones que corresponden al rol (RF-U3: Usuarios solo para el administrador). */
export function navegacionPara(rol: Rol): SeccionNavegacion[] {
  return NAVEGACION.filter((s) => !s.roles || s.roles.includes(rol));
}

/** Todos los destinos navegables de una lista de secciones. */
export function hrefsDe(secciones: readonly SeccionNavegacion[]): string[] {
  return secciones.flatMap((s) => (s.href ? [s.href] : (s.enlaces ?? []).map((e) => e.href)));
}

function coincide(ruta: string, href: string): boolean {
  if (href === "/") return ruta === "/";
  return ruta === href || ruta.startsWith(`${href}/`);
}

/**
 * Enlace activo para una ruta: el destino MÁS ESPECÍFICO que la contiene.
 * Así /ventas/nueva activa «Nueva venta» (no «Facturas»), /ventas/15 activa
 * «Facturas», /productos/categorias activa «Categorías» y
 * /clientes/recibos/3 activa «Clientes». Devuelve null si ninguno coincide.
 */
export function enlaceActivo(ruta: string, hrefs: readonly string[]): string | null {
  const limpia = ruta.length > 1 ? ruta.replace(/\/+$/, "") : ruta;
  let mejor: string | null = null;
  for (const href of hrefs) {
    if (coincide(limpia, href) && (mejor === null || href.length > mejor.length)) mejor = href;
  }
  return mejor;
}

/** Indica si la sección contiene el enlace activo (para resaltar el módulo). */
export function seccionActiva(seccion: SeccionNavegacion, activo: string | null): boolean {
  if (activo === null) return false;
  return seccion.href === activo || (seccion.enlaces ?? []).some((e) => e.href === activo);
}

// ---------------------------------------------------------------------------
// Menú móvil: qué hacer con cada evento (lo usa <MobileSidebar>).
// ---------------------------------------------------------------------------

export type EventoMenu = "abrir" | "cerrar" | "escape" | "fuera" | "navegar" | "pantalla-ancha";

/**
 * Estado del menú móvil después de un evento. Se cierra al pulsar Escape, al
 * tocar fuera, al elegir una ruta o al pasar a una pantalla ancha (donde el
 * panel lateral ya está visible).
 */
export function siguienteEstadoMenu(abierto: boolean, evento: EventoMenu): boolean {
  if (evento === "abrir") return true;
  return evento === "cerrar" || evento === "escape" || evento === "fuera" || evento === "navegar" || evento === "pantalla-ancha"
    ? false
    : abierto;
}
