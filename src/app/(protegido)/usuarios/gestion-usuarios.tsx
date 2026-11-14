"use client";

/**
 * Pantalla provisional de gestión de usuarios (RF-U4, RF-U5).
 *
 * Consume la API REST de /api/usuarios. Los formularios validan con los
 * MISMOS esquemas de Zod que el servidor (src/lib/validacion-usuarios.ts),
 * pero la decisión final (permisos y reglas) la toma siempre el servicio.
 *
 * La contraseña temporal de un restablecimiento solo vive en el estado de
 * este componente: se muestra una vez y se descarta al cerrarla; no se guarda
 * en localStorage, sessionStorage ni en la URL.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";

import type { Rol } from "@/db/schema";
import type { RespuestaError } from "@/lib/api-error";
import type { ListaPaginada } from "@/lib/paginacion";
import { esquemaAltaUsuario, esquemaEdicionUsuario } from "@/lib/validacion-usuarios";
import type { UsuarioGestion } from "@/servicios/usuarios";

const TAMANIO_PAGINA = 10;

const NOMBRES_ROL: Record<Rol, string> = { admin: "Administrador", vendedor: "Vendedor" };

type FiltroActivo = "" | "true" | "false";
type ErroresCampo = Record<string, string>;

/** Error de la API traducido a un mensaje general y a mensajes por campo. */
class ErrorDeApi extends Error {
  constructor(
    message: string,
    readonly campos: ErroresCampo = {},
  ) {
    super(message);
  }
}

async function llamarApi<T>(url: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ErrorDeApi("No fue posible comunicarse con el servidor. Intente nuevamente.");
  }
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const error = (cuerpo as RespuestaError | null)?.error;
    const campos: ErroresCampo = {};
    if (Array.isArray(error?.details)) {
      for (const d of error.details as { campo: string; mensaje: string }[]) campos[d.campo] = d.mensaje;
    }
    throw new ErrorDeApi(error?.message ?? "Ocurrió un error inesperado.", campos);
  }
  return cuerpo as T;
}

function erroresDeZod(error: z.ZodError): ErroresCampo {
  const campos: ErroresCampo = {};
  for (const issue of error.issues) campos[issue.path.join(".")] ??= issue.message;
  return campos;
}

// ---------------------------------------------------------------------------

export function GestionUsuarios({ usuarioActualId }: { usuarioActualId: number }) {
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState<FiltroActivo>("");
  const [page, setPage] = useState(1);
  const [lista, setLista] = useState<ListaPaginada<UsuarioGestion> | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [temporal, setTemporal] = useState<{ email: string; password: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const parametros = new URLSearchParams({ page: String(page), pageSize: String(TAMANIO_PAGINA) });
    if (q.trim()) parametros.set("q", q.trim());
    if (activo) parametros.set("activo", activo);
    try {
      setLista(await llamarApi<ListaPaginada<UsuarioGestion>>(`/api/usuarios?${parametros}`));
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
    setCargando(false);
  }, [q, activo, page]);

  useEffect(() => {
    // Pequeña espera para no consultar en cada tecla de la búsqueda.
    const espera = setTimeout(cargar, 250);
    return () => clearTimeout(espera);
  }, [cargar]);

  async function cambiarActivo(usuario: UsuarioGestion) {
    if (
      usuario.activo &&
      !window.confirm(
        `¿Confirma que desea desactivar a ${usuario.nombre}? Perderá el acceso al sistema de inmediato.`,
      )
    ) {
      return;
    }
    try {
      await llamarApi(`/api/usuarios/${usuario.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !usuario.activo }),
      });
      setMensaje({
        tipo: "ok",
        texto: `${usuario.nombre} fue ${usuario.activo ? "desactivado" : "activado"}.`,
      });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
  }

  async function restablecer(usuario: UsuarioGestion) {
    if (
      !window.confirm(
        `¿Confirma que desea restablecer la contraseña de ${usuario.nombre}? La contraseña actual dejará de funcionar.`,
      )
    ) {
      return;
    }
    try {
      const { passwordTemporal } = await llamarApi<{ passwordTemporal: string }>(
        `/api/usuarios/${usuario.id}/reset-password`,
        { method: "POST" },
      );
      setMensaje(null);
      setTemporal({ email: usuario.email, password: passwordTemporal });
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
  }

  const totalPaginas = lista ? Math.max(1, Math.ceil(lista.total / lista.pageSize)) : 1;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Usuarios</h1>

      {mensaje && (
        <p
          role={mensaje.tipo === "error" ? "alert" : "status"}
          className={mensaje.tipo === "error" ? "text-sm text-red-700" : "text-sm text-green-700"}
        >
          {mensaje.texto}
        </p>
      )}

      {temporal && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-amber-500 p-4 text-sm">
          <p>
            Contraseña temporal de <strong>{temporal.email}</strong>. Comuníquela al usuario: se
            muestra <strong>una sola vez</strong> y no podrá volver a consultarse.
          </p>
          <code className="w-fit rounded border px-2 py-1 text-base select-all">{temporal.password}</code>
          <button type="button" onClick={() => setTemporal(null)} className="w-fit rounded border px-3 py-1">
            Ya la comuniqué, ocultar
          </button>
        </div>
      )}

      <FormularioAlta
        onCreado={async (u) => {
          setMensaje({ tipo: "ok", texto: `Se creó el usuario ${u.email}.` });
          await cargar();
        }}
      />

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Buscar por nombre o email
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          Estado
          <select
            value={activo}
            onChange={(e) => {
              setActivo(e.target.value as FiltroActivo);
              setPage(1);
            }}
            className="rounded border px-2 py-1"
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </label>
      </div>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-3">Nombre</th>
            <th className="py-2 pr-3">Email</th>
            <th className="py-2 pr-3">Rol</th>
            <th className="py-2 pr-3">Estado</th>
            <th className="py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {lista?.data.map((u) =>
            editandoId === u.id ? (
              <FilaEdicion
                key={u.id}
                usuario={u}
                esPropio={u.id === usuarioActualId}
                onCancelar={() => setEditandoId(null)}
                onGuardado={async (actualizado) => {
                  setEditandoId(null);
                  setMensaje({ tipo: "ok", texto: `Se guardaron los cambios de ${actualizado.email}.` });
                  await cargar();
                }}
              />
            ) : (
              <tr key={u.id} className="border-b align-top">
                <td className="py-2 pr-3">{u.nombre}</td>
                <td className="py-2 pr-3">{u.email}</td>
                <td className="py-2 pr-3">{NOMBRES_ROL[u.rol]}</td>
                <td className="py-2 pr-3">{u.activo ? "Activo" : "Inactivo"}</td>
                <td className="flex flex-wrap gap-2 py-2">
                  <button type="button" onClick={() => setEditandoId(u.id)} className="rounded border px-2 py-0.5">
                    Editar
                  </button>
                  {/* El servidor rechaza igual la autodesactivación (422). */}
                  {u.id !== usuarioActualId && (
                    <button type="button" onClick={() => cambiarActivo(u)} className="rounded border px-2 py-0.5">
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
                  )}
                  <button type="button" onClick={() => restablecer(u)} className="rounded border px-2 py-0.5">
                    Restablecer contraseña
                  </button>
                </td>
              </tr>
            ),
          )}
          {lista && lista.data.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-center">
                No hay usuarios que coincidan con la búsqueda.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          disabled={page <= 1 || cargando}
          onClick={() => setPage((p) => p - 1)}
          className="rounded border px-2 py-0.5 disabled:opacity-50"
        >
          Anterior
        </button>
        <span>
          Página {page} de {totalPaginas} · {lista?.total ?? 0} usuario(s)
        </span>
        <button
          type="button"
          disabled={page >= totalPaginas || cargando}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border px-2 py-0.5 disabled:opacity-50"
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function FormularioAlta({ onCreado }: { onCreado: (u: UsuarioGestion) => Promise<void> }) {
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const valores = Object.fromEntries(new FormData(formulario));
    setGeneral(null);

    const validacion = esquemaAltaUsuario.safeParse(valores);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }

    setEnviando(true);
    try {
      const creado = await llamarApi<UsuarioGestion>("/api/usuarios", {
        method: "POST",
        body: JSON.stringify(validacion.data),
      });
      formulario.reset();
      setErrores({});
      await onCreado(creado);
    } catch (e) {
      setErrores(e instanceof ErrorDeApi ? e.campos : {});
      setGeneral((e as Error).message);
    }
    setEnviando(false);
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded border p-4 text-sm">
      <h2 className="text-lg font-semibold">Nuevo usuario</h2>
      <div className="flex flex-wrap gap-3">
        <Campo etiqueta="Nombre y apellido" error={errores.nombre}>
          <input name="nombre" autoComplete="off" className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Correo electrónico" error={errores.email}>
          <input name="email" type="email" autoComplete="off" className="rounded border px-2 py-1" />
        </Campo>
        <Campo etiqueta="Rol" error={errores.rol}>
          <select name="rol" defaultValue="vendedor" className="rounded border px-2 py-1">
            <option value="vendedor">Vendedor</option>
            <option value="admin">Administrador</option>
          </select>
        </Campo>
        <Campo etiqueta="Contraseña temporal" error={errores.password}>
          <input name="password" type="password" autoComplete="new-password" className="rounded border px-2 py-1" />
        </Campo>
      </div>
      {general && (
        <p role="alert" className="text-red-700">
          {general}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="w-fit rounded bg-black px-3 py-1 text-white disabled:opacity-50"
      >
        {enviando ? "Guardando…" : "Crear usuario"}
      </button>
    </form>
  );
}

function FilaEdicion({
  usuario,
  esPropio,
  onCancelar,
  onGuardado,
}: {
  usuario: UsuarioGestion;
  esPropio: boolean;
  onCancelar: () => void;
  onGuardado: (u: UsuarioGestion) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(usuario.nombre);
  const [email, setEmail] = useState(usuario.email);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    // Solo se envían los campos modificados.
    const cambios: Record<string, unknown> = {};
    if (nombre !== usuario.nombre) cambios.nombre = nombre;
    if (email !== usuario.email) cambios.email = email;
    if (rol !== usuario.rol) cambios.rol = rol;

    const validacion = esquemaEdicionUsuario.safeParse(cambios);
    if (!validacion.success) {
      const campos = erroresDeZod(validacion.error);
      setErrores(campos[""] ? { ...campos, general: "No hay cambios para guardar." } : campos);
      return;
    }

    setEnviando(true);
    try {
      const actualizado = await llamarApi<UsuarioGestion>(`/api/usuarios/${usuario.id}`, {
        method: "PATCH",
        body: JSON.stringify(validacion.data),
      });
      await onGuardado(actualizado);
    } catch (e) {
      setErrores({ ...(e instanceof ErrorDeApi ? e.campos : {}), general: (e as Error).message });
      setEnviando(false);
    }
  }

  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">
        <Campo etiqueta="Nombre" error={errores.nombre}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
      </td>
      <td className="py-2 pr-3">
        <Campo etiqueta="Email" error={errores.email}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border px-2 py-1" />
        </Campo>
      </td>
      <td className="py-2 pr-3">
        <Campo etiqueta="Rol" error={errores.rol}>
          {/* Un administrador no puede quitarse su propio rol (el servidor responde 422). */}
          <select
            value={rol}
            disabled={esPropio}
            onChange={(e) => setRol(e.target.value as Rol)}
            className="rounded border px-2 py-1"
          >
            <option value="vendedor">Vendedor</option>
            <option value="admin">Administrador</option>
          </select>
        </Campo>
      </td>
      <td className="py-2 pr-3">{usuario.activo ? "Activo" : "Inactivo"}</td>
      <td className="flex flex-col gap-2 py-2 text-sm">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={enviando}
            className="rounded bg-black px-2 py-0.5 text-white disabled:opacity-50"
          >
            {enviando ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={onCancelar} className="rounded border px-2 py-0.5">
            Cancelar
          </button>
        </div>
        {errores.general && (
          <p role="alert" className="text-red-700">
            {errores.general}
          </p>
        )}
      </td>
    </tr>
  );
}

function Campo({
  etiqueta,
  error,
  children,
}: {
  etiqueta: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      {etiqueta}
      {children}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </label>
  );
}
