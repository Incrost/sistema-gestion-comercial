"use client";

/**
 * Acciones provisionales del administrador en la ficha del producto:
 * - ingreso y egreso manual de stock (RF-P4, RF-P5);
 * - baja y reactivación lógica (RF-P3), con confirmación.
 *
 * Valida con los mismos esquemas que el servidor y consume la API REST. Los
 * motivos salen de la lista centralizada src/config/motivos-stock.ts.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { MOTIVOS_POR_TIPO, type TipoMovimientoManual } from "@/config/motivos-stock";
import { ErrorDeApi, erroresDeZod, llamarApi, type ErroresCampo } from "@/lib/cliente-api";
import { esquemaMovimientoManual } from "@/lib/validacion-productos";
import type { ProductoPublico } from "@/servicios/productos";
import type { MovimientoPublico } from "@/servicios/stock";

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

export function FormularioMovimiento({ productoId }: { productoId: number }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoMovimientoManual>("ingreso");
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState<string>(MOTIVOS_POR_TIPO.ingreso[0]);
  const [observacion, setObservacion] = useState("");
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);

  function cambiarTipo(nuevo: TipoMovimientoManual) {
    setTipo(nuevo);
    setMotivo(MOTIVOS_POR_TIPO[nuevo][0]);
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setAviso(null);
    const cuerpo = { tipo, cantidad: Number(cantidad), motivo, observacion };
    const validacion = esquemaMovimientoManual.safeParse(cuerpo);
    if (!validacion.success) {
      setErrores(erroresDeZod(validacion.error));
      return;
    }
    setErrores({});
    setEnviando(true);
    try {
      const mov = await llamarApi<MovimientoPublico>(`/api/productos/${productoId}/movimientos`, {
        method: "POST",
        body: JSON.stringify(validacion.data),
      });
      setAviso({
        tipo: "ok",
        texto: `${mov.tipo === "ingreso" ? "Ingreso" : "Egreso"} registrado. Existencia resultante: ${mov.existenciaResultante}.`,
      });
      setCantidad("1");
      setObservacion("");
      router.refresh();
    } catch (e) {
      if (e instanceof ErrorDeApi) setErrores(e.campos);
      setAviso({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3 rounded border p-4 text-sm">
      <h2 className="text-lg font-semibold">Ingreso o egreso de stock</h2>
      {aviso && (
        <p role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {aviso.texto}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          Tipo
          <select value={tipo} onChange={(e) => cambiarTipo(e.target.value as TipoMovimientoManual)} className="rounded border px-2 py-1">
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
          {errores.tipo && <span className="text-red-700">{errores.tipo}</span>}
        </label>
        <label className="flex flex-col gap-1">
          Cantidad
          <input type="number" min={1} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="rounded border px-2 py-1" />
          {errores.cantidad && <span className="text-red-700">{errores.cantidad}</span>}
        </label>
        <label className="flex flex-col gap-1">
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="rounded border px-2 py-1">
            {MOTIVOS_POR_TIPO[tipo].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {errores.motivo && <span className="text-red-700">{errores.motivo}</span>}
        </label>
        <label className="flex flex-col gap-1">
          Observación (opcional)
          <input value={observacion} onChange={(e) => setObservacion(e.target.value)} className="rounded border px-2 py-1" />
          {errores.observacion && <span className="text-red-700">{errores.observacion}</span>}
        </label>
      </div>
      <button type="submit" disabled={enviando} className="w-fit rounded border px-3 py-1 disabled:opacity-50">
        {enviando ? "Registrando…" : "Registrar movimiento"}
      </button>
    </form>
  );
}

export function BotonEstadoProducto({ producto }: { producto: ProductoPublico }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);

  async function cambiar() {
    if (
      producto.activo &&
      !window.confirm(
        `¿Confirma que desea dar de baja ${producto.codigo}? Dejará de ofrecerse en ventas, pero conservará su historial.`,
      )
    ) {
      return;
    }
    setEnviando(true);
    try {
      await llamarApi(`/api/productos/${producto.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !producto.activo }),
      });
      setAviso({ tipo: "ok", texto: producto.activo ? "Producto dado de baja." : "Producto reactivado." });
      router.refresh();
    } catch (e) {
      const campos = e instanceof ErrorDeApi ? Object.values(e.campos) : [];
      setAviso({ tipo: "error", texto: [(e as Error).message, ...campos].join(" ") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" onClick={cambiar} disabled={enviando} className="rounded border px-3 py-1 disabled:opacity-50">
        {producto.activo ? "Dar de baja" : "Reactivar"}
      </button>
      {aviso && (
        <span role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "text-red-700" : "text-green-700"}>
          {aviso.texto}
        </span>
      )}
    </div>
  );
}
