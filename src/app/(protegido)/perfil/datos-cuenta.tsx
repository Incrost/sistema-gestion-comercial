/**
 * Datos de la cuenta del usuario conectado, solo lectura.
 *
 * El estado se muestra «Activo» porque la página solo se sirve con una sesión
 * válida, y una sesión solo es válida si el usuario está activo (se comprueba
 * contra la base en cada pedido): un usuario desactivado no llega a verla.
 */
import { InfoIcon } from "lucide-react";

import { StatusBadge } from "@/components/datos/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Rol } from "@/db/schema";

type Props = { usuario: { nombre: string; email: string; rol: Rol } };

export function DatosCuenta({ usuario }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Datos de la cuenta</h2>
        </CardTitle>
        <CardDescription>Información del usuario con el que inició sesión.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <Dato termino="Nombre">
            <span className="break-words">{usuario.nombre}</span>
          </Dato>
          <Dato termino="Email">
            <span className="break-all">{usuario.email}</span>
          </Dato>
          <Dato termino="Rol">
            <StatusBadge estado={usuario.rol} />
          </Dato>
          <Dato termino="Estado">
            <StatusBadge estado="activo" />
          </Dato>
        </dl>
        <p className="flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            El nombre, el email, el rol y el estado de la cuenta los administra un administrador. Si necesita modificarlos,
            comuníquese con un administrador del sistema.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

function Dato({ termino, children }: { termino: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{termino}</dt>
      <dd className="min-w-0 text-sm font-medium">{children}</dd>
    </div>
  );
}
