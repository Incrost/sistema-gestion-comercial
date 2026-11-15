"use client";

/**
 * Lista de navegación que comparten el panel lateral de escritorio y el menú
 * móvil. Resalta el módulo y la página activos con fondo, peso de letra, una
 * marca lateral y aria-current="page" (no depende solo del color).
 *
 * La estructura sale de src/lib/navegacion.ts; ocultar «Usuarios» al vendedor
 * es una ayuda visual, el permiso lo verifica el servidor.
 */
import { HouseIcon, PackageIcon, ReceiptTextIcon, ShieldUserIcon, UsersIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Rol } from "@/db/schema";
import { enlaceActivo, hrefsDe, navegacionPara, seccionActiva, type IconoNavegacion } from "@/lib/navegacion";
import { cn } from "@/lib/utils";

const ICONOS: Record<IconoNavegacion, LucideIcon> = {
  inicio: HouseIcon,
  ventas: ReceiptTextIcon,
  productos: PackageIcon,
  clientes: UsersIcon,
  usuarios: ShieldUserIcon,
};

const ENLACE =
  "relative flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-ring";
const ENLACE_ACTIVO =
  "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary";

export function ListaNavegacion({ rol, onNavegar }: { rol: Rol; onNavegar?: () => void }) {
  const ruta = usePathname();
  const secciones = navegacionPara(rol);
  const activo = enlaceActivo(ruta, hrefsDe(secciones));

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {secciones.map((seccion) => {
          const Icono = ICONOS[seccion.icono];
          const moduloActivo = seccionActiva(seccion, activo);
          if (seccion.href) {
            const esActivo = activo === seccion.href;
            return (
              <li key={seccion.texto}>
                <Link
                  href={seccion.href}
                  onClick={onNavegar}
                  aria-current={esActivo ? "page" : undefined}
                  className={cn(ENLACE, esActivo && ENLACE_ACTIVO)}
                >
                  <Icono aria-hidden className="size-4 shrink-0" />
                  {seccion.texto}
                </Link>
              </li>
            );
          }
          return (
            <li key={seccion.texto} className="mt-3 flex flex-col gap-1">
              <span
                className={cn(
                  "flex items-center gap-3 px-3 text-xs font-semibold tracking-wider uppercase",
                  moduloActivo ? "text-sidebar-primary" : "text-sidebar-muted/80",
                )}
              >
                <Icono aria-hidden className="size-4 shrink-0" />
                {seccion.texto}
              </span>
              <ul className="flex flex-col gap-0.5">
                {(seccion.enlaces ?? []).map((enlace) => {
                  const esActivo = activo === enlace.href;
                  return (
                    <li key={enlace.href}>
                      <Link
                        href={enlace.href}
                        onClick={onNavegar}
                        aria-current={esActivo ? "page" : undefined}
                        className={cn(ENLACE, "pl-10", esActivo && ENLACE_ACTIVO)}
                      >
                        {enlace.texto}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
