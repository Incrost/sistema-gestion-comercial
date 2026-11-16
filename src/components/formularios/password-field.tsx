"use client";

/**
 * Campo de contraseña con botón para mostrarla u ocultarla.
 *
 * - Oculta por defecto (type="password").
 * - El botón es un <button type="button"> con nombre accesible y aria-pressed,
 *   alcanzable con Tab y activable con Enter o Espacio; no envía el formulario.
 * - El valor solo vive en el estado del formulario que lo usa: el campo no lo
 *   guarda en ningún almacenamiento ni lo escribe en la URL.
 */
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { FormField, propsCampo } from "./form-field";

type Props = Omit<ComponentProps<"input">, "id" | "type" | "value" | "onChange" | "autoComplete"> & {
  id: string;
  etiqueta: string;
  valor: string;
  onCambiar: (valor: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string;
  ayuda?: ReactNode;
};

/**
 * Atributos que dependen de si la contraseña está visible: el tipo del campo
 * y el nombre accesible y el estado del botón. Función pura (se prueba sin
 * navegador); el componente la usa en cada renderizado.
 */
export function visibilidadContrasena(visible: boolean, etiqueta: string) {
  const accion = `${visible ? "Ocultar" : "Mostrar"} ${etiqueta.toLowerCase()}`;
  return { type: visible ? "text" : "password", accion, pressed: visible } as const;
}

export function PasswordField({ id, etiqueta, valor, onCambiar, autoComplete, error, ayuda, ref, className, ...props }: Props) {
  // Para volver a ocultarla, el formulario puede montar el campo de nuevo (key).
  const [visible, setVisible] = useState(false);
  const { type, accion, pressed } = visibilidadContrasena(visible, etiqueta);

  return (
    <FormField id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <div className="relative">
        <Input
          ref={ref}
          {...propsCampo(id, error, Boolean(ayuda))}
          type={type}
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn("pr-11", className)}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={accion}
          title={accion}
          aria-pressed={pressed}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
        </Button>
      </div>
    </FormField>
  );
}
