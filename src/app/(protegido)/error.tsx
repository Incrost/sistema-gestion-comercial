"use client";

/**
 * Error inesperado en una página protegida: muestra el estado de error común
 * dentro de la estructura general (el panel lateral sigue disponible) y
 * permite reintentar. El detalle técnico nunca se muestra (sección 10.4).
 */
import { PageContainer } from "@/components/layout/page-container";
import { ErrorState } from "@/components/estados/error-state";

export default function ErrorProtegido({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer>
      <ErrorState
        titulo="No se pudo mostrar la página"
        mensaje="Ocurrió un error inesperado al cargar los datos. Intente nuevamente."
        onReintentar={retry}
        volver={{ href: "/", texto: "Ir al inicio" }}
      />
    </PageContainer>
  );
}
