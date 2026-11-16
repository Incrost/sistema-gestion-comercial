"use client";

/**
 * Renglones de Nueva venta (RF-V3, RF-V4): código, descripción, cantidad
 * editable, precio unitario y subtotal INFORMATIVOS, existencia y quitar.
 * Los importes y la validez de cada cantidad llegan ya calculados por
 * calcularRenglones() (src/lib/borrador-venta.ts).
 *
 * Una sola lista que se adapta: desde 768 px se ve como tabla (con fila de
 * encabezados); en pantallas chicas, cada ítem es una tarjeta. No hay
 * controles duplicados.
 *
 * En modo tabla, la descripción es la única columna flexible y tiene un ancho
 * mínimo; las demás tienen anchos fijos que alcanzan para su encabezado y su
 * contenido. Si el espacio no alcanza, la tabla se desplaza horizontalmente
 * dentro de su propio marco: nunca se comprime la descripción hasta volverla
 * ilegible ni se desborda la página.
 */
import { PackageOpenIcon, Trash2Icon } from "lucide-react";

import { ErrorCampo } from "@/components/formularios/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cantidadMaxima, type RenglonCalculado } from "@/lib/borrador-venta";
import { formatearMoneda } from "@/lib/formatos";
import { cn } from "@/lib/utils";

type Props = {
  renglones: RenglonCalculado[];
  /** Errores informados por el servidor, por productoId. */
  erroresServidor: Record<number, string>;
  total: number;
  errorGeneral?: string;
  onCambiarCantidad: (productoId: number, cantidad: string) => void;
  onQuitar: (productoId: number) => void;
};

/**
 * Columnas compartidas por el encabezado y los renglones (desde 768 px):
 * código, descripción (flexible, mínimo 7,5rem), cantidad, precio unitario,
 * subtotal, existencia y quitar.
 */
export const COLUMNAS_ITEMS = "md:grid-cols-[4.5rem_minmax(7.5rem,1fr)_4.5rem_6.5rem_7rem_5rem_2rem]";
const COLUMNAS = `md:grid ${COLUMNAS_ITEMS} md:items-center md:gap-x-2`;

/**
 * Ancho mínimo de la tabla: las columnas (37rem), los seis espacios entre
 * ellas (3rem) y el relleno lateral de cada fila (1,5rem). Por debajo de él,
 * la tabla se desplaza dentro de su marco.
 */
export const ANCHO_MINIMO_TABLA = "md:min-w-[41.5rem]";

/**
 * Hasta 1440 px, el total y las acciones van en una barra fija inferior: al
 * enfocar o desplazar un renglón, este margen lo deja por encima de la barra.
 */
export const MARGEN_BARRA = "scroll-mb-56 min-[90rem]:scroll-mb-0";

export function ItemsVenta({ renglones, erroresServidor, total, errorGeneral, onCambiarCantidad, onQuitar }: Props) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {renglones.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
          <PackageOpenIcon aria-hidden className="size-6" />
          <p>Todavía no hay productos en la venta. Use la búsqueda (F2) para agregarlos.</p>
        </div>
      ) : (
        <div data-slot="marco-items" className="min-w-0 overflow-hidden rounded-lg border md:overflow-x-auto">
          <div role="table" aria-label="Ítems de la venta" className={cn("flex flex-col", ANCHO_MINIMO_TABLA)}>
            <div role="rowgroup" className="hidden md:block">
              <div role="row" className={cn(COLUMNAS, "border-b bg-muted/60 px-3 py-2 text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase")}>
                <span role="columnheader">Código</span>
                <span role="columnheader">Descripción</span>
                <span role="columnheader">Cantidad</span>
                <span role="columnheader" className="text-right">Precio unit.</span>
                <span role="columnheader" className="text-right">Subtotal</span>
                <span role="columnheader" className="text-right">Existencia</span>
                <span role="columnheader">
                  <span className="sr-only">Acciones</span>
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {renglones.map(({ renglon, error, subtotal }) => {
                const { producto } = renglon;
                const mensaje = error ?? erroresServidor[producto.id];
                const idError = `error-renglon-${producto.id}`;
                return (
                  <div
                    key={producto.id}
                    role="row"
                    className={cn(
                      COLUMNAS,
                      MARGEN_BARRA,
                      "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b px-3 py-3 last:border-b-0",
                      mensaje && "bg-destructive/5",
                    )}
                  >
                    <span role="cell" className="order-1 font-mono text-xs text-muted-foreground md:order-none">
                      {producto.codigo}
                    </span>
                    <span role="cell" className="order-3 col-span-2 min-w-0 font-medium break-words md:order-none md:col-span-1">
                      {producto.descripcion}
                      {mensaje && (
                        <ErrorCampo id={idError} className="mt-1">
                          {mensaje}
                        </ErrorCampo>
                      )}
                    </span>
                    <span role="cell" className="order-4 md:order-none">
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        max={cantidadMaxima(producto)}
                        inputMode="numeric"
                        value={renglon.cantidad}
                        onChange={(e) => onCambiarCantidad(producto.id, e.target.value)}
                        aria-label={`Cantidad de ${producto.descripcion}`}
                        aria-invalid={mensaje ? true : undefined}
                        aria-describedby={mensaje ? idError : undefined}
                        className={cn("h-8 w-24 tabular-nums md:w-full", MARGEN_BARRA)}
                      />
                    </span>
                    <span role="cell" className="order-6 col-span-2 text-xs text-muted-foreground tabular-nums md:order-none md:col-span-1 md:text-right md:text-sm md:text-foreground">
                      <span className="md:hidden">Precio unit.: </span>
                      {formatearMoneda(producto.precio)}
                    </span>
                    <span role="cell" className="order-5 self-center text-right font-semibold tabular-nums md:order-none">
                      {subtotal === null ? "—" : formatearMoneda(subtotal)}
                    </span>
                    <span role="cell" className="order-7 col-span-2 text-xs text-muted-foreground tabular-nums md:order-none md:col-span-1 md:text-right md:text-sm md:text-foreground">
                      <span className="md:hidden">Existencia: </span>
                      {producto.existencia}
                    </span>
                    <span role="cell" className="order-2 justify-self-end md:order-none">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onQuitar(producto.id)}
                        aria-label={`Quitar ${producto.descripcion}`}
                        className={cn("text-muted-foreground hover:bg-destructive/10 hover:text-destructive", MARGEN_BARRA)}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {errorGeneral && <ErrorCampo>{errorGeneral}</ErrorCampo>}
      <div className="flex flex-col items-end gap-0.5 text-right">
        <p className="text-base">
          Total estimado: <strong>{formatearMoneda(total)}</strong>
        </p>
        <p className="text-xs text-muted-foreground">Precios e importes informativos: el servidor los recalcula con el catálogo al confirmar.</p>
      </div>
    </div>
  );
}
