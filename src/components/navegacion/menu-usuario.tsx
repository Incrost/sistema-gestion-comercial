"use client";

/**
 * Usuario conectado en la barra superior: nombre y rol siempre visibles y un
 * menú desplegable con «Cerrar sesión» (ocupa poco lugar, también en 360 px).
 */
import { ChevronDownIcon, LogOutIcon } from "lucide-react";

import { useCerrarSesion } from "@/components/auth/boton-cerrar-sesion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Rol } from "@/db/schema";
import { NOMBRES_ROL } from "@/lib/navegacion";

/** Iniciales para el avatar: «Ana María Pérez» → «AP». */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primera = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primera + ultima).toUpperCase();
}

type Props = { nombre: string; email: string; rol: Rol };

export function MenuUsuario({ nombre, email, rol }: Props) {
  const { cerrando, cerrarSesion } = useCerrarSesion();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto min-w-0 gap-2 px-2 py-1.5" aria-label={`Usuario: ${nombre}, ${NOMBRES_ROL[rol]}. Abrir menú de la cuenta`}>
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {iniciales(nombre)}
          </span>
          <span className="flex min-w-0 flex-col items-start text-left leading-tight">
            <span className="max-w-[8.5rem] truncate text-sm font-medium sm:max-w-[14rem]">{nombre}</span>
            <span className="text-xs text-muted-foreground">{NOMBRES_ROL[rol]}</span>
          </span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{nombre}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
          <span className="text-xs font-normal text-muted-foreground">Rol: {NOMBRES_ROL[rol]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={cerrando} onSelect={() => void cerrarSesion()}>
          <LogOutIcon aria-hidden />
          {cerrando ? "Cerrando sesión…" : "Cerrar sesión"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
