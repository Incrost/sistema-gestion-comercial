"use client";

/**
 * Renglones de Nueva venta (RF-V3, RF-V4): código, descripción, cantidad
 * editable, precio unitario y subtotal INFORMATIVOS, existencia y quitar.
 * Los importes y la validez de cada cantidad llegan ya calculados por
 * calcularRenglones() (src/lib/borrador-venta.ts).
 */
import { cantidadMaxima, type RenglonCalculado } from "@/lib/borrador-venta";
import { formatearMoneda } from "@/lib/formatos";

type Props = {
  renglones: RenglonCalculado[];
  /** Errores informados por el servidor, por productoId. */
  erroresServidor: Record<number, string>;
  total: number;
  errorGeneral?: string;
  onCambiarCantidad: (productoId: number, cantidad: string) => void;
  onQuitar: (productoId: number) => void;
};

export function ItemsVenta({ renglones, erroresServidor, total, errorGeneral, onCambiarCantidad, onQuitar }: Props) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {renglones.length === 0 ? (
        <p className="rounded border border-dashed p-3 text-gray-600">
          Todavía no hay productos en la venta. Use la búsqueda (F2) para agregarlos.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">Código</th>
                <th className="py-1 pr-2">Descripción</th>
                <th className="py-1 pr-2">Cantidad</th>
                <th className="py-1 pr-2 text-right">Precio unit.</th>
                <th className="py-1 pr-2 text-right">Subtotal</th>
                <th className="py-1 pr-2 text-right">Existencia</th>
                <th className="py-1">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {renglones.map(({ renglon, error, subtotal }) => {
                const { producto } = renglon;
                const mensaje = error ?? erroresServidor[producto.id];
                const idError = `error-renglon-${producto.id}`;
                return (
                  <tr key={producto.id} className="border-b align-top">
                    <td className="py-1 pr-2 font-mono">{producto.codigo}</td>
                    <td className="py-1 pr-2">
                      {producto.descripcion}
                      {mensaje && (
                        <span id={idError} role="alert" className="block text-red-700">
                          {mensaje}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input
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
                        className={`w-20 rounded border px-2 py-0.5 ${mensaje ? "border-red-600" : ""}`}
                      />
                    </td>
                    <td className="py-1 pr-2 text-right">{formatearMoneda(producto.precio)}</td>
                    <td className="py-1 pr-2 text-right">{subtotal === null ? "—" : formatearMoneda(subtotal)}</td>
                    <td className="py-1 pr-2 text-right">{producto.existencia}</td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() => onQuitar(producto.id)}
                        aria-label={`Quitar ${producto.descripcion}`}
                        className="rounded border px-2 py-0.5"
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {errorGeneral && (
        <p role="alert" className="text-red-700">
          {errorGeneral}
        </p>
      )}
      <p className="text-right text-base">
        Total estimado: <strong>{formatearMoneda(total)}</strong>
        <span className="block text-xs text-gray-600">
          Precios e importes informativos: el servidor los recalcula con el catálogo al confirmar.
        </span>
      </p>
    </div>
  );
}
