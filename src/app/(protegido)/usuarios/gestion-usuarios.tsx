"use client";

/**
 * Gestión de usuarios (RF-U4, RF-U5). Solo administrador.
 *
 * Consume la API REST de /api/usuarios. Los formularios validan con los
 * MISMOS esquemas de Zod que el servidor (src/lib/validacion-usuarios.ts),
 * pero la decisión final (permisos y reglas) la toma siempre el servicio.
 *
 * - Alta y edición en ventanas modales; errores junto a cada campo.
 * - Desactivar y restablecer la contraseña se confirman antes de enviarse.
 * - La contraseña temporal de un restablecimiento solo vive en el estado de
 *   este componente: se muestra una vez en un diálogo y se descarta al
 *   cerrarlo; no se guarda en localStorage, sessionStorage ni en la URL.
 */
import { CopyIcon, KeyRoundIcon, PencilIcon, PowerIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type Columna } from "@/components/datos/data-table";
import { Pagination } from "@/components/datos/pagination";
import { StatusBadge } from "@/components/datos/status-badge";
import { EmptyState } from "@/components/estados/empty-state";
import { ErrorState } from "@/components/estados/error-state";
import { LoadingState } from "@/components/estados/loading-state";
import { ErrorCampo, FormField, propsCampo } from "@/components/formularios/form-field";
import { SearchInput } from "@/components/formularios/search-input";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Rol } from "@/db/schema";
import { useEnvio } from "@/hooks/usar-envio";
import { avisos } from "@/lib/avisos";
import { erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { NOMBRES_ROL } from "@/lib/navegacion";
import type { ListaPaginada } from "@/lib/paginacion";
import { esquemaAltaUsuario, esquemaEdicionUsuario } from "@/lib/validacion-usuarios";
import type { UsuarioGestion } from "@/servicios/usuarios";

const TAMANIO_PAGINA = 10;

type FiltroActivo = "" | "true" | "false";

type EstadoLista = { tipo: "cargando" } | { tipo: "error"; mensaje: string } | { tipo: "listo"; lista: ListaPaginada<UsuarioGestion> };

export function GestionUsuarios({ usuarioActualId }: { usuarioActualId: number }) {
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState<FiltroActivo>("");
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState<EstadoLista>({ tipo: "cargando" });
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [editando, setEditando] = useState<UsuarioGestion | null>(null);
  const [temporal, setTemporal] = useState<{ email: string; password: string } | null>(null);

  const cargar = useCallback(async () => {
    const parametros = new URLSearchParams({ page: String(page), pageSize: String(TAMANIO_PAGINA) });
    if (q.trim()) parametros.set("q", q.trim());
    if (activo) parametros.set("activo", activo);
    try {
      setEstado({ tipo: "listo", lista: await llamarApi<ListaPaginada<UsuarioGestion>>(`/api/usuarios?${parametros}`) });
    } catch (e) {
      setEstado({ tipo: "error", mensaje: (e as Error).message });
    }
  }, [q, activo, page]);

  useEffect(() => {
    // Pequeña espera para no consultar en cada tecla de la búsqueda.
    const espera = setTimeout(cargar, 250);
    return () => clearTimeout(espera);
  }, [cargar]);

  async function cambiarActivo(usuario: UsuarioGestion): Promise<boolean> {
    try {
      await llamarApi(`/api/usuarios/${usuario.id}`, { method: "PATCH", body: JSON.stringify({ activo: !usuario.activo }) });
    } catch (e) {
      avisos.error((e as Error).message, { id: `usuario-estado-${usuario.id}` });
      return true;
    }
    avisos.exito(`${usuario.nombre} fue ${usuario.activo ? "desactivado" : "activado"}.`, { id: `usuario-estado-${usuario.id}` });
    await cargar();
    return true;
  }

  async function restablecer(usuario: UsuarioGestion): Promise<boolean> {
    try {
      const { passwordTemporal } = await llamarApi<{ passwordTemporal: string }>(`/api/usuarios/${usuario.id}/reset-password`, { method: "POST" });
      setTemporal({ email: usuario.email, password: passwordTemporal });
    } catch (e) {
      avisos.error((e as Error).message, { id: `usuario-reset-${usuario.id}` });
    }
    return true;
  }

  const lista = estado.tipo === "listo" ? estado.lista : null;
  const totalPaginas = lista ? Math.max(1, Math.ceil(lista.total / lista.pageSize)) : 1;

  const columnas: Columna<UsuarioGestion>[] = [
    {
      id: "nombre",
      encabezado: "Nombre",
      principal: true,
      className: "whitespace-normal",
      celda: (u) => (
        <span className="font-medium">
          {u.nombre}
          {u.id === usuarioActualId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(usted)</span>}
        </span>
      ),
    },
    { id: "email", encabezado: "Email", className: "break-all whitespace-normal", celda: (u) => u.email },
    { id: "rol", encabezado: "Rol", celda: (u) => <StatusBadge estado={u.rol} /> },
    { id: "estado", encabezado: "Estado", celda: (u) => <StatusBadge estado={u.activo ? "activo" : "inactivo"} /> },
  ];

  return (
    <>
      <PageHeader
        titulo="Usuarios"
        descripcion="Alta, edición, estado y restablecimiento de contraseñas."
        acciones={
          <Button onClick={() => setAltaAbierta(true)}>
            <UserPlusIcon aria-hidden />
            Nuevo usuario
          </Button>
        }
      />

      <div role="search" aria-label="Búsqueda de usuarios" className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 shadow-suave sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <FormField id="usuarios-q" etiqueta="Buscar por nombre o email">
          <SearchInput
            id="usuarios-q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </FormField>
        <FormField id="usuarios-estado" etiqueta="Estado">
          <NativeSelect
            id="usuarios-estado"
            value={activo}
            onChange={(e) => {
              setActivo(e.target.value as FiltroActivo);
              setPage(1);
            }}
            className="w-full"
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            <NativeSelectOption value="true">Activos</NativeSelectOption>
            <NativeSelectOption value="false">Inactivos</NativeSelectOption>
          </NativeSelect>
        </FormField>
      </div>

      {estado.tipo === "cargando" && <LoadingState texto="Cargando usuarios…" filas={4} />}
      {estado.tipo === "error" && <ErrorState titulo="No se pudieron cargar los usuarios" mensaje={estado.mensaje} onReintentar={() => void cargar()} />}
      {lista && (
        <>
          <DataTable
            etiqueta="Usuarios"
            columnas={columnas}
            filas={lista.data}
            clave={(u) => u.id}
            claseFila={(u) => (!u.activo ? "text-muted-foreground" : undefined)}
            vacio={<EmptyState icono={UsersIcon} titulo="No hay usuarios que coincidan con la búsqueda." />}
            acciones={(u) => (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(u)} aria-label={`Editar a ${u.nombre}`}>
                  <PencilIcon aria-hidden />
                  Editar
                </Button>
                <ConfirmDialog
                  destructivo={false}
                  titulo={`¿Restablecer la contraseña de ${u.nombre}?`}
                  descripcion="La contraseña actual dejará de funcionar y se generará una temporal que se mostrará una sola vez."
                  textoConfirmar="Restablecer"
                  textoEnviando="Restableciendo…"
                  alConfirmar={() => restablecer(u)}
                  disparador={
                    <Button type="button" variant="ghost" size="sm" aria-label={`Restablecer la contraseña de ${u.nombre}`}>
                      <KeyRoundIcon aria-hidden />
                      Contraseña
                    </Button>
                  }
                />
                {/* El servidor rechaza igual la autodesactivación (422). */}
                {u.id !== usuarioActualId &&
                  (u.activo ? (
                    <ConfirmDialog
                      titulo={`¿Desactivar a ${u.nombre}?`}
                      descripcion="Perderá el acceso al sistema de inmediato, aunque tenga una sesión abierta. Sus ventas y registros se conservan."
                      textoConfirmar="Desactivar"
                      textoEnviando="Desactivando…"
                      alConfirmar={() => cambiarActivo(u)}
                      disparador={
                        <Button type="button" variant="destructive-soft" size="sm" aria-label={`Desactivar a ${u.nombre}`}>
                          <PowerIcon aria-hidden />
                          Desactivar
                        </Button>
                      }
                    />
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => void cambiarActivo(u)} aria-label={`Activar a ${u.nombre}`}>
                      <PowerIcon aria-hidden />
                      Activar
                    </Button>
                  ))}
              </>
            )}
          />
          <Pagination pagina={page} totalPaginas={totalPaginas} total={lista.total} unidad={["usuario", "usuarios"]} onCambiar={setPage} />
        </>
      )}

      <Dialog open={altaAbierta} onOpenChange={setAltaAbierta}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
            <DialogDescription>La contraseña inicial es temporal: comuníquela al usuario por un medio seguro.</DialogDescription>
          </DialogHeader>
          {altaAbierta && (
            <FormularioAlta
              onCancelar={() => setAltaAbierta(false)}
              onCreado={async () => {
                setAltaAbierta(false);
                await cargar();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editando !== null} onOpenChange={(abierto) => !abierto && setEditando(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>Solo se envían los datos modificados.</DialogDescription>
          </DialogHeader>
          {editando && (
            <FormularioEdicion
              key={editando.id}
              usuario={editando}
              esPropio={editando.id === usuarioActualId}
              onCancelar={() => setEditando(null)}
              onGuardado={async () => {
                setEditando(null);
                await cargar();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <DialogoContrasenaTemporal temporal={temporal} onCerrar={() => setTemporal(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Contraseña temporal: se muestra UNA vez. No se cierra al tocar fuera (para
 * no perderla por accidente); se descarta con el botón, la X o Escape.
 */
function DialogoContrasenaTemporal({ temporal, onCerrar }: { temporal: { email: string; password: string } | null; onCerrar: () => void }) {
  async function copiar() {
    if (!temporal) return;
    try {
      await navigator.clipboard.writeText(temporal.password);
      avisos.exito("Contraseña copiada al portapapeles.", { id: "contrasena-copiada" });
    } catch {
      avisos.advertencia("No se pudo copiar automáticamente. Selecciónela y cópiela manualmente.", { id: "contrasena-copiada" });
    }
  }

  return (
    <Dialog open={temporal !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon aria-hidden className="size-4 text-primary" />
            Contraseña temporal
          </DialogTitle>
          <DialogDescription>
            Para <strong className="text-foreground">{temporal?.email}</strong>. Comuníquela al usuario: se muestra <strong className="text-foreground">una sola vez</strong>{" "}
            y no podrá volver a consultarse.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code aria-label="Contraseña temporal" className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-base break-all select-all">
            {temporal?.password}
          </code>
          <Button type="button" variant="outline" size="icon" onClick={() => void copiar()} aria-label="Copiar contraseña">
            <CopyIcon aria-hidden />
          </Button>
        </div>
        <DialogFooter className="-mx-4 -mb-4">
          <Button type="button" onClick={onCerrar}>
            Ya la comuniqué, cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormularioAlta({ onCancelar, onCreado }: { onCancelar: () => void; onCreado: () => Promise<void> }) {
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const valores = Object.fromEntries(new FormData(evento.currentTarget));
    const validacion = esquemaAltaUsuario.safeParse(valores);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    const creado = await ejecutar(
      () => llamarApi<UsuarioGestion>("/api/usuarios", { method: "POST", body: JSON.stringify(validacion.data) }),
      { exito: (u) => `Se creó el usuario ${u.email}.`, idError: "usuario-alta" },
    );
    if (creado) await onCreado();
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="alta-nombre" etiqueta="Nombre y apellido" error={errores.nombre} className="sm:col-span-2">
          <Input {...propsCampo("alta-nombre", errores.nombre)} name="nombre" autoComplete="off" />
        </FormField>
        <FormField id="alta-email" etiqueta="Correo electrónico" error={errores.email} className="sm:col-span-2">
          <Input {...propsCampo("alta-email", errores.email)} name="email" type="email" autoComplete="off" />
        </FormField>
        <FormField id="alta-rol" etiqueta="Rol" error={errores.rol}>
          <NativeSelect {...propsCampo("alta-rol", errores.rol)} name="rol" defaultValue="vendedor" className="w-full">
            <NativeSelectOption value="vendedor">{NOMBRES_ROL.vendedor}</NativeSelectOption>
            <NativeSelectOption value="admin">{NOMBRES_ROL.admin}</NativeSelectOption>
          </NativeSelect>
        </FormField>
        <FormField id="alta-password" etiqueta="Contraseña temporal" error={errores.password}>
          <Input {...propsCampo("alta-password", errores.password)} name="password" type="password" autoComplete="new-password" />
        </FormField>
      </div>
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Crear usuario"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormularioEdicion({
  usuario,
  esPropio,
  onCancelar,
  onGuardado,
}: {
  usuario: UsuarioGestion;
  esPropio: boolean;
  onCancelar: () => void;
  onGuardado: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState(usuario.nombre);
  const [email, setEmail] = useState(usuario.email);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    // Solo se envían los campos modificados.
    const cambios: Record<string, unknown> = {};
    if (nombre !== usuario.nombre) cambios.nombre = nombre;
    if (email !== usuario.email) cambios.email = email;
    if (rol !== usuario.rol) cambios.rol = rol;

    const validacion = esquemaEdicionUsuario.safeParse(cambios);
    if (!validacion.success) {
      const campos = erroresDeZod(validacion.error);
      if (campos[""]) {
        avisos.info("No hay cambios para guardar.", { id: "usuario-sin-cambios" });
        return;
      }
      setErrores(campos);
      return;
    }
    const actualizado = await ejecutar(
      () => llamarApi<UsuarioGestion>(`/api/usuarios/${usuario.id}`, { method: "PATCH", body: JSON.stringify(validacion.data) }),
      { exito: (u) => `Se guardaron los cambios de ${u.email}.`, idError: "usuario-edicion" },
    );
    if (actualizado) await onGuardado();
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-3">
        <FormField id="edicion-nombre" etiqueta="Nombre y apellido" error={errores.nombre}>
          <Input {...propsCampo("edicion-nombre", errores.nombre)} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </FormField>
        <FormField id="edicion-email" etiqueta="Correo electrónico" error={errores.email}>
          <Input {...propsCampo("edicion-email", errores.email)} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField
          id="edicion-rol"
          etiqueta="Rol"
          error={errores.rol}
          ayuda={esPropio ? "No puede quitarse su propio rol de administrador." : undefined}
        >
          {/* Un administrador no puede quitarse su propio rol (el servidor responde 422). */}
          <NativeSelect
            {...propsCampo("edicion-rol", errores.rol, esPropio)}
            value={rol}
            disabled={esPropio}
            onChange={(e) => setRol(e.target.value as Rol)}
            className="w-full"
          >
            <NativeSelectOption value="vendedor">{NOMBRES_ROL.vendedor}</NativeSelectOption>
            <NativeSelectOption value="admin">{NOMBRES_ROL.admin}</NativeSelectOption>
          </NativeSelect>
        </FormField>
      </div>
      {errores[""] && <ErrorCampo>{errores[""]}</ErrorCampo>}
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar cambios"}
        </Button>
      </DialogFooter>
    </form>
  );
}
