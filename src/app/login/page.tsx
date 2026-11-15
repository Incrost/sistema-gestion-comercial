/**
 * Inicio de sesión (`/login`): la única página pública (RF-U1, RF-U2).
 *
 * Queda fuera del layout protegido (sin panel lateral ni barra superior). Si
 * el usuario ya tiene una sesión válida (comprobada contra la base), se lo
 * envía al inicio. Si la cookie existe pero no es válida, se muestra el
 * formulario: así nunca hay ciclo de redirecciones.
 */
import { ChartColumnIcon, PackageIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoadingState } from "@/components/estados/loading-state";
import { Fila, Pila, Texto, Titulo } from "@/components/layout/primitivas";
import { Marca } from "@/components/navegacion/marca";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APLICACION } from "@/config/aplicacion";
import { destinoSeguro } from "@/lib/destino-seguro";
import { obtenerUsuarioDePagina } from "@/lib/sesion-pagina";

import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Iniciar sesión" };

const FUNCIONES = [
  { icono: ReceiptTextIcon, texto: "Ventas y facturación con comprobante imprimible" },
  { icono: PackageIcon, texto: "Catálogo y existencias con alertas de reposición" },
  { icono: WalletIcon, texto: "Cuenta corriente, pagos y recibos de clientes" },
  { icono: ChartColumnIcon, texto: "Tablero con indicadores del día y del mes" },
];

export default function PaginaLogin({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Pila as="section" aria-label={APLICACION.nombre} gap="none" className="hidden justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Marca enlace={false} />
        <Pila gap="lg" className="max-w-md">
          <Pila gap="sm">
            <Titulo nivel={1} className="text-3xl text-sidebar-foreground sm:text-3xl">
              {APLICACION.nombre}
            </Titulo>
            <Texto tamanio="base" className="text-sidebar-muted">
              {APLICACION.descripcion}
            </Texto>
          </Pila>
          <Pila as="ul" gap="sm">
            {FUNCIONES.map(({ icono: Icono, texto }) => (
              <Texto as="li" key={texto} className="flex items-center gap-3 text-sidebar-muted">
                <Icono aria-hidden className="size-4 shrink-0 text-sidebar-primary" />
                {texto}
              </Texto>
            ))}
          </Pila>
        </Pila>
        <Texto tamanio="xs" className="text-sidebar-muted">
          Acceso exclusivo para personal autorizado.
        </Texto>
      </Pila>

      <Fila as="section" justificar="center" className="px-4 py-10 sm:px-8">
        <Pila gap="lg" className="w-full max-w-sm">
          <Pila gap="xs" className="lg:hidden">
            <Marca enlace={false} className="[&>span:last-child]:text-base" />
            <Texto tono="suave">{APLICACION.descripcion}</Texto>
          </Pila>
          <Card className="shadow-suave">
            <CardHeader>
              <CardTitle className="text-lg">Iniciar sesión</CardTitle>
              <CardDescription>Ingrese con su correo electrónico y su contraseña.</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<LoadingState variante="formulario" texto="Cargando…" />}>
                <Contenido searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </Pila>
      </Fila>
    </main>
  );
}

async function Contenido({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { desde } = await searchParams;
  const destino = destinoSeguro(typeof desde === "string" ? desde : undefined);

  if (await obtenerUsuarioDePagina()) redirect(destino);

  return <FormularioLogin destino={destino} />;
}
