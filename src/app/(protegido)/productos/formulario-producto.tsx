"use client";

/**
 * Formulario provisional de alta y edición de productos (RF-P2). Solo admin.
 *
 * Valida con los MISMOS esquemas de Zod que el servidor
 * (src/lib/validacion-productos.ts) y luego llama a la API REST. La decisión
 * final (permisos, código único, categoría activa) la toma el servicio.
 * El precio se escribe en pesos y se envía en centavos.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ErrorDeApi, erroresDeZod, llamarApi, type ErroresCampo } from "@/lib/cliente-api";
import { centavosATextoEditable, pesosACentavos } from "@/lib/importes";
import { esquemaAltaProducto, esquemaEdicionProducto } from "@/lib/validacion-productos";
import type { CategoriaPublica } from "@/servicios/categorias";
import type { ProductoPublico } from "@/servicios/productos";

type Props = {
  categorias: CategoriaPublica[];
  /** Si se indica, el formulario edita este producto; si no, da de alta uno nuevo. */
  producto?: ProductoPublico;
};

export function FormularioProducto({ categorias, producto }: Props) {
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
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (campo: keyof typeof valores) => (valor: string) =>
    setValores((v) => ({ ...v, [campo]: valor }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setMensaje(null);

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
      setMensaje({ tipo: "ok", texto: "No hay cambios para guardar." });
      return;
    }

    const validacion = (edicion ? esquemaEdicionProducto : esquemaAltaProducto).safeParse(cuerpo);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    setErrores({});
    setEnviando(true);
    try {
      const guardado = await llamarApi<ProductoPublico>(
        edicion ? `/api/productos/${producto.id}` : "/api/productos",
        { method: edicion ? "PATCH" : "POST", body: JSON.stringify(cuerpo) },
      );
      if (edicion) {
        setMensaje({ tipo: "ok", texto: "Producto actualizado." });
        router.refresh();
      } else {
        router.push(`/productos/${guardado.id}`);
      }
    } catch (e) {
      if (e instanceof ErrorDeApi) setErrores(e.campos);
      setMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded border p-4 text-sm">
      <h2 className="text-lg font-semibold">{edicion ? "Editar producto" : "Nuevo producto"}</h2>
      {mensaje && (
        <p role={mensaje.tipo === "error" ? "alert" : "status"} className={mensaje.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {mensaje.texto}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Código" error={errores.codigo}>
          <input value={valores.codigo} onChange={(e) => cambiar("codigo")(e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Descripción" error={errores.descripcion}>
          <input value={valores.descripcion} onChange={(e) => cambiar("descripcion")(e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Categoría" error={errores.categoriaId}>
          <select value={valores.categoriaId} onChange={(e) => cambiar("categoriaId")(e.target.value)} className="rounded border px-2 py-1">
            <option value="">Seleccione…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
            {producto && !categorias.some((c) => c.id === producto.categoria.id) && (
              <option value={producto.categoria.id}>{producto.categoria.nombre} (inactiva)</option>
            )}
          </select>
        </Campo>
        <Campo etiqueta="Precio de venta en pesos (ej. 12500,50)" error={errores.precio}>
          <input value={valores.precio} inputMode="decimal" onChange={(e) => cambiar("precio")(e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Stock mínimo" error={errores.stockMinimo}>
          <input type="number" min={0} step={1} value={valores.stockMinimo} onChange={(e) => cambiar("stockMinimo")(e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
        {!edicion && (
          <Campo etiqueta="Stock inicial (se registra como ingreso)" error={errores.stockInicial}>
            <input type="number" min={0} step={1} value={valores.stockInicial} onChange={(e) => cambiar("stockInicial")(e.target.value)} className="rounded border px-2 py-1" />
          </Campo>
        )}
      </div>
      <button type="submit" disabled={enviando} className="w-fit rounded border px-3 py-1 disabled:opacity-50">
        {enviando ? "Guardando…" : edicion ? "Guardar cambios" : "Crear producto"}
      </button>
    </form>
  );
}

function Campo({ etiqueta, error, children }: { etiqueta: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      {etiqueta}
      {children}
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}
