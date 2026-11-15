/**
 * Ayudantes de PRUEBA para la cuenta corriente (solo bases temporales).
 *
 * El esquema exige que todo débito tenga una factura de origen
 * (movimientos_cuenta.factura_id, con clave foránea real). Como el módulo de
 * facturación todavía no existe, estas pruebas preparan una factura a cuenta
 * corriente MÍNIMA (sin renglones ni movimientos de stock) y graban su débito
 * con registrarDebito(), la misma función que usará Nueva venta.
 *
 * - La factura toma su número de la secuencia «factura» (asignarNumero).
 * - Factura y débito se graban en UNA transacción, igual que lo hará la venta.
 * - No se insertan identificadores falsos ni se desactivan claves foráneas.
 *
 * NO se usa en local.db ni en el seed: allí las deudas llegarán con las
 * ventas reales del próximo hito.
 */
import { NUMERACION } from "@/config/comercio";
import { facturas } from "@/db/schema";
import { enTransaccion } from "@/db/transaccion";
import { formatearNumeroFactura } from "@/lib/formatos";
import { registrarDebito } from "@/servicios/cuenta-corriente";
import { asignarNumero } from "@/servicios/numeracion";

export async function crearDebitoDePrueba(datos: {
  clienteId: number;
  importe: number;
  vendedorId: number;
  fecha?: Date;
}) {
  const fecha = datos.fecha ?? new Date();
  return enTransaccion(async (tx) => {
    const { puntoVenta } = NUMERACION.factura;
    const numero = await asignarNumero(tx, NUMERACION.factura);
    const [factura] = await tx
      .insert(facturas)
      .values({
        puntoVenta,
        numero,
        fecha,
        total: datos.importe,
        formaPago: "cuenta_corriente",
        clienteId: datos.clienteId,
        compradorNombre: "Comprador de prueba",
        vendedorId: datos.vendedorId,
      })
      .returning({ id: facturas.id });
    const movimiento = await registrarDebito(tx, {
      clienteId: datos.clienteId,
      importe: datos.importe,
      descripcion: `Factura ${formatearNumeroFactura(puntoVenta, numero)}`,
      facturaId: factura.id,
      fecha,
    });
    return { facturaId: factura.id, numero, ...movimiento };
  });
}
