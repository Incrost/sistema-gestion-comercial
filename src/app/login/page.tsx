/**
 * Inicio de sesión (`/login`): la única página pública (RF-U1, RF-U2).
 *
 * Queda fuera del layout protegido (sin panel lateral ni barra superior). Si
 * el usuario ya tiene una sesión válida (comprobada contra la base), se lo
 * envía al inicio. Si la cookie existe pero no es válida, se muestra el
 * formulario: así nunca hay ciclo de redirecciones.
 *
 * Escritorio (desde 1024 px): dos sectores, presentación a la izquierda y
 * formulario a la derecha. Móvil: marca centrada, tarjeta y nota de acceso,
 * centrados en la altura visible (svh, descontando las barras del navegador)
 * con un poco más de aire abajo que arriba para que el conjunto no quede bajo.
 */
import { ChartColumnIcon, LockKeyholeIcon, PackageIcon, ReceiptTextIcon, StoreIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoadingState } from "@/components/estados/loading-state";
import { Fila, Pila, Texto, Titulo } from "@/components/layout/primitivas";
import { Marca } from "@/components/navegacion/marca";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APLICACION } from "@/config/aplicacion";
import { EQUIPO } from "@/config/equipo";
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

      <Fila as="section" justificar="center" className="relative isolate px-4 pt-6 pb-10 sm:px-8 lg:py-24">
        {/* Fondo suave solo en móvil: un degradado del color de la marca, sin imágenes. */}
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-72 bg-linear-to-b from-primary/12 to-transparent lg:hidden" />
        <Pila gap="lg" className="w-full max-w-sm">
          <Pila gap="sm" className="items-center text-center lg:hidden">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-suave">
              <StoreIcon aria-hidden className="size-6" />
            </span>
            <Titulo nivel={1} className="text-xl sm:text-xl">
              {APLICACION.nombre}
            </Titulo>
            <Texto tono="suave" className="max-w-xs">
              {APLICACION.descripcion}
            </Texto>
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
          <Texto tamanio="xs" tono="suave" className="flex items-center justify-center gap-1.5 lg:hidden">
            <LockKeyholeIcon aria-hidden className="size-3.5 shrink-0" />
            Acceso exclusivo para personal autorizado.
          </Texto>
          {/*
            Datos del grupo (src/config/equipo.ts). En móvil va debajo de la nota
            de acceso, alineado a la derecha. En escritorio (lg) queda en la
            esquina inferior derecha de la sección, que es «relative»; su lg:py-24
            reserva el lugar para que no se superponga con la tarjeta.
          */}
          <Pila as="aside" aria-label="Grupo e integrantes" gap="xs" className="text-right lg:absolute lg:right-8 lg:bottom-6">
            {/* Número de grupo, en seminegrita para que funcione como encabezado. */}
            <Texto tamanio="xs" peso="fuerte">
              Grupo: {EQUIPO.grupo}
            </Texto>
            {/* Un renglón por integrante; key identifica a cada uno ante React. */}
            <Pila as="ul" gap="none">
              {EQUIPO.integrantes.map((integrante) => (
                <Texto as="li" key={integrante} tamanio="xs" tono="suave">
                  {integrante}
                </Texto>
              ))}
            </Pila>
          </Pila>
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
