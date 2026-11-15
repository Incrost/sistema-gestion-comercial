"use client";

/**
 * Pantalla de Nueva venta (RF-V1 a RF-V6): comprador, ítems y forma de pago
 * en una sola pantalla, con el total estimado recalculado en cada cambio.
 *
 * Todo el borrador vive en ESTE componente como estado controlado y se
 * transforma solo con las funciones puras de src/lib/borrador-venta.ts. No
 * se guarda en localStorage ni en ningún otro almacenamiento (tampoco los
 * datos de tarjeta): al recargar, la venta empieza vacía.
 *
 * La confirmación envía exclusivamente { clienteId, items: [{ productoId,
 * cantidad }], pago } a POST /api/facturas. El servidor es la fuente de
 * verdad: precios, total, existencias, límite de crédito y número se deciden
 * allí. Si emite la factura, el borrador se limpia y se REEMPLAZA la entrada
 * del historial por el comprobante: volver atrás o recargar no reenvía nada.
 *
 * Atajos (sección 9, «Venta ágil»): F2 producto, F4 cliente, F8 forma de
 * pago, F9 confirmar; Escape cierra la ventana de alta rápida.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  ATAJOS,
  actualizarExistencias,
  actualizarPago,
  agregarProducto,
  aClienteVenta,
  borradorInicial,
  calcularRenglones,
  cambiarCantidad,
  cambiarFormaPago,
  construirCuerpoEmision,
  crearEnvioUnico,
  descartarVenta,
  enviarVenta,
  interpretarErrorEmision,
  quitarCliente,
  quitarRenglon,
  resolverAtajo,
  rutaComprobante,
  seleccionarCliente,
  SIN_ERRORES,
  tieneDatos,
  type BorradorVenta,
  type ErroresVenta,
} from "@/lib/borrador-venta";

import { AltaRapidaCliente } from "./alta-rapida-cliente";
import { BuscadorProductos } from "./buscador-productos";
import { FormaPago } from "./forma-pago";
import { ItemsVenta } from "./items-venta";
import { SelectorCliente } from "./selector-cliente";

type Aviso = { tipo: "ok" | "info" | "error"; texto: string } | null;

export function NuevaVenta({ proximoNumero }: { proximoNumero: string | null }) {
  const router = useRouter();
  const [borrador, setBorrador] = useState<BorradorVenta>(borradorInicial);
  const [errores, setErrores] = useState<ErroresVenta>(SIN_ERRORES);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);
  const [sesionVencida, setSesionVencida] = useState(false);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [envio] = useState(() => crearEnvioUnico(enviarVenta));

  const productoRef = useRef<HTMLInputElement>(null);
  const clienteRef = useRef<HTMLInputElement>(null);
  const pagoRef = useRef<HTMLFieldSetElement>(null);

  const renglones = calcularRenglones(borrador);
  const total = renglones.reduce((suma, r) => suma + (r.subtotal ?? 0), 0);

  /** Aplica un cambio al borrador; los errores del último intento dejan de valer. */
  function actualizar(cambio: (b: BorradorVenta) => BorradorVenta) {
    if (enviando) return;
    setBorrador(cambio);
    setErrores(SIN_ERRORES);
  }

  async function confirmar() {
    if (envio.ocupado) return; // confirmación doble
    const preparado = construirCuerpoEmision(borrador);
    if (!preparado.ok) {
      setErrores(preparado.errores);
      setAviso(null);
      return;
    }
    setErrores(SIN_ERRORES);
    setAviso({ tipo: "info", texto: "Enviando la venta…" });
    setEnviando(true);

    const resultado = await envio.ejecutar(preparado.cuerpo);
    if (resultado.estado === "ignorado") return;
    if (resultado.estado === "ok") {
      // El envío queda bloqueado: la venta ya no puede reenviarse.
      setBorrador(borradorInicial());
      setAviso({ tipo: "ok", texto: `Factura ${resultado.resultado.numeroFormateado} emitida. Abriendo el comprobante…` });
      router.replace(rutaComprobante(resultado.resultado.id));
      return;
    }
    // Error: la venta se conserva para corregirla.
    const interpretado = interpretarErrorEmision(resultado.error, borrador);
    if (interpretado.faltantes.length > 0) setBorrador((b) => actualizarExistencias(b, interpretado.faltantes));
    setErrores(interpretado);
    setSesionVencida(interpretado.sesionVencida);
    setAviso(null);
    setEnviando(false);
  }

  function descartar() {
    const nuevo = descartarVenta(borrador, (mensaje) => window.confirm(mensaje));
    if (!nuevo) return;
    setBorrador(nuevo);
    setErrores(SIN_ERRORES);
    setAviso({ tipo: "ok", texto: "Venta descartada." });
    productoRef.current?.focus();
  }

  const atenderAtajo = useEffectEvent((e: KeyboardEvent) => {
    const accion = resolverAtajo(e, { modalAbierto: altaAbierta });
    if (!accion) return;
    e.preventDefault();
    if (accion === "producto") productoRef.current?.focus();
    if (accion === "cliente") clienteRef.current?.focus();
    if (accion === "pago") pagoRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    if (accion === "confirmar") void confirmar();
  });

  useEffect(() => {
    const manejar = (e: KeyboardEvent) => atenderAtajo(e);
    window.addEventListener("keydown", manejar);
    return () => window.removeEventListener("keydown", manejar);
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Nueva venta</h1>
        <p className="text-sm">
          Próximo número: <span className="font-mono">{proximoNumero ?? "no disponible"}</span>{" "}
          <span className="text-xs text-gray-600">(informativo: el número se asigna al confirmar)</span>
        </p>
      </header>

      <p className="text-xs text-gray-600" aria-label="Atajos de teclado">
        Atajos:{" "}
        {ATAJOS.map((a) => (
          <span key={a.tecla} className="mr-3 inline-block">
            <kbd className="rounded border px-1 font-mono">{a.tecla}</kbd> {a.descripcion}
          </span>
        ))}
        <span className="inline-block">
          <kbd className="rounded border px-1 font-mono">Enter</kbd> agrega el producto seleccionado ·{" "}
          <kbd className="rounded border px-1 font-mono">Esc</kbd> cierra la ventana o la lista
        </span>
      </p>

      {aviso && (
        <p
          role={aviso.tipo === "error" ? "alert" : "status"}
          className={aviso.tipo === "error" ? "text-red-700" : aviso.tipo === "ok" ? "text-green-700" : "text-gray-700"}
        >
          {aviso.texto}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <SelectorCliente
          cliente={borrador.cliente}
          busquedaRef={clienteRef}
          error={errores.campos.clienteId}
          onSeleccionar={(c) => {
            const pierdeCuenta = borrador.pago.forma === "cuenta_corriente" && !c.cuentaCorriente;
            actualizar((b) => seleccionarCliente(b, c));
            setAviso({
              tipo: "ok",
              texto: `Cliente seleccionado: ${c.nombre}.${pierdeCuenta ? " No tiene cuenta corriente: la forma de pago volvió a Contado." : ""}`,
            });
          }}
          onQuitar={() => {
            const pierdeCuenta = borrador.pago.forma === "cuenta_corriente";
            actualizar(quitarCliente);
            setAviso({
              tipo: "ok",
              texto: `La venta vuelve a Consumidor final.${pierdeCuenta ? " La forma de pago volvió a Contado." : ""}`,
            });
          }}
          onAltaRapida={() => setAltaAbierta(true)}
        />

        <section aria-labelledby="titulo-items" className="flex flex-col gap-3 rounded border p-4">
          <h2 id="titulo-items" className="text-lg font-semibold">
            2. Ítems
          </h2>
          <BuscadorProductos
            busquedaRef={productoRef}
            onAgregar={(producto, cantidad) => {
              if (enviando) return "Espere a que termine el envío.";
              const resultado = agregarProducto(borrador, producto, cantidad);
              if (!resultado.ok) return resultado.mensaje;
              actualizar(() => resultado.borrador);
              return null;
            }}
          />
          <ItemsVenta
            renglones={renglones}
            erroresServidor={errores.productos}
            total={total}
            errorGeneral={errores.campos.items}
            onCambiarCantidad={(id, cantidad) => actualizar((b) => cambiarCantidad(b, id, cantidad))}
            onQuitar={(id) => actualizar((b) => quitarRenglon(b, id))}
          />
        </section>
      </div>

      <section aria-labelledby="titulo-pago" className="flex flex-col gap-3 rounded border p-4">
        <h2 id="titulo-pago" className="text-lg font-semibold">
          3. Forma de pago y confirmación
        </h2>
        <FormaPago
          pago={borrador.pago}
          cliente={borrador.cliente}
          total={total}
          errores={errores.campos}
          opcionesRef={pagoRef}
          onCambiarForma={(forma) => actualizar((b) => cambiarFormaPago(b, forma))}
          onActualizar={(campos) => actualizar((b) => actualizarPago(b, campos))}
        />

        {errores.general && (
          <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <p>{errores.general}</p>
            {sesionVencida && (
              <Link href="/login?desde=/ventas/nueva" className="underline">
                Iniciar sesión nuevamente
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={enviando}
            aria-keyshortcuts="F9"
            className="rounded border border-gray-800 bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {enviando ? "Confirmando…" : "Confirmar venta (F9)"}
          </button>
          <button
            type="button"
            onClick={descartar}
            disabled={enviando || !tieneDatos(borrador)}
            className="rounded border px-3 py-2 disabled:opacity-50"
          >
            Descartar venta
          </button>
          <Link href="/ventas" className="text-sm underline">
            Ver facturas
          </Link>
        </div>
      </section>

      <AltaRapidaCliente
        abierto={altaAbierta}
        onCerrar={() => {
          setAltaAbierta(false);
          clienteRef.current?.focus();
        }}
        onCreado={(cliente) => {
          actualizar((b) => seleccionarCliente(b, aClienteVenta(cliente)));
          setAltaAbierta(false);
          setAviso({ tipo: "ok", texto: `Cliente ${cliente.nombre} creado y seleccionado. La venta en curso se conservó.` });
        }}
      />
    </section>
  );
}
