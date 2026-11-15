/**
 * Primitivas de maquetación propias (sección 10.6): apilar, alinear, grilla,
 * texto y título. Las páginas se arman con estas piezas, los componentes de
 * shadcn/ui y los del dominio, sin etiquetas HTML sueltas ni estilos repetidos.
 *
 * Los espaciados y tamaños son un conjunto cerrado de valores: así todas las
 * pantallas comparten el mismo ritmo visual.
 */
import { cn } from "@/lib/utils";
import type { ComponentProps, ElementType, ReactNode } from "react";

type Espacio = "none" | "xs" | "sm" | "md" | "lg" | "xl";

const ESPACIO: Record<Espacio, string> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
};

type ConComo = { as?: ElementType; className?: string; children?: ReactNode } & Omit<ComponentProps<"div">, "className" | "children">;

/** Apila elementos en columna. */
export function Pila({ as: Elemento = "div", gap = "md", className, ...props }: ConComo & { gap?: Espacio }) {
  return <Elemento className={cn("flex min-w-0 flex-col", ESPACIO[gap], className)} {...props} />;
}

const ALINEAR = { start: "items-start", center: "items-center", end: "items-end", baseline: "items-baseline", stretch: "items-stretch" };
const JUSTIFICAR = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" };

/** Alinea elementos en fila; por defecto pasan a la línea siguiente si no entran. */
export function Fila({
  as: Elemento = "div",
  gap = "sm",
  alinear = "center",
  justificar = "start",
  envolver = true,
  className,
  ...props
}: ConComo & { gap?: Espacio; alinear?: keyof typeof ALINEAR; justificar?: keyof typeof JUSTIFICAR; envolver?: boolean }) {
  return (
    <Elemento
      className={cn("flex min-w-0", envolver && "flex-wrap", ESPACIO[gap], ALINEAR[alinear], JUSTIFICAR[justificar], className)}
      {...props}
    />
  );
}

const COLUMNAS = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-1 md:grid-cols-3",
  /** Indicadores: 1 columna en teléfonos chicos, 2 en tabletas y 4 en escritorio. */
  "4": "grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-4",
  /** Contenido principal + columna lateral (2/3 + 1/3) desde 1024 px. */
  principal: "grid-cols-1 lg:grid-cols-3",
  /** Campos de formulario: 1, 2 o 3 columnas según el ancho. */
  campos: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
} as const;

/** Grilla adaptable con columnas predefinidas. */
export function Grilla({ as: Elemento = "div", columnas = "2", gap = "md", className, ...props }: ConComo & { columnas?: keyof typeof COLUMNAS; gap?: Espacio }) {
  return <Elemento className={cn("grid min-w-0", COLUMNAS[columnas], ESPACIO[gap], className)} {...props} />;
}

const TONO = {
  normal: "text-foreground",
  suave: "text-muted-foreground",
  destructivo: "text-destructive",
  exito: "text-success-strong",
  advertencia: "text-warning-strong",
  primario: "text-primary",
};
const TAMANIO = { xs: "text-xs", sm: "text-sm", base: "text-base", lg: "text-lg" };
const PESO = { normal: "font-normal", medio: "font-medium", fuerte: "font-semibold" };

/** Texto con tono, tamaño y peso del sistema. */
export function Texto({
  as: Elemento = "p",
  tono = "normal",
  tamanio = "sm",
  peso = "normal",
  numerico = false,
  className,
  ...props
}: ConComo & { tono?: keyof typeof TONO; tamanio?: keyof typeof TAMANIO; peso?: keyof typeof PESO; numerico?: boolean }) {
  return <Elemento className={cn(TAMANIO[tamanio], TONO[tono], PESO[peso], numerico && "tabular-nums", className)} {...props} />;
}

const NIVEL = {
  1: "text-xl font-semibold tracking-tight sm:text-2xl",
  2: "text-base font-semibold",
  3: "text-sm font-semibold",
};

/** Título de página (1), de sección (2) o de bloque (3). */
export function Titulo({ nivel = 2, className, ...props }: { nivel?: 1 | 2 | 3; className?: string; children?: ReactNode; id?: string }) {
  const Elemento = `h${nivel}` as const;
  return <Elemento className={cn("text-foreground", NIVEL[nivel], className)} {...props} />;
}
