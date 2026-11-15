/**
 * Campo de búsqueda con ícono. Se usa en los filtros de los listados (dentro
 * de FilterBar, con `name="q"`) y en búsquedas en vivo.
 */
import { SearchIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" autoComplete="off" className="pl-9" {...props} />
    </div>
  );
}
