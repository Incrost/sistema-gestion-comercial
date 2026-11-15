/**
 * Panel lateral fijo de escritorio (sección 4), visible desde 1024 px. En
 * pantallas más chicas lo reemplaza el menú móvil (mobile-sidebar.tsx). Se
 * oculta al imprimir.
 */
import type { Rol } from "@/db/schema";

import { ListaNavegacion } from "./lista-navegacion";
import { Marca } from "./marca";

export function AppSidebar({ rol }: { rol: Rol }) {
  return (
    <aside
      aria-label="Panel lateral"
      className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex print:hidden"
    >
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-5">
        <Marca />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <ListaNavegacion rol={rol} />
      </div>
    </aside>
  );
}
