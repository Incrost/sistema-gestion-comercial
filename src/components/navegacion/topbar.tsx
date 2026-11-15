/**
 * Barra superior (sección 4): botón del menú móvil, nombre del sistema en
 * pantallas chicas y el usuario conectado con su rol y el cierre de sesión.
 * Se oculta al imprimir.
 */
import type { Rol } from "@/db/schema";

import { Marca } from "./marca";
import { MenuUsuario } from "./menu-usuario";
import { MobileSidebar } from "./mobile-sidebar";

type Props = { usuario: { nombre: string; email: string; rol: Rol } };

export function Topbar({ usuario }: Props) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur supports-backdrop-filter:bg-card/80 sm:px-4 lg:px-8 print:hidden">
      <MobileSidebar rol={usuario.rol} />
      <Marca className="lg:hidden [&>span:last-child]:hidden min-[420px]:[&>span:last-child]:inline" />
      <div className="ml-auto flex min-w-0 items-center">
        <MenuUsuario nombre={usuario.nombre} email={usuario.email} rol={usuario.rol} />
      </div>
    </header>
  );
}
