/** Tarjeta del cambio de contraseña (RF-U5): el formulario es un componente de cliente. */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { FormularioContrasena } from "./formulario-contrasena";

export function TarjetaContrasena() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Cambiar contraseña</h2>
        </CardTitle>
        <CardDescription>
          Ingrese su contraseña actual y elija una nueva. Por seguridad, no comparta su contraseña con otras personas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormularioContrasena />
      </CardContent>
    </Card>
  );
}
