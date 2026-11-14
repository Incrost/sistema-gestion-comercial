/**
 * Datos iniciales: clientes académicos (sección 8, «Datos de prueba»: al
 * menos 10 clientes; RF-C2, RF-C7).
 *
 * Todos los datos son FICTICIOS: nombres inventados, domicilios genéricos,
 * emails con el dominio reservado `.test` y documentos que no corresponden a
 * personas reales.
 *
 * Se crean con los MISMOS servicios que usa la aplicación (crearCliente y,
 * para la baja lógica, actualizarCliente), así pasan por las mismas
 * validaciones y normalización del documento.
 *
 * En esta etapa NO se crean movimientos de cuenta, pagos ni facturas: todos
 * los saldos quedan en 0. Las deudas de ejemplo llegarán con las ventas a
 * cuenta corriente del seed de facturas.
 *
 * Idempotente: un cliente se busca por tipo y número normalizado de
 * documento; si ya existe NO se vuelve a crear ni se modifica.
 *
 * Solo servidor (lo usa scripts/seed.ts).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes, type TipoDocumento } from "@/db/schema";
import { normalizarDocumento } from "@/lib/normalizacion";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { actualizarCliente, crearCliente } from "@/servicios/clientes";

type ClienteSemilla = {
  tipoDoc: TipoDocumento;
  nroDoc: string;
  nombre: string;
  domicilio?: string;
  telefono?: string;
  email?: string;
  cuentaCorriente?: boolean;
  /** Centavos (regla 10): 40000000 = $ 400.000,00. */
  limiteCredito?: number | null;
  /** Se da de baja lógica después del alta. */
  activo?: false;
};

/**
 * 12 clientes variados: DNI y CUIT, con y sin datos opcionales, con y sin
 * cuenta corriente, con y sin límite, y uno dado de baja.
 */
export const CLIENTES_SEMILLA: readonly ClienteSemilla[] = [
  {
    tipoDoc: "DNI", nroDoc: "28.456.123", nombre: "Mariana López (ficticia)",
    domicilio: "Las Heras 455", telefono: "381 455-2210", email: "mariana.lopez@correo.test",
    cuentaCorriente: true, limiteCredito: 40000000,
  },
  {
    tipoDoc: "DNI", nroDoc: "31.204.587", nombre: "Julián Ferreyra (ficticio)",
    domicilio: "San Martín 1020", telefono: "381 600-1122",
    cuentaCorriente: true, limiteCredito: 15000000,
  },
  {
    tipoDoc: "CUIT", nroDoc: "30-71000001-1", nombre: "Construcciones del Norte SRL (ficticia)",
    domicilio: "Ruta 9 km 1300", telefono: "381 422-0000", email: "compras@construcciones.test",
    cuentaCorriente: true, limiteCredito: 150000000,
  },
  {
    tipoDoc: "DNI", nroDoc: "25.890.334", nombre: "Rosa Medina (ficticia)",
    telefono: "381 512-3344", cuentaCorriente: true,
  },
  {
    tipoDoc: "CUIT", nroDoc: "20-33100200-5", nombre: "Pablo Sosa Electricidad (ficticio)",
    email: "pablo.sosa@correo.test", cuentaCorriente: true, limiteCredito: 8000000,
  },
  { tipoDoc: "DNI", nroDoc: "40.112.908", nombre: "Lucía Barrionuevo (ficticia)", email: "lucia.b@correo.test" },
  { tipoDoc: "DNI", nroDoc: "7.654.321", nombre: "Héctor Ruiz (ficticio)", domicilio: "Córdoba 233" },
  {
    tipoDoc: "CUIT", nroDoc: "27-29555111-0", nombre: "Carla Núñez Pinturas (ficticia)",
    domicilio: "Av. Mate de Luna 3100", telefono: "381 433-9090",
  },
  { tipoDoc: "DNI", nroDoc: "35.778.002", nombre: "Diego Albornoz (ficticio)" },
  {
    tipoDoc: "CUIT", nroDoc: "30-71000002-0", nombre: "Escuela Técnica Modelo (ficticia)",
    domicilio: "Belgrano 800", email: "administracion@escuela.test", cuentaCorriente: true,
  },
  {
    tipoDoc: "DNI", nroDoc: "22.345.876", nombre: "Marta Quiroga (ficticia)",
    domicilio: "Junín 55", telefono: "381 400-7788", cuentaCorriente: true, limiteCredito: 5000000,
  },
  {
    tipoDoc: "DNI", nroDoc: "18.900.100", nombre: "Ernesto Paz (ficticio, dado de baja)",
    domicilio: "Mendoza 1400", activo: false,
  },
];

export type ResultadoSemillaClientes = { clientesCreados: number; clientesExistentes: number };

async function existeCliente(tipoDoc: TipoDocumento, nroDoc: string): Promise<boolean> {
  const [fila] = await db
    .select({ id: clientes.id })
    .from(clientes)
    .where(and(eq(clientes.tipoDoc, tipoDoc), eq(clientes.nroDocNormalizado, normalizarDocumento(nroDoc))))
    .limit(1);
  return fila !== undefined;
}

/** Crea los clientes académicos que falten, a nombre del administrador indicado. */
export async function sembrarClientes(admin: UsuarioAutenticado): Promise<ResultadoSemillaClientes> {
  const resultado: ResultadoSemillaClientes = { clientesCreados: 0, clientesExistentes: 0 };

  for (const { activo, ...datos } of CLIENTES_SEMILLA) {
    if (await existeCliente(datos.tipoDoc, datos.nroDoc)) {
      resultado.clientesExistentes++;
      continue;
    }
    const cliente = await crearCliente(admin, datos);
    resultado.clientesCreados++;
    // Baja lógica (RF-C7): conserva el registro. Saldo 0, así que se permite.
    if (activo === false) await actualizarCliente(admin, { id: String(cliente.id) }, { activo: false });
  }

  return resultado;
}
