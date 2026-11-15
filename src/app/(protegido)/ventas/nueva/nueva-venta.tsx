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
 * pago, F9 confirmar; Enter agrega; Escape cierra la ventana o la lista.
 *
 * Avisos: los de la venta en curso pertenecen al grupo GRUPO_AVISOS_VENTA y
 * se limpian al descartarla o emitirla; el de «Se agregó…» se cierra además
 * al quitar un ítem. Los errores de validación quedan junto a cada campo.
 */
import { CheckIcon, ClipboardListIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { avisos } from "@/lib/avisos";
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
  MENSAJE_DESCARTE,
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
import { formatearMoneda } from "@/lib/formatos";
import { ETIQUETAS_FORMA_PAGO, NOMBRE_CONSUMIDOR_FINAL } from "@/lib/validacion-facturas";

import { AltaRapidaCliente } from "./alta-rapida-cliente";
import { AVISO_AGREGADO, BuscadorProductos, GRUPO_AVISOS_VENTA } from "./buscador-productos";
import { FormaPago } from "./forma-pago";
import { ItemsVenta } from "./items-venta";
import { SeccionVenta } from "./seccion-venta";
import { SelectorCliente } from "./selector-cliente";

/** Id del aviso sobre el comprador: cada cambio reemplaza al anterior. */
const AVISO_CLIENTE = "venta-cliente";

export function NuevaVenta({ proximoNumero }: { proximoNumero: string | null }) {
  const router = useRouter();
  const [borrador, setBorrador] = useState<BorradorVenta>(borradorInicial);
  const [errores, setErrores] = useState<ErroresVenta>(SIN_ERRORES);
  const [enviando, setEnviando] = useState(false);
  const [sesionVencida, setSesionVencida] = useState(false);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [envio] = useState(() => crearEnvioUnico(enviarVenta));

  const productoRef = useRef<HTMLInputElement>(null);
  const clienteRef = useRef<HTMLInputElement>(null);
  const pagoRef = useRef<HTMLFieldSetElement>(null);

  const renglones = calcularRenglones(borrador);
  const total = renglones.reduce((suma, r) => suma + (r.subtotal ?? 0), 0);
  const cantidadItems = renglones.length;

  // Al salir de la pantalla, los avisos de la venta ya no tienen contexto.
  useEffect(() => () => avisos.limpiarGrupo(GRUPO_AVISOS_VENTA), []);

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
      return;
    }
    setErrores(SIN_ERRORES);
    setEnviando(true);

    const resultado = await envio.ejecutar(preparado.cuerpo);
    if (resultado.estado === "ignorado") return;
    if (resultado.estado === "ok") {
      // El envío queda bloqueado: la venta ya no puede reenviarse.
      setBorrador(borradorInicial());
      avisos.limpiarGrupo(GRUPO_AVISOS_VENTA);
      avisos.exito(`Factura ${resultado.resultado.numeroFormateado} emitida.`, { id: "venta-emitida" });
      router.replace(rutaComprobante(resultado.resultado.id));
      return;
    }
    // Error: la venta se conserva para corregirla (los errores quedan junto a cada campo).
    const interpretado = interpretarErrorEmision(resultado.error, borrador);
    if (interpretado.faltantes.length > 0) setBorrador((b) => actualizarExistencias(b, interpretado.faltantes));
    setErrores(interpretado);
    setSesionVencida(interpretado.sesionVencida);
    setEnviando(false);
  }

  /** «Descartar venta»: si hay datos, pide confirmación con un diálogo. */
  function pedirDescarte() {
    if (enviando) return;
    if (tieneDatos(borrador)) setConfirmandoDescarte(true);
    else descartar();
  }

  function descartar() {
    // La confirmación ya se pidió en el diálogo: descartarVenta() solo reinicia.
    const nuevo = descartarVenta(borrador, () => true);
    if (!nuevo) return;
    setBorrador(nuevo);
    setErrores(SIN_ERRORES);
    avisos.limpiarGrupo(GRUPO_AVISOS_VENTA);
    avisos.info("Venta descartada.", { id: "venta-descartada", grupo: GRUPO_AVISOS_VENTA });
  }

  const atenderAtajo = useEffectEvent((e: KeyboardEvent) => {
    const accion = resolverAtajo(e, { modalAbierto: altaAbierta || confirmandoDescarte });
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

  const botones = (
    <>
      <Button type="button" size="lg" onClick={() => void confirmar()} disabled={enviando} aria-keyshortcuts="F9">
        <CheckIcon aria-hidden />
        {enviando ? "Confirmando…" : "Confirmar venta (F9)"}
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={pedirDescarte}
        disabled={enviando || !tieneDatos(borrador)}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2Icon aria-hidden />
        Descartar venta
      </Button>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        titulo="Nueva venta"
        descripcion={
          <>
            Próximo número: <span className="font-mono text-foreground">{proximoNumero ?? "no disponible"}</span>{" "}
            <span className="text-xs">(informativo: el número se asigna al confirmar)</span>
          </>
        }
        acciones={
          <Button asChild variant="outline">
            <Link href="/ventas">
              <ClipboardListIcon aria-hidden />
              Ver facturas
            </Link>
          </Button>
        }
      />

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Atajos de teclado">
        <span className="font-medium">Atajos:</span>
        {ATAJOS.map((a) => (
          <span key={a.tecla} className="inline-flex items-center gap-1.5">
            <Kbd>{a.tecla}</Kbd> {a.descripcion}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Enter</Kbd> agrega el producto seleccionado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Esc</Kbd> cierra la ventana o la lista
        </span>
      </p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <SelectorCliente
            cliente={borrador.cliente}
            busquedaRef={clienteRef}
            error={errores.campos.clienteId}
            onSeleccionar={(c) => {
              const pierdeCuenta = borrador.pago.forma === "cuenta_corriente" && !c.cuentaCorriente;
              actualizar((b) => seleccionarCliente(b, c));
              if (pierdeCuenta) {
                avisos.advertencia(`Cliente seleccionado: ${c.nombre}. No tiene cuenta corriente: la forma de pago volvió a Contado.`, {
                  id: AVISO_CLIENTE,
                  grupo: GRUPO_AVISOS_VENTA,
                });
              } else {
                avisos.info(`Cliente seleccionado: ${c.nombre}.`, { id: AVISO_CLIENTE, grupo: GRUPO_AVISOS_VENTA });
              }
            }}
            onQuitar={() => {
              const pierdeCuenta = borrador.pago.forma === "cuenta_corriente";
              actualizar(quitarCliente);
              avisos.info(`La venta vuelve a Consumidor final.${pierdeCuenta ? " La forma de pago volvió a Contado." : ""}`, {
                id: AVISO_CLIENTE,
                grupo: GRUPO_AVISOS_VENTA,
              });
            }}
            onAltaRapida={() => setAltaAbierta(true)}
          />

          <SeccionVenta id="titulo-items" numero={2} titulo="Ítems" atajo="F2">
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
              onQuitar={(id) => {
                actualizar((b) => quitarRenglon(b, id));
                // El aviso «Se agregó…» ya no describe la venta.
                avisos.descartar(AVISO_AGREGADO);
              }}
            />
          </SeccionVenta>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20">
          <SeccionVenta id="titulo-pago" numero={3} titulo="Forma de pago y confirmación" atajo="F8">
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
              <Alert variant="destructive">
                <AlertDescription className="flex flex-col gap-1">
                  <span>{errores.general}</span>
                  {sesionVencida && (
                    <Link href="/login?desde=/ventas/nueva" className="font-medium underline">
                      Iniciar sesión nuevamente
                    </Link>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Resumen y acciones (desde 1024 px; en pantallas chicas, barra fija inferior). */}
            <div className="hidden flex-col gap-3 border-t pt-4 lg:flex">
              <Resumen total={total} cantidadItems={cantidadItems} comprador={borrador.cliente?.nombre ?? NOMBRE_CONSUMIDOR_FINAL} forma={ETIQUETAS_FORMA_PAGO[borrador.pago.forma]} />
              <div className="flex flex-col gap-2">{botones}</div>
            </div>
          </SeccionVenta>
        </div>
      </div>

      {/* Barra inferior en pantallas chicas: el total y las acciones principales siempre visibles. */}
      <Card className="sticky bottom-2 z-20 gap-0 py-3 shadow-lg lg:hidden print:hidden">
        <CardContent className="flex flex-col gap-3">
          <Resumen total={total} cantidadItems={cantidadItems} compacto />
          <div className="flex flex-wrap gap-2 [&>button]:min-w-max [&>button:first-child]:flex-1">{botones}</div>
        </CardContent>
      </Card>

      <AltaRapidaCliente
        abierto={altaAbierta}
        onCerrar={() => setAltaAbierta(false)}
        onFocoAlCerrar={() => clienteRef.current?.focus()}
        onCreado={(cliente) => {
          actualizar((b) => seleccionarCliente(b, aClienteVenta(cliente)));
          setAltaAbierta(false);
          avisos.exito(`Cliente ${cliente.nombre} creado y seleccionado. La venta en curso se conservó.`, {
            id: AVISO_CLIENTE,
            grupo: GRUPO_AVISOS_VENTA,
          });
        }}
      />

      <ConfirmDialog
        abierto={confirmandoDescarte}
        onAbiertoCambia={setConfirmandoDescarte}
        titulo="¿Descartar la venta en curso?"
        descripcion={MENSAJE_DESCARTE.replace(/^¿Desea descartar la venta en curso\? /, "")}
        textoConfirmar="Descartar venta"
        textoCancelar="Seguir con la venta"
        alConfirmar={descartar}
        onFocoAlCerrar={() => productoRef.current?.focus()}
      />
    </div>
  );
}

function Resumen({
  total,
  cantidadItems,
  comprador,
  forma,
  compacto = false,
}: {
  total: number;
  cantidadItems: number;
  comprador?: string;
  forma?: string;
  compacto?: boolean;
}) {
  const items = `${cantidadItems} ${cantidadItems === 1 ? "ítem" : "ítems"}`;
  return (
    <div className="flex flex-col gap-2">
      {!compacto && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Comprador</dt>
          <dd className="truncate text-right">{comprador}</dd>
          <dt className="text-muted-foreground">Forma de pago</dt>
          <dd className="text-right">{forma}</dd>
          <dt className="text-muted-foreground">Ítems</dt>
          <dd className="text-right tabular-nums">{cantidadItems}</dd>
        </dl>
      )}
      <div className="flex items-baseline justify-between gap-3 rounded-lg bg-primary px-4 py-3 text-primary-foreground" aria-live="polite">
        <span className="text-sm">
          Total estimado{compacto && <span className="opacity-80"> · {items}</span>}
        </span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatearMoneda(total)}</span>
      </div>
    </div>
  );
}
