"use client";

/**
 * Gestión de categorías (RF-P7). Solo administrador: alta, cambio de nombre
 * (en una ventana modal), baja y reactivación lógicas (con confirmación).
 *
 * Valida con los mismos esquemas que el servidor y consume la API REST; la
 * regla «no desactivar con productos activos» la aplica el servicio
 * (409 CATEGORIA_EN_USO) y aquí solo se muestra su mensaje.
 */
import { ArchiveRestoreIcon, ArchiveXIcon, PencilIcon, PlusIcon, TagsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type Columna } from "@/components/datos/data-table";
import { StatusBadge } from "@/components/datos/status-badge";
import { EmptyState } from "@/components/estados/empty-state";
import { FormField, propsCampo } from "@/components/formularios/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEnvio } from "@/hooks/usar-envio";
import { avisos } from "@/lib/avisos";
import { erroresDeZod, llamarApi } from "@/lib/cliente-api";
import { esquemaAltaCategoria, esquemaEdicionCategoria } from "@/lib/validacion-productos";
import type { CategoriaPublica } from "@/servicios/categorias";

export function GestionCategorias({ categorias }: { categorias: CategoriaPublica[] }) {
  const router = useRouter();
  const [nombreNuevo, setNombreNuevo] = useState("");
  const alta = useEnvio();
  const [editando, setEditando] = useState<CategoriaPublica | null>(null);

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    const validacion = esquemaAltaCategoria.safeParse({ nombre: nombreNuevo });
    if (!validacion.success) {
      alta.setErrores(erroresDeZod(validacion.error));
      return;
    }
    const cat = await alta.ejecutar(
      () => llamarApi<CategoriaPublica>("/api/categorias", { method: "POST", body: JSON.stringify(validacion.data) }),
      { exito: (c) => `Se creó la categoría «${c.nombre}».`, idError: "categoria-alta" },
    );
    if (!cat) return;
    setNombreNuevo("");
    router.refresh();
  }

  async function cambiarEstado(cat: CategoriaPublica): Promise<boolean> {
    try {
      await llamarApi(`/api/categorias/${cat.id}`, { method: "PATCH", body: JSON.stringify({ activa: !cat.activa }) });
    } catch (e) {
      avisos.error((e as Error).message, { id: `categoria-estado-${cat.id}` });
      return true;
    }
    avisos.exito(`Categoría «${cat.nombre}» ${cat.activa ? "desactivada" : "reactivada"}.`, { id: `categoria-estado-${cat.id}` });
    router.refresh();
    return true;
  }

  const columnas: Columna<CategoriaPublica>[] = [
    { id: "nombre", encabezado: "Nombre", principal: true, className: "whitespace-normal", celda: (c) => <span className="font-medium">{c.nombre}</span> },
    { id: "estado", encabezado: "Estado", celda: (c) => <StatusBadge estado={c.activa ? "activa" : "inactiva"} /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-suave">
        <CardContent>
          <form onSubmit={crear} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField id="categoria-nueva" etiqueta="Nueva categoría" error={alta.errores.nombre} className="flex-1 sm:max-w-sm">
              <Input {...propsCampo("categoria-nueva", alta.errores.nombre)} value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
            </FormField>
            <Button type="submit" disabled={alta.enviando} className="w-full sm:w-fit">
              <PlusIcon aria-hidden />
              {alta.enviando ? "Creando…" : "Crear categoría"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <DataTable
        etiqueta="Categorías"
        columnas={columnas}
        filas={categorias}
        clave={(c) => c.id}
        vacio={<EmptyState icono={TagsIcon} titulo="No hay categorías cargadas." descripcion="Cree la primera con el formulario de arriba." />}
        acciones={(cat) => (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(cat)} aria-label={`Renombrar ${cat.nombre}`}>
              <PencilIcon aria-hidden />
              Renombrar
            </Button>
            {cat.activa ? (
              <ConfirmDialog
                titulo={`¿Desactivar la categoría «${cat.nombre}»?`}
                descripcion="No podrá asignarse a productos nuevos. Si tiene productos activos, el sistema no permitirá desactivarla."
                textoConfirmar="Desactivar"
                textoEnviando="Desactivando…"
                alConfirmar={() => cambiarEstado(cat)}
                disparador={
                  <Button type="button" variant="destructive-soft" size="sm" aria-label={`Desactivar ${cat.nombre}`}>
                    <ArchiveXIcon aria-hidden />
                    Desactivar
                  </Button>
                }
              />
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => void cambiarEstado(cat)} aria-label={`Reactivar ${cat.nombre}`}>
                <ArchiveRestoreIcon aria-hidden />
                Reactivar
              </Button>
            )}
          </>
        )}
      />

      <DialogoRenombrar categoria={editando} onCerrar={() => setEditando(null)} />
    </div>
  );
}

function DialogoRenombrar({ categoria, onCerrar }: { categoria: CategoriaPublica | null; onCerrar: () => void }) {
  return (
    <Dialog open={categoria !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renombrar categoría</DialogTitle>
          <DialogDescription>Los productos de la categoría conservan la asignación.</DialogDescription>
        </DialogHeader>
        {categoria && <FormularioNombre key={categoria.id} categoria={categoria} onListo={onCerrar} />}
      </DialogContent>
    </Dialog>
  );
}

function FormularioNombre({ categoria, onListo }: { categoria: CategoriaPublica; onListo: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(categoria.nombre);
  const { enviando, errores, setErrores, ejecutar } = useEnvio();

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    const validacion = esquemaEdicionCategoria.safeParse({ nombre });
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    const ok = await ejecutar(
      () => llamarApi(`/api/categorias/${categoria.id}`, { method: "PATCH", body: JSON.stringify(validacion.data) }),
      { exito: () => "Nombre actualizado.", idError: "categoria-nombre" },
    );
    if (ok === undefined) return;
    onListo();
    router.refresh();
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      <FormField id="categoria-nombre" etiqueta="Nombre" error={errores.nombre}>
        <Input {...propsCampo("categoria-nombre", errores.nombre)} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </FormField>
      <DialogFooter className="-mx-4 -mb-4">
        <Button type="button" variant="outline" onClick={onListo} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
