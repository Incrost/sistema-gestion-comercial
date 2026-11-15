"use client";

/**
 * Alta y edición de productos (RF-P2). Solo admin. Se abre en una ventana
 * modal desde el catálogo («Nuevo producto») o desde la ficha («Editar»).
 *
 * Valida con los MISMOS esquemas de Zod que el servidor
 * (src/lib/validacion-productos.ts) y luego llama a la API REST. La decisión
 * final (permisos, código único, categoría activa) la toma el servicio.
 * El precio se escribe en pesos y se envía en centavos.
 */
import { PencilIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ErrorCampo, FormField, propsCampo } from "@/components/formularios/form-field";
import { MoneyField } from "@/components/formularios/money-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useEnvio } from "@/hooks/usar-envio";
import { avisos } from "@/lib/avisos";
import { erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { centavosATextoEditable, pesosACentavos } from "@/lib/importes";
import { esquemaAltaProducto, esquemaEdicionProducto } from "@/lib/validacion-productos";
import type { CategoriaPublica } from "@/servicios/categorias";
import type { ProductoPublico } from "@/servicios/productos";

type Props = {
  categorias: CategoriaPublica[];
  /** Si se indica, el formulario edita este producto; si no, da de alta uno nuevo. */
  producto?: ProductoPublico;
};

/** Botón + ventana modal con el formulario de alta o edición. */
export function DialogoProducto({ categorias, producto }: Props) {
  const [abierto, setAbierto] = useState(false);
  const edicion = producto !== undefined;
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        {edicion ? (
          <Button variant="outline">
            <PencilIcon aria-hidden />
            Editar
          </Button>
        ) : (
          <Button>
            <PlusIcon aria-hidden />
            Nuevo producto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{edicion ? `Editar ${producto.codigo}` : "Nuevo producto"}</DialogTitle>
          <DialogDescription>
            {edicion ? "La existencia no se edita aquí: se modifica con ingresos y egresos de stock." : "El stock inicial se registra como un ingreso."}
          </DialogDescription>
        </DialogHeader>
        {abierto && <FormularioProducto categorias={categorias} producto={producto} onListo={() => setAbierto(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FormularioProducto({ categorias, producto, onListo }: Props & { onListo: () => void }) {
  const router = useRouter();
  const edicion = producto !== undefined;
  const [valores, setValores] = useState({
    codigo: producto?.codigo ?? "",
    descripcion: producto?.descripcion ?? "",
    categoriaId: producto ? String(producto.categoria.id) : "",
    precio: producto ? centavosATextoEditable(producto.precio) : "",
    stockMinimo: producto ? String(producto.stockMinimo) : "0",
    stockInicial: "0",
  });
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  const cambiar = (campo: keyof typeof valores) => (valor: string) => setValores((v) => ({ ...v, [campo]: valor }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();

    const precio = pesosACentavos(valores.precio);
    if (precio === null) {
      setErrores({ precio: "Ingrese un importe válido, por ejemplo 12500,50." });
      return;
    }
    const datos = {
      codigo: valores.codigo,
      descripcion: valores.descripcion,
      categoriaId: valores.categoriaId ? Number(valores.categoriaId) : undefined,
      precio,
      stockMinimo: valores.stockMinimo === "" ? undefined : Number(valores.stockMinimo),
      ...(edicion ? {} : { stockInicial: Number(valores.stockInicial || 0) }),
    };

    // En la edición se envían solo los campos que cambiaron.
    const cuerpo: Record<string, unknown> = edicion
      ? Object.fromEntries(
          Object.entries(datos).filter(([campo, valor]) => {
            const actual = {
              codigo: producto.codigo,
              descripcion: producto.descripcion,
              categoriaId: producto.categoria.id,
              precio: producto.precio,
              stockMinimo: producto.stockMinimo,
            }[campo];
            return valor !== actual;
          }),
        )
      : datos;
    if (edicion && Object.keys(cuerpo).length === 0) {
      avisos.info("No hay cambios para guardar.", { id: "producto-sin-cambios" });
      return;
    }

    const validacion = (edicion ? esquemaEdicionProducto : esquemaAltaProducto).safeParse(cuerpo);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    const guardado = await ejecutar(
      () =>
        llamarApi<ProductoPublico>(edicion ? `/api/productos/${producto.id}` : "/api/productos", {
          method: edicion ? "PATCH" : "POST",
          body: JSON.stringify(cuerpo),
        }),
      { exito: (p) => (edicion ? "Producto actualizado." : `Se creó el producto ${p.codigo}.`), idError: "producto-error" },
    );
    if (!guardado) return;
    onListo();
    if (edicion) router.refresh();
    else router.push(`/productos/${guardado.id}`);
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="producto-codigo" etiqueta="Código" error={errores.codigo}>
          <Input {...propsCampo("producto-codigo", errores.codigo)} value={valores.codigo} onChange={(e) => cambiar("codigo")(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField id="producto-categoria" etiqueta="Categoría" error={errores.categoriaId}>
          <NativeSelect
            {...propsCampo("producto-categoria", errores.categoriaId)}
            value={valores.categoriaId}
            onChange={(e) => cambiar("categoriaId")(e.target.value)}
            className="w-full"
          >
            <NativeSelectOption value="">Seleccione…</NativeSelectOption>
            {categorias.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.nombre}
              </NativeSelectOption>
            ))}
            {producto && !categorias.some((c) => c.id === producto.categoria.id) && (
              <NativeSelectOption value={producto.categoria.id}>{producto.categoria.nombre} (inactiva)</NativeSelectOption>
            )}
          </NativeSelect>
        </FormField>
        <FormField id="producto-descripcion" etiqueta="Descripción" error={errores.descripcion} className="sm:col-span-2">
          <Input {...propsCampo("producto-descripcion", errores.descripcion)} value={valores.descripcion} onChange={(e) => cambiar("descripcion")(e.target.value)} />
        </FormField>
        <MoneyField
          id="producto-precio"
          etiqueta="Precio de venta"
          ayuda="En pesos, por ejemplo 12500,50."
          valor={valores.precio}
          onCambiar={cambiar("precio")}
          error={errores.precio}
        />
        <FormField id="producto-minimo" etiqueta="Stock mínimo" error={errores.stockMinimo}>
          <Input
            {...propsCampo("producto-minimo", errores.stockMinimo)}
            type="number"
            min={0}
            step={1}
            value={valores.stockMinimo}
            onChange={(e) => cambiar("stockMinimo")(e.target.value)}
            className="tabular-nums"
          />
        </FormField>
        {!edicion && (
          <FormField id="producto-inicial" etiqueta="Stock inicial" ayuda="Se registra como un ingreso." error={errores.stockInicial}>
            <Input
              {...propsCampo("producto-inicial", errores.stockInicial, true)}
              type="number"
              min={0}
              step={1}
              value={valores.stockInicial}
              onChange={(e) => cambiar("stockInicial")(e.target.value)}
              className="tabular-nums"
            />
          </FormField>
        )}
      </div>
      {errores[""] && <ErrorCampo>{errores[""]}</ErrorCampo>}
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" onClick={onListo} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : edicion ? "Guardar cambios" : "Crear producto"}
        </Button>
      </DialogFooter>
    </form>
  );
}
