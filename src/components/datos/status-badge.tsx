/**
 * Insignias de estado del dominio. Cada estado combina color, ícono y texto,
 * de modo que la información no depende solo del color.
 */
import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Variante = "default" | "secondary" | "success" | "warning" | "destructive" | "muted" | "outline";

export const ESTADOS = {
  emitida: { texto: "Emitida", variante: "success", icono: CircleCheckIcon },
  anulada: { texto: "Anulada", variante: "destructive", icono: BanIcon },
  activo: { texto: "Activo", variante: "success", icono: CircleCheckIcon },
  inactivo: { texto: "Inactivo", variante: "muted", icono: CircleSlashIcon },
  activa: { texto: "Activa", variante: "success", icono: CircleCheckIcon },
  inactiva: { texto: "Inactiva", variante: "muted", icono: CircleSlashIcon },
  "bajo-minimo": { texto: "Bajo mínimo", variante: "warning", icono: TriangleAlertIcon },
  admin: { texto: "Administrador", variante: "default", icono: ShieldCheckIcon },
  vendedor: { texto: "Vendedor", variante: "secondary", icono: UserIcon },
  "cuenta-corriente": { texto: "Cuenta corriente", variante: "outline", icono: WalletIcon },
  "sin-cuenta": { texto: "Sin cuenta corriente", variante: "muted", icono: CircleDashedIcon },
  "con-deuda": { texto: "Con deuda", variante: "warning", icono: TriangleAlertIcon },
} as const satisfies Record<string, { texto: string; variante: Variante; icono: LucideIcon }>;

export type Estado = keyof typeof ESTADOS;

export function StatusBadge({ estado, texto, className }: { estado: Estado; texto?: string; className?: string }) {
  const { texto: predeterminado, variante, icono: Icono } = ESTADOS[estado];
  return (
    <Badge variant={variante} className={cn("print:border print:border-current", className)}>
      <Icono aria-hidden data-icon="inline-start" />
      {texto ?? predeterminado}
    </Badge>
  );
}
