"use client"

/**
 * Contenedor de notificaciones temporales (sonner), adaptado al sistema:
 * tema claro fijo, botón X en español y región aria-live con nombre propio.
 * Las notificaciones se emiten SIEMPRE con src/lib/avisos.ts.
 */
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      containerAriaLabel="Notificaciones"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-primary" />,
        warning: <TriangleAlertIcon className="size-4 text-warning-strong" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: "Cerrar notificación",
        classNames: {
          toast: "cn-toast",
          error: "aviso-error",
          success: "aviso-exito",
          warning: "aviso-advertencia",
          info: "aviso-info",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
