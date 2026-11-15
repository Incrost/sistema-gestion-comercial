/**
 * Contenido de /perfil (Server Component). Segunda barrera de la sección
 * 10.5: vuelve a leer al usuario de la base; si ya no existe o fue
 * desactivado, exigirUsuarioDePagina() redirige a /login.
 */
import { PageHeader } from "@/components/layout/page-header";
import { exigirUsuarioDePagina } from "@/lib/sesion-pagina";

import { DatosCuenta } from "./datos-cuenta";
import { TarjetaContrasena } from "./tarjeta-contrasena";

export async function ContenidoPerfil() {
  const usuario = await exigirUsuarioDePagina(); // RF-U2 y RF-U4
  return (
    <>
      <PageHeader titulo="Mi perfil" descripcion="Consulte los datos de su cuenta y actualice su contraseña." />
      <div className="grid min-w-0 grid-cols-1 gap-6">
        {/* Solo los campos públicos: el hash nunca llega a la página. */}
        <DatosCuenta usuario={{ nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }} />
        <TarjetaContrasena />
      </div>
    </>
  );
}
