/**
 * Servicio de pagos de cuenta corriente y recibos (RF-C5; reglas 4, 7, 8,
 * 10 y 11; sección 11.5).
 *
 * No conoce HTTP ni cookies: lo usan los Route Handlers de
 * /api/clientes/{id}/pagos y /api/pagos/{id} y las páginas de /clientes.
 *
 * Registrar un pago es UNA transacción (sección 10.2): número de recibo,
 * pago, crédito en la cuenta y saldo resultante se graban todos o ninguno.
 *
 * Concurrencia: la deuda se controla dos veces. Antes de abrir la
 * transacción, para responder rápido sin tomar el bloqueo; y otra vez DENTRO
 * de ella, que abre con BEGIN IMMEDIATE (bloqueo de escritura, ver
 * src/db/transaccion.ts). Si dos pagos de la misma deuda llegan a la vez, el
 * segundo empieza cuando el primero ya confirmó, ve el saldo actualizado y
 * responde 422 PAGO_SUPERA_DEUDA. Además registrarCredito() vuelve a impedir
 * un saldo negativo en el mismo lugar donde graba el movimiento.
 *
 * Solo servidor.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { NUMERACION } from "@/config/comercio";
import { db } from "@/db";
import { clientes, pagos, usuarios, type MedioPago } from "@/db/schema";
import { enTransaccion, type Conexion } from "@/db/transaccion";
import { ApiError } from "@/lib/api-error";
import { formatearNumeroRecibo } from "@/lib/formatos";
import { esquemaAltaPago, esquemaParametrosCliente, esquemaParametrosPago } from "@/lib/validacion-pagos";

import type { UsuarioAutenticado } from "./auth";
import { exigirClienteDeCuenta, obtenerSaldo, registrarCredito, type ClienteDeCuenta } from "./cuenta-corriente";
import { asignarNumero } from "./numeracion";
import { exigirRol } from "./permisos";

// ---------------------------------------------------------------------------
// Representación pública (sección 11.5)
// ---------------------------------------------------------------------------

export type PagoPublico = {
  id: number;
  numeroRecibo: string; // "R 0001-00000341"
  fecha: string; // ISO 8601 UTC
  cliente: { id: number; nombre: string };
  importe: number; // centavos
  medio: MedioPago;
  observacion: string | null;
  usuario: { id: number; nombre: string };
  /** Saldo del cliente inmediatamente después de este pago (histórico, decisión C7). */
  saldoCliente: number;
};

/** Lee un pago con su cliente y su usuario y lo lleva a la forma pública. */
async function buscarPago(conexion: Conexion, id: number): Promise<PagoPublico | null> {
  const [fila] = await conexion
    .select({
      id: pagos.id,
      puntoVenta: pagos.puntoVenta,
      numero: pagos.numero,
      fecha: pagos.fecha,
      clienteId: clientes.id,
      clienteNombre: clientes.nombre,
      importe: pagos.importe,
      medio: pagos.medio,
      observacion: pagos.observacion,
      usuarioId: usuarios.id,
      usuarioNombre: usuarios.nombre,
      saldoResultante: pagos.saldoResultante,
    })
    .from(pagos)
    .innerJoin(clientes, eq(pagos.clienteId, clientes.id))
    .innerJoin(usuarios, eq(pagos.usuarioId, usuarios.id))
    .where(eq(pagos.id, id))
    .limit(1);
  if (!fila) return null;

  // Lista blanca de campos públicos.
  return {
    id: fila.id,
    numeroRecibo: formatearNumeroRecibo(fila.puntoVenta, fila.numero),
    fecha: fila.fecha.toISOString(),
    cliente: { id: fila.clienteId, nombre: fila.clienteNombre },
    importe: fila.importe,
    medio: fila.medio,
    observacion: fila.observacion,
    usuario: { id: fila.usuarioId, nombre: fila.usuarioNombre },
    // Decisión C7: el valor GUARDADO al registrar el pago, no el saldo de hoy.
    saldoCliente: fila.saldoResultante,
  };
}

// ---------------------------------------------------------------------------
// Reglas del pago
// ---------------------------------------------------------------------------

/**
 * Pasos 3 a 6 del registro: cliente existente y activo, con cuenta corriente
 * habilitada y con deuda que cubra el importe. Devuelve el cliente y su deuda.
 * - inexistente → 404; inactivo → 404 al vendedor, 422 al administrador;
 * - sin cuenta corriente → 422 CUENTA_CORRIENTE_NO_HABILITADA;
 * - sin deuda o importe mayor que la deuda → 422 PAGO_SUPERA_DEUDA (regla 8).
 */
async function verificarPagoAdmisible(
  conexion: Conexion,
  usuario: UsuarioAutenticado,
  clienteId: number,
  importe: number,
): Promise<{ cliente: ClienteDeCuenta; deuda: number }> {
  // 3. Cliente existente y activo.
  const cliente = await exigirClienteDeCuenta(conexion, usuario, clienteId);
  // 4. Cuenta corriente habilitada.
  if (!cliente.cuentaCorriente) throw ApiError.desdeCodigo("CUENTA_CORRIENTE_NO_HABILITADA");
  // 5. Deuda = saldo actual (regla 7: débitos − créditos).
  const deuda = await obtenerSaldo(conexion, clienteId);
  // 6. Regla 8: el pago no supera la deuda; no hay saldos a favor.
  if (deuda <= 0) {
    throw ApiError.desdeCodigo("PAGO_SUPERA_DEUDA", "El cliente no tiene deuda pendiente.", {
      saldoActual: deuda,
      importe,
    });
  }
  if (importe > deuda) {
    throw ApiError.desdeCodigo(
      "PAGO_SUPERA_DEUDA",
      "El importe del pago supera el saldo adeudado.",
      { saldoActual: deuda, importe, excedente: importe - deuda },
    );
  }
  return { cliente, deuda };
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

/**
 * RF-C5: registra un pago a cuenta y emite su recibo. Ambos roles.
 *
 * Recibe el usuario autenticado, los parámetros de la ruta `{ id }` (el
 * cliente) y el cuerpo SIN validar `{ importe, medio, observacion? }`.
 * Responde el pago público con `saldoCliente` = saldo después del pago.
 *
 * Errores: 422 VALIDACION, 401/403, 404 NO_ENCONTRADO,
 * 422 CUENTA_CORRIENTE_NO_HABILITADA, 422 PAGO_SUPERA_DEUDA. Si cualquier
 * paso falla, no queda pago, ni movimiento, ni número consumido.
 */
export async function registrarPago(
  usuario: UsuarioAutenticado,
  parametros: unknown,
  datos: unknown,
): Promise<PagoPublico> {
  // 1. Validar (importe entero > 0 en centavos, medio permitido, sin campos extra).
  const { id: clienteId } = esquemaParametrosCliente.parse(parametros);
  const entrada = esquemaAltaPago.parse(datos);
  // 2. Sesión y permiso: ambos roles (sección 3).
  exigirRol(usuario, "admin", "vendedor");
  // 3-6. Control previo, sin tomar el bloqueo de escritura (respuesta rápida).
  await verificarPagoAdmisible(db, usuario, clienteId, entrada.importe);

  // 7. Transacción: todo o nada.
  const pagoId = await enTransaccion(async (tx) => {
    // 3-6 otra vez, ahora con el bloqueo de escritura tomado: es el control
    // que vale ante pagos simultáneos (regla 8).
    const { deuda } = await verificarPagoAdmisible(tx, usuario, clienteId, entrada.importe);

    // 8. Número de recibo (regla 4), dentro de esta transacción.
    const { puntoVenta } = NUMERACION.recibo;
    const numero = await asignarNumero(tx, NUMERACION.recibo);

    // 9. Pago, con usuario y fecha (regla 11). El saldo resultante se graba
    // primero con el valor esperado y en el paso 12 con el recalculado.
    const [pago] = await tx
      .insert(pagos)
      .values({
        puntoVenta,
        numero,
        clienteId,
        importe: entrada.importe,
        medio: entrada.medio,
        observacion: entrada.observacion ?? null,
        usuarioId: usuario.id,
        saldoResultante: deuda - entrada.importe,
      })
      .returning({ id: pagos.id, fecha: pagos.fecha });

    // 10. Crédito en la cuenta corriente (regla 7), con la misma fecha del pago.
    await registrarCredito(tx, {
      clienteId,
      importe: entrada.importe,
      descripcion: `Recibo ${formatearNumeroRecibo(puntoVenta, numero)}`,
      origen: { pagoId: pago.id },
      fecha: pago.fecha,
    });

    // 11. Saldo resultante, desde la única fuente: los movimientos.
    const saldoResultante = await obtenerSaldo(tx, clienteId);

    // 12. Se congela en el pago para reimprimir el recibo (decisión C7).
    await tx.update(pagos).set({ saldoResultante }).where(eq(pagos.id, pago.id));

    return pago.id;
  });

  // 13. Forma pública.
  return (await buscarPago(db, pagoId))!;
}

/**
 * RF-C5: un pago por id, para reimprimir su recibo. Ambos roles.
 * `saldoCliente` es el saldo HISTÓRICO guardado al registrarlo; pagos o
 * ventas posteriores no lo modifican. Inexistente → 404 NO_ENCONTRADO.
 */
export async function obtenerPago(usuario: UsuarioAutenticado, parametros: unknown): Promise<PagoPublico> {
  // 1. Validar.
  const { id } = esquemaParametrosPago.parse(parametros);
  // 2. Permiso.
  exigirRol(usuario, "admin", "vendedor");
  // 3-5. Base y forma pública.
  const pago = await buscarPago(db, id);
  if (!pago) throw ApiError.desdeCodigo("NO_ENCONTRADO", "El pago no existe.");
  return pago;
}
