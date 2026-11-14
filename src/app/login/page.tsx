/**
 * Inicio de sesión (`/login`): la única página pública (RF-U1, RF-U2).
 *
 * Queda fuera del layout protegido. Si el usuario ya tiene una sesión válida
 * (comprobada contra la base), se lo envía al inicio. Si la cookie existe pero
 * no es válida, se muestra el formulario: así nunca hay ciclo de redirecciones.
 *
 * PROVISORIO: formulario mínimo; el diseño definitivo llega con shadcn/ui.
 */
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { destinoSeguro } from "@/lib/destino-seguro";
import { obtenerUsuarioDePagina } from "@/lib/sesion-pagina";

import { FormularioLogin } from "./formulario-login";

export default function PaginaLogin({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <section className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
        <Suspense fallback={<p className="text-sm">Cargando…</p>}>
          <Contenido searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}

async function Contenido({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { desde } = await searchParams;
  const destino = destinoSeguro(typeof desde === "string" ? desde : undefined);

  if (await obtenerUsuarioDePagina()) redirect(destino);

  return <FormularioLogin destino={destino} />;
}
