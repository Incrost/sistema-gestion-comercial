"use client";

/**
 * Gestión provisional de categorías (RF-P7). Solo administrador: alta,
 * cambio de nombre, baja y reactivación lógicas (con confirmación).
 *
 * Valida con los mismos esquemas que el servidor y consume la API REST; la
 * regla «no desactivar con productos activos» la aplica el servicio
 * (409 CATEGORIA_EN_USO) y aquí solo se muestra su mensaje.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ErrorDeApi, erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { esquemaAltaCategoria, esquemaEdicionCategoria } from "@/lib/validacion-productos";
import type { CategoriaPublica } from "@/servicios/categorias";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

export function GestionCategorias({ categorias }: { categorias: CategoriaPublica[] }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [errorNuevo, setErrorNuevo] = useState<string | undefined>();
  const [editando, setEditando] = useState<{ id: number; nombre: string; error?: string } | null>(null);

  function mostrarError(e: unknown) {
    setAviso({ tipo: "error", texto: (e as Error).message });
    return e instanceof ErrorDeApi ? e.campos : {};
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    setAviso(null);
    const validacion = esquemaAltaCategoria.safeParse({ nombre: nombreNuevo });
    if (!validacion.success) {
      setErrorNuevo(erroresDeZod(validacion.error).nombre);
      return;
    }
    setErrorNuevo(undefined);
    try {
      const cat = await llamarApi<CategoriaPublica>("/api/categorias", {
        method: "POST",
        body: JSON.stringify(validacion.data),
      });
      setAviso({ tipo: "ok", texto: `Se creó la categoría «${cat.nombre}».` });
      setNombreNuevo("");
      router.refresh();
    } catch (e) {
      setErrorNuevo(mostrarError(e).nombre);
    }
  }

  async function guardarNombre(evento: FormEvent) {
    evento.preventDefault();
    if (!editando) return;
    const validacion = esquemaEdicionCategoria.safeParse({ nombre: editando.nombre });
    if (!validacion.success) {
      setEditando({ ...editando, error: erroresDeZod(validacion.error).nombre });
      return;
    }
    try {
      await llamarApi(`/api/categorias/${editando.id}`, {
        method: "PATCH",
        body: JSON.stringify(validacion.data),
      });
      setAviso({ tipo: "ok", texto: "Nombre actualizado." });
      setEditando(null);
      router.refresh();
    } catch (e) {
      setEditando({ ...editando, error: mostrarError(e).nombre });
    }
  }

  async function cambiarEstado(cat: CategoriaPublica) {
    if (cat.activa && !window.confirm(`¿Confirma que desea desactivar la categoría «${cat.nombre}»?`)) return;
    setAviso(null);
    try {
      await llamarApi(`/api/categorias/${cat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activa: !cat.activa }),
      });
      setAviso({ tipo: "ok", texto: `Categoría «${cat.nombre}» ${cat.activa ? "desactivada" : "reactivada"}.` });
      router.refresh();
    } catch (e) {
      mostrarError(e);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {aviso && (
        <p role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {aviso.texto}
        </p>
      )}

      <form onSubmit={crear} noValidate className="flex flex-wrap items-end gap-3 rounded border p-4">
        <label className="flex flex-col gap-1">
          Nueva categoría
          <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} className="rounded border px-2 py-1" />
          {errorNuevo && <span className="text-red-700">{errorNuevo}</span>}
        </label>
        <button type="submit" className="rounded border px-3 py-1">
          Crear
        </button>
      </form>

      <table className="w-full max-w-2xl text-left">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-3">Nombre</th>
            <th className="py-2 pr-3">Estado</th>
            <th className="py-2 pr-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {categorias.map((cat) => (
            <tr key={cat.id} className="border-b">
              <td className="py-2 pr-3">
                {editando?.id === cat.id ? (
                  <form onSubmit={guardarNombre} noValidate className="flex flex-wrap items-center gap-2">
                    <input
                      value={editando.nombre}
                      onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                      className="rounded border px-2 py-1"
                      autoFocus
                    />
                    <button type="submit" className="rounded border px-2 py-0.5">Guardar</button>
                    <button type="button" onClick={() => setEditando(null)} className="rounded border px-2 py-0.5">Cancelar</button>
                    {editando.error && <span className="w-full text-red-700">{editando.error}</span>}
                  </form>
                ) : (
                  cat.nombre
                )}
              </td>
              <td className="py-2 pr-3">{cat.activa ? "Activa" : "Inactiva"}</td>
              <td className="flex gap-2 py-2 pr-3">
                <button type="button" onClick={() => setEditando({ id: cat.id, nombre: cat.nombre })} className="rounded border px-2 py-0.5">
                  Renombrar
                </button>
                <button type="button" onClick={() => cambiarEstado(cat)} className="rounded border px-2 py-0.5">
                  {cat.activa ? "Desactivar" : "Reactivar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
