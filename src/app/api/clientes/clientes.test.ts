/**
 * Pruebas de integración de /api/clientes y /api/clientes/{id}
 * (RF-C1, RF-C2, RF-C3, RF-C6, RF-C7; sección 11.5).
 *
 * Se llama a cada Route Handler con un NextRequest, igual que Next.js, contra
 * una base SQLite temporal (no toca local.db ni Turso).
 *
 * Como en esta etapa todavía no existen ventas ni pagos, las pruebas de saldo
 * insertan directamente facturas, pagos y movimientos_cuenta en la base de
 * prueba: así se verifica que el saldo SALE de los movimientos (regla 7).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, getTableColumns } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import * as moduloDb from "@/db";
import { db } from "@/db";
import { clientes, facturas, movimientosCuenta, pagos } from "@/db/schema";
import { firmarSesion } from "@/lib/sesion-token";
import { exigirClienteActivo, type ClientePublico, type FichaCliente } from "@/servicios/clientes";
import { conId, esperarError, esperarJson, pedido, sinParametros } from "@/test/api";
import { crearUsuarioDePrueba, type ModuloDbPrueba } from "@/test/base-de-prueba";

import * as rutaUsuarioId from "../usuarios/[id]/route";
import * as rutaId from "./[id]/route";
import * as rutaClientes from "./route";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

type Lista<T> = { data: T[]; page: number; pageSize: number; total: number; totalAdeudado?: number };

let cookieAdmin: string;
let cookieVendedor: string;
let adminId: number;

beforeAll(async () => {
  const admin = await crearUsuarioDePrueba(db, { email: "admin@prueba.test", password: "clave-prueba-1", rol: "admin" });
  const vendedor = await crearUsuarioDePrueba(db, { email: "vende@prueba.test", password: "clave-prueba-1", rol: "vendedor" });
  adminId = admin.id;
  cookieAdmin = await firmarSesion(admin.id);
  cookieVendedor = await firmarSesion(vendedor.id);
});

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

const listar = (cookie: string | undefined, consulta = "") =>
  rutaClientes.GET(pedido(`/api/clientes${consulta}`, { cookie }), sinParametros);
const crear = (cookie: string | undefined, cuerpo: object | string) =>
  rutaClientes.POST(pedido("/api/clientes", { metodo: "POST", cookie, cuerpo }), sinParametros);
const obtener = (cookie: string | undefined, id: number | string) =>
  rutaId.GET(pedido(`/api/clientes/${id}`, { cookie }), conId(id));
const editar = (cookie: string | undefined, id: number | string, cuerpo: object | string) =>
  rutaId.PATCH(pedido(`/api/clientes/${id}`, { metodo: "PATCH", cookie, cuerpo }), conId(id));

let siguienteDni = 30_000_000;
/** Alta por la API con datos mínimos válidos (DNI único) más los indicados. */
async function altaCliente(datos: Record<string, unknown> = {}, cookie = cookieAdmin) {
  return esperarJson<ClientePublico>(
    await crear(cookie, { tipoDoc: "DNI", nroDoc: String(++siguienteDni), nombre: `Cliente ${siguienteDni}`, ...datos }),
    201,
  );
}

let numeroFactura = 0;
/** Factura a cuenta corriente + su débito (lo que hará Nueva venta). */
async function registrarDebito(clienteId: number, importe: number, fecha = new Date()) {
  const [factura] = await db
    .insert(facturas)
    .values({
      puntoVenta: 1,
      numero: ++numeroFactura,
      fecha,
      total: importe,
      formaPago: "cuenta_corriente",
      clienteId,
      compradorNombre: "Comprador de prueba",
      vendedorId: adminId,
    })
    .returning();
  await db.insert(movimientosCuenta).values({
    clienteId,
    tipo: "debito",
    importe,
    fecha,
    descripcion: `Factura ${factura.numero}`,
    facturaId: factura.id,
  });
  return factura;
}

let numeroRecibo = 0;
/** Pago + su crédito (lo que hará el registro de pagos). */
async function registrarCredito(clienteId: number, importe: number) {
  const [pago] = await db
    .insert(pagos)
    .values({ puntoVenta: 1, numero: ++numeroRecibo, clienteId, importe, medio: "efectivo", usuarioId: adminId, saldoResultante: 0 })
    .returning();
  await db.insert(movimientosCuenta).values({
    clienteId,
    tipo: "credito",
    importe,
    descripcion: `Recibo ${pago.numero}`,
    pagoId: pago.id,
  });
}

const CLAVES_CLIENTE = [
  "id", "tipoDoc", "nroDoc", "nombre", "domicilio", "telefono", "email",
  "cuentaCorriente", "limiteCredito", "saldo", "disponible", "activo",
].sort();

// ---------------------------------------------------------------------------
// Alta — RF-C2
// ---------------------------------------------------------------------------

describe("POST /api/clientes", () => {
  it("alta con DNI: 201, activo, saldo 0, número visible y normalizado", async () => {
    const c = await esperarJson<ClientePublico>(
      await crear(cookieAdmin, {
        tipoDoc: "DNI",
        nroDoc: "28 456 123",
        nombre: "  Mariana   López ",
        domicilio: " Las Heras 455 ",
        telefono: " 381 455-2210 ",
        email: " Mariana.Lopez@Correo.TEST ",
        cuentaCorriente: true,
        limiteCredito: 40000000,
      }),
      201,
    );
    expect(Object.keys(c).sort()).toEqual(CLAVES_CLIENTE);
    expect(c).toMatchObject({
      tipoDoc: "DNI",
      nroDoc: "28.456.123",
      nombre: "Mariana López",
      domicilio: "Las Heras 455",
      telefono: "381 455-2210",
      email: "mariana.lopez@correo.test",
      cuentaCorriente: true,
      limiteCredito: 40000000,
      saldo: 0,
      disponible: 40000000,
      activo: true,
    });
    const [fila] = await db.select().from(clientes).where(eq(clientes.id, c.id));
    expect(fila.nroDoc).toBe("28.456.123");
    expect(fila.nroDocNormalizado).toBe("28456123");
  });

  it("alta con CUIT: guarda el número con guiones y el normalizado de 11 dígitos", async () => {
    const c = await esperarJson<ClientePublico>(
      await crear(cookieVendedor, { tipoDoc: "CUIT", nroDoc: "30712345678", nombre: "Constructora Ficticia SRL" }),
      201,
    );
    expect(c).toMatchObject({ tipoDoc: "CUIT", nroDoc: "30-71234567-8", cuentaCorriente: false, limiteCredito: null, disponible: null, saldo: 0 });
    const [fila] = await db.select().from(clientes).where(eq(clientes.id, c.id));
    expect(fila.nroDocNormalizado).toBe("30712345678");
  });

  it("opcionales vacíos o ausentes se guardan como null", async () => {
    const c = await altaCliente({ domicilio: "   ", telefono: "", email: "" });
    expect(c).toMatchObject({ domicilio: null, telefono: null, email: null, cuentaCorriente: false, limiteCredito: null });
  });

  it("documento repetido (aun con otro formato) → 409 DOCUMENTO_DUPLICADO; otro tipo con los mismos dígitos no choca", async () => {
    await altaCliente({ nroDoc: "22.333.444" });
    const r = await esperarError(await crear(cookieAdmin, { tipoDoc: "DNI", nroDoc: "22333444", nombre: "Otro" }), 409, "DOCUMENTO_DUPLICADO");
    expect(r.error.details).toEqual([{ campo: "nroDoc", mensaje: expect.any(String) }]);
    await esperarError(await crear(cookieVendedor, { tipoDoc: "DNI", nroDoc: "22-333-444", nombre: "Otro" }), 409, "DOCUMENTO_DUPLICADO");
    // Mismo número con otro tipo: el índice único es (número, tipo).
    await altaCliente({ tipoDoc: "CUIT", nroDoc: "20-22333444-9" });
  });

  it.each([
    ["DNI corto", { tipoDoc: "DNI", nroDoc: "12345" }, "nroDoc"],
    ["DNI largo", { tipoDoc: "DNI", nroDoc: "123456789" }, "nroDoc"],
    ["DNI con letras", { tipoDoc: "DNI", nroDoc: "28A456123" }, "nroDoc"],
    ["CUIT de 10 dígitos", { tipoDoc: "CUIT", nroDoc: "20-2845612-4" }, "nroDoc"],
    ["CUIT de 12 dígitos", { tipoDoc: "CUIT", nroDoc: "202845612345" }, "nroDoc"],
    ["tipo inválido", { tipoDoc: "LE", nroDoc: "12345678" }, "tipoDoc"],
    ["email inválido", { tipoDoc: "DNI", nroDoc: "11222333", email: "no-es-email" }, "email"],
    ["límite con decimales", { tipoDoc: "DNI", nroDoc: "11222333", cuentaCorriente: true, limiteCredito: 100.5 }, "limiteCredito"],
    ["límite negativo", { tipoDoc: "DNI", nroDoc: "11222333", cuentaCorriente: true, limiteCredito: -1 }, "limiteCredito"],
    ["límite sin cuenta corriente", { tipoDoc: "DNI", nroDoc: "11222333", limiteCredito: 1000 }, "limiteCredito"],
    ["límite con cuenta corriente false", { tipoDoc: "DNI", nroDoc: "11222333", cuentaCorriente: false, limiteCredito: 1000 }, "limiteCredito"],
    ["nombre vacío", { tipoDoc: "DNI", nroDoc: "11222333", nombre: "   " }, "nombre"],
  ])("%s → 422 VALIDACION en %s", async (_caso, datos, campo) => {
    const r = await esperarError(await crear(cookieAdmin, { nombre: "Válido", ...datos }), 422, "VALIDACION");
    expect((r.error.details as { campo: string }[]).map((d) => d.campo)).toContain(campo);
  });

  it.each(["saldo", "disponible", "activo", "nroDocNormalizado", "otroCampo"])(
    "rechaza el campo %s con 422 VALIDACION sin crear nada",
    async (campo) => {
      const antes = (await db.select().from(clientes)).length;
      const r = await esperarError(
        await crear(cookieAdmin, { tipoDoc: "DNI", nroDoc: "44555666", nombre: "Con extra", [campo]: campo === "activo" ? false : 0 }),
        422,
        "VALIDACION",
      );
      expect((r.error.details as { campo: string }[]).map((d) => d.campo)).toContain(campo);
      expect((await db.select().from(clientes)).length).toBe(antes);
    },
  );

  it("límite null con cuenta corriente: sin límite y disponible null", async () => {
    const c = await altaCliente({ cuentaCorriente: true, limiteCredito: null });
    expect(c).toMatchObject({ cuentaCorriente: true, limiteCredito: null, disponible: null });
  });

  it("JSON inválido → 400 JSON_INVALIDO", async () => {
    await esperarError(await crear(cookieAdmin, "{roto"), 400, "JSON_INVALIDO");
  });
});

// ---------------------------------------------------------------------------
// Listado y búsqueda — RF-C1
// ---------------------------------------------------------------------------

describe("GET /api/clientes", () => {
  let mariana: ClientePublico;
  let inactivo: ClientePublico;

  beforeAll(async () => {
    mariana = await altaCliente({ nroDoc: "27.111.222", nombre: "Zulema Búsqueda Única" });
    await altaCliente({ tipoDoc: "CUIT", nroDoc: "20-27111999-3", nombre: "Zulema Segunda" });
    inactivo = await altaCliente({ nroDoc: "27111888", nombre: "Zulema Dada de Baja" });
    await esperarJson(await editar(cookieAdmin, inactivo.id, { activo: false }), 200);
  });

  it("responde { data, page, pageSize, total } con la forma pública", async () => {
    const lista = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor), 200);
    expect(Object.keys(lista).sort()).toEqual(["data", "page", "pageSize", "total"]);
    expect(lista).toMatchObject({ page: 1, pageSize: 20 });
    expect(Object.keys(lista.data[0]).sort()).toEqual(CLAVES_CLIENTE);
    expect("totalAdeudado" in lista).toBe(false);
  });

  it("pagina y ordena por nombre", async () => {
    const total = (await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin), 200)).total;
    expect(total).toBeGreaterThan(4);
    const p1 = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?page=1&pageSize=2"), 200);
    const p2 = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?page=2&pageSize=2"), 200);
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total });
    expect(p1.data).toHaveLength(2);
    expect(p2.data).toHaveLength(2);
    expect(p1.data.map((c) => c.id)).not.toContain(p2.data[0].id);
    const todos = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?pageSize=100"), 200);
    const nombres = todos.data.map((c) => c.nombre);
    expect(nombres).toEqual([...nombres].sort());
  });

  it("busca por nombre sin distinguir mayúsculas", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, "?q=zulema"), 200);
    expect(r.data.map((c) => c.nombre)).toEqual(["Zulema Búsqueda Única", "Zulema Segunda"]);
    const unico = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, `?q=${encodeURIComponent("ZULEMA  Búsqueda")}`), 200);
    expect(unico.data.map((c) => c.id)).toEqual([mariana.id]);
  });

  it.each(["27111222", "27.111.222", "27 111 222", "27-111-222", "111.22"])(
    "busca por documento con o sin formato: %s",
    async (q) => {
      const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, `?q=${encodeURIComponent(q)}`), 200);
      expect(r.data.map((c) => c.id)).toContain(mariana.id);
    },
  );

  it("busca un CUIT escrito sin guiones y sin coincidencias devuelve lista vacía", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, "?q=20271119993"), 200);
    expect(r.data.map((c) => c.nombre)).toEqual(["Zulema Segunda"]);
    const vacio = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, "?q=nadie-se-llama-asi"), 200);
    expect(vacio).toMatchObject({ data: [], total: 0 });
  });

  it("activo: el admin puede pedir false o todos; por defecto solo activos", async () => {
    const activos = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?q=zulema"), 200);
    expect(activos.data.every((c) => c.activo)).toBe(true);
    const inactivos = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?q=zulema&activo=false"), 200);
    expect(inactivos.data.map((c) => c.id)).toEqual([inactivo.id]);
    const todos = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?q=zulema&activo=todos"), 200);
    expect(todos.total).toBe(3);
  });

  it("el vendedor no obtiene clientes inactivos: 403 si los pide y 404 en la ficha", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, "?q=zulema"), 200);
    expect(r.data.map((c) => c.id)).not.toContain(inactivo.id);
    await esperarError(await listar(cookieVendedor, "?activo=false"), 403, "SIN_PERMISO");
    await esperarError(await listar(cookieVendedor, "?activo=todos"), 403, "SIN_PERMISO");
    await esperarError(await obtener(cookieVendedor, inactivo.id), 404, "NO_ENCONTRADO");
    await esperarError(await editar(cookieVendedor, inactivo.id, { nombre: "X" }), 404, "NO_ENCONTRADO");
    expect((await esperarJson<FichaCliente>(await obtener(cookieAdmin, inactivo.id), 200)).activo).toBe(false);
  });

  it.each(["?page=0", "?pageSize=101", "?orden=fecha", "?conDeuda=si", "?activo=quizas", "?otro=1"])(
    "parámetro inválido %s → 422 VALIDACION",
    async (consulta) => {
      await esperarError(await listar(cookieAdmin, consulta), 422, "VALIDACION");
    },
  );
});

// ---------------------------------------------------------------------------
// Saldo, disponible y saldos — RF-C1, RF-C3, RF-C6, regla 7
// ---------------------------------------------------------------------------

describe("saldo calculado desde movimientos_cuenta", () => {
  let conLimite: ClientePublico;
  let sinLimite: ClientePublico;
  let saldado: ClientePublico;
  let chico: ClientePublico;

  beforeAll(async () => {
    conLimite = await altaCliente({ nombre: "Deudor Con Límite", cuentaCorriente: true, limiteCredito: 5000000 });
    sinLimite = await altaCliente({ nombre: "Deudor Sin Límite", cuentaCorriente: true });
    saldado = await altaCliente({ nombre: "Deudor Saldado", cuentaCorriente: true });
    chico = await altaCliente({ nombre: "Deudor Chico", cuentaCorriente: true });

    await registrarDebito(conLimite.id, 1500000);
    await registrarDebito(conLimite.id, 500000);
    await registrarCredito(conLimite.id, 700000); // 1.500.000 + 500.000 − 700.000 = 1.300.000
    await registrarDebito(sinLimite.id, 2500000);
    await registrarDebito(saldado.id, 800000);
    await registrarCredito(saldado.id, 800000); // saldo 0
    await registrarDebito(chico.id, 10000);
  });

  it("un cliente sin movimientos tiene saldo 0", async () => {
    const c = await altaCliente({ cuentaCorriente: true, limiteCredito: 100000 });
    expect((await esperarJson<FichaCliente>(await obtener(cookieVendedor, c.id), 200)).saldo).toBe(0);
  });

  it("saldo = débitos − créditos; disponible = límite − saldo", async () => {
    const f = await esperarJson<FichaCliente>(await obtener(cookieVendedor, conLimite.id), 200);
    expect(f).toMatchObject({ saldo: 1300000, limiteCredito: 5000000, disponible: 3700000 });
    const enLista = (await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?q=Deudor%20Con"), 200)).data[0];
    expect(enLista).toMatchObject({ id: conLimite.id, saldo: 1300000, disponible: 3700000 });
  });

  it("sin límite: limiteCredito y disponible null", async () => {
    const f = await esperarJson<FichaCliente>(await obtener(cookieAdmin, sinLimite.id), 200);
    expect(f).toMatchObject({ saldo: 2500000, limiteCredito: null, disponible: null });
  });

  it("conDeuda=true&orden=saldo: solo saldo > 0, de mayor a menor, con totalAdeudado", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieVendedor, "?conDeuda=true&orden=saldo"), 200);
    expect(Object.keys(r).sort()).toEqual(["data", "page", "pageSize", "total", "totalAdeudado"]);
    expect(r.data.map((c) => [c.nombre, c.saldo])).toEqual([
      ["Deudor Sin Límite", 2500000],
      ["Deudor Con Límite", 1300000],
      ["Deudor Chico", 10000],
    ]);
    expect(r.data.every((c) => c.saldo > 0)).toBe(true);
    expect(r.total).toBe(3);
    expect(r.totalAdeudado).toBe(2500000 + 1300000 + 10000);
  });

  it("totalAdeudado suma todos los deudores aunque la página muestre menos", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?conDeuda=true&orden=saldo&pageSize=1&page=2"), 200);
    expect(r.data.map((c) => c.nombre)).toEqual(["Deudor Con Límite"]);
    expect(r).toMatchObject({ total: 3, page: 2, pageSize: 1, totalAdeudado: 3810000 });
  });

  it("orden=saldo sin conDeuda incluye a todos, de mayor a menor saldo", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?orden=saldo&pageSize=100"), 200);
    const saldos = r.data.map((c) => c.saldo);
    expect(saldos).toEqual([...saldos].sort((a, b) => b - a));
    expect(saldos.slice(0, 3)).toEqual([2500000, 1300000, 10000]);
    expect("totalAdeudado" in r).toBe(false);
  });

  it("conDeuda combinado con búsqueda", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?conDeuda=true&q=chico"), 200);
    expect(r).toMatchObject({ total: 1, totalAdeudado: 10000 });
  });

  it("sin deudores: lista vacía y totalAdeudado 0", async () => {
    const r = await esperarJson<Lista<ClientePublico>>(await listar(cookieAdmin, "?conDeuda=true&q=Zulema"), 200);
    expect(r).toMatchObject({ data: [], total: 0, totalAdeudado: 0 });
  });

  it("la ficha incluye como máximo 6 facturas, de la más reciente a la más vieja", async () => {
    const c = await altaCliente({ nombre: "Comprador Frecuente", cuentaCorriente: true });
    const base = Date.UTC(2026, 9, 1, 12);
    const creadas = [];
    for (let i = 0; i < 8; i++) creadas.push(await registrarDebito(c.id, 1000 * (i + 1), new Date(base + i * 86_400_000)));
    const f = await esperarJson<FichaCliente>(await obtener(cookieVendedor, c.id), 200);
    expect(f.ultimasFacturas).toHaveLength(6);
    expect(f.ultimasFacturas.map((x) => x.id)).toEqual(creadas.slice(2).reverse().map((x) => x.id));
    expect(f.ultimasFacturas[0]).toEqual({
      id: creadas[7].id,
      numero: `0001-${String(creadas[7].numero).padStart(8, "0")}`,
      fecha: new Date(base + 7 * 86_400_000).toISOString(),
      total: 8000,
      formaPago: "cuenta_corriente",
      estado: "emitida",
    });
    expect(f.saldo).toBe(36000);
  });

  it("la ficha de un cliente sin facturas trae ultimasFacturas vacío", async () => {
    const f = await esperarJson<FichaCliente>(await obtener(cookieAdmin, saldado.id), 200);
    expect(Object.keys(f).sort()).toEqual([...CLAVES_CLIENTE, "ultimasFacturas"].sort());
    const sinFacturas = await altaCliente();
    expect((await esperarJson<FichaCliente>(await obtener(cookieAdmin, sinFacturas.id), 200)).ultimasFacturas).toEqual([]);
  });

  // RF-C7 y sección 11.5: 422 SALDO_PENDIENTE.
  it("un cliente con saldo no puede desactivarse", async () => {
    const r = await esperarError(await editar(cookieAdmin, conLimite.id, { activo: false }), 422, "SALDO_PENDIENTE");
    expect(r.error.details).toEqual({ saldo: 1300000 });
    expect((await db.select().from(clientes).where(eq(clientes.id, conLimite.id)))[0].activo).toBe(true);
  });

  it("un cliente con saldo no puede perder la cuenta corriente", async () => {
    await esperarError(await editar(cookieVendedor, sinLimite.id, { cuentaCorriente: false }), 422, "SALDO_PENDIENTE");
    await esperarError(await editar(cookieAdmin, conLimite.id, { cuentaCorriente: false, nombre: "Otro" }), 422, "SALDO_PENDIENTE");
    const [fila] = await db.select().from(clientes).where(eq(clientes.id, conLimite.id));
    expect(fila).toMatchObject({ cuentaCorriente: true, limiteCredito: 5000000, nombre: "Deudor Con Límite" });
  });

  it("con saldo cero (débitos = créditos) sí puede perder la cuenta y darse de baja", async () => {
    const sinCuenta = await esperarJson<ClientePublico>(await editar(cookieAdmin, saldado.id, { cuentaCorriente: false }), 200);
    expect(sinCuenta).toMatchObject({ cuentaCorriente: false, limiteCredito: null, saldo: 0 });
    expect((await esperarJson<ClientePublico>(await editar(cookieAdmin, saldado.id, { activo: false }), 200)).activo).toBe(false);
  });

  it("la edición de otros datos no se ve afectada por el saldo", async () => {
    const c = await esperarJson<ClientePublico>(await editar(cookieVendedor, conLimite.id, { telefono: "381 000-0000", limiteCredito: 6000000 }), 200);
    expect(c).toMatchObject({ telefono: "381 000-0000", saldo: 1300000, limiteCredito: 6000000, disponible: 4700000 });
  });

  it("exigirClienteActivo (preparado para Nueva venta): activo ok; inactivo 422; inexistente 404", async () => {
    expect((await exigirClienteActivo(db, conLimite.id)).id).toBe(conLimite.id);
    await expect(exigirClienteActivo(db, saldado.id)).rejects.toMatchObject({ status: 422, code: "VALIDACION" });
    await expect(exigirClienteActivo(db, 999999)).rejects.toMatchObject({ status: 404, code: "NO_ENCONTRADO" });
  });
});

// ---------------------------------------------------------------------------
// Edición y baja — RF-C2, RF-C7
// ---------------------------------------------------------------------------

describe("PATCH /api/clientes/{id}", () => {
  it("edición correcta por el vendedor", async () => {
    const c = await altaCliente();
    const editado = await esperarJson<ClientePublico>(
      await editar(cookieVendedor, c.id, {
        nombre: "Nombre Editado",
        domicilio: "Calle Falsa 123",
        email: "Editado@Correo.Test",
        cuentaCorriente: true,
        limiteCredito: 2000000,
      }),
      200,
    );
    expect(editado).toMatchObject({
      id: c.id,
      nombre: "Nombre Editado",
      domicilio: "Calle Falsa 123",
      email: "editado@correo.test",
      cuentaCorriente: true,
      limiteCredito: 2000000,
      disponible: 2000000,
    });
  });

  it("la edición parcial no borra los campos no enviados; null o \"\" sí los borra", async () => {
    const c = await altaCliente({ domicilio: "Av. Siempre Viva 742", telefono: "381 111-1111", email: "a@correo.test" });
    const editado = await esperarJson<ClientePublico>(await editar(cookieAdmin, c.id, { nombre: "Solo Nombre" }), 200);
    expect(editado).toMatchObject({ ...c, nombre: "Solo Nombre" });
    const borrado = await esperarJson<ClientePublico>(await editar(cookieAdmin, c.id, { telefono: null, email: "" }), 200);
    expect(borrado).toMatchObject({ domicilio: "Av. Siempre Viva 742", telefono: null, email: null });
  });

  it("cambia el documento: recalcula visible y normalizado; si llega uno solo se combina con el guardado", async () => {
    const c = await altaCliente();
    const nuevo = await esperarJson<ClientePublico>(await editar(cookieAdmin, c.id, { nroDoc: "9.876.543" }), 200);
    expect(nuevo).toMatchObject({ tipoDoc: "DNI", nroDoc: "9.876.543" });
    expect((await db.select().from(clientes).where(eq(clientes.id, c.id)))[0].nroDocNormalizado).toBe("9876543");
    // Cambiar solo el tipo a CUIT con un número de DNI → 422 en nroDoc.
    const r = await esperarError(await editar(cookieAdmin, c.id, { tipoDoc: "CUIT" }), 422, "VALIDACION");
    expect(r.error.details).toEqual([{ campo: "nroDoc", mensaje: "El CUIT debe tener 11 dígitos." }]);
    const cuit = await esperarJson<ClientePublico>(await editar(cookieAdmin, c.id, { tipoDoc: "CUIT", nroDoc: "27098765434" }), 200);
    expect(cuit).toMatchObject({ tipoDoc: "CUIT", nroDoc: "27-09876543-4" });
    // Reenviar el propio documento no es un duplicado.
    await esperarJson(await editar(cookieAdmin, c.id, { tipoDoc: "CUIT", nroDoc: "27-09876543-4" }), 200);
  });

  it("documento de otro cliente → 409 DOCUMENTO_DUPLICADO sin modificar nada", async () => {
    const a = await altaCliente();
    const b = await altaCliente();
    await esperarError(await editar(cookieVendedor, b.id, { nroDoc: a.nroDoc, nombre: "No Debe" }), 409, "DOCUMENTO_DUPLICADO");
    expect(await esperarJson<ClientePublico>(await obtener(cookieAdmin, b.id), 200)).toMatchObject({ nroDoc: b.nroDoc, nombre: b.nombre });
  });

  it("PATCH vacío → 422 VALIDACION", async () => {
    const c = await altaCliente();
    const r = await esperarError(await editar(cookieAdmin, c.id, {}), 422, "VALIDACION");
    expect(r.error.details).toEqual([{ campo: "", mensaje: "Debe indicar al menos un campo para modificar." }]);
  });

  it.each(["saldo", "disponible", "nroDocNormalizado", "creadoEn"])("rechaza %s en PATCH con 422", async (campo) => {
    const c = await altaCliente();
    const r = await esperarError(await editar(cookieAdmin, c.id, { [campo]: 999 }), 422, "VALIDACION");
    expect((r.error.details as { campo: string }[]).map((d) => d.campo)).toEqual([campo]);
  });

  it("límite sin cuenta corriente → 422; al quitar la cuenta se borra el límite", async () => {
    const sinCuenta = await altaCliente();
    await esperarError(await editar(cookieAdmin, sinCuenta.id, { limiteCredito: 1000 }), 422, "VALIDACION");
    await esperarError(await editar(cookieAdmin, sinCuenta.id, { cuentaCorriente: false, limiteCredito: 1000 }), 422, "VALIDACION");
    const conCuenta = await altaCliente({ cuentaCorriente: true, limiteCredito: 9000 });
    const quitada = await esperarJson<ClientePublico>(await editar(cookieAdmin, conCuenta.id, { cuentaCorriente: false }), 200);
    expect(quitada).toMatchObject({ cuentaCorriente: false, limiteCredito: null, disponible: null });
  });

  it("cliente inexistente → 404; id inválido → 422", async () => {
    await esperarError(await editar(cookieAdmin, 999999, { nombre: "X" }), 404, "NO_ENCONTRADO");
    await esperarError(await obtener(cookieAdmin, 999999), 404, "NO_ENCONTRADO");
    await esperarError(await obtener(cookieAdmin, "abc"), 422, "VALIDACION");
    await esperarError(await editar(cookieAdmin, "0", { nombre: "X" }), 422, "VALIDACION");
  });

  it("usuario inexistente → 404 NO_ENCONTRADO (gestión de usuarios)", async () => {
    await esperarError(
      await rutaUsuarioId.PATCH(pedido("/api/usuarios/999999", { metodo: "PATCH", cookie: cookieAdmin, cuerpo: { nombre: "X" } }), conId(999999)),
      404,
      "NO_ENCONTRADO",
    );
  });

  it("baja lógica (admin): conserva el registro y se puede reactivar", async () => {
    const c = await altaCliente({ domicilio: "Conservado 1" });
    const baja = await esperarJson<ClientePublico>(await editar(cookieAdmin, c.id, { activo: false }), 200);
    expect(baja).toMatchObject({ ...c, activo: false });
    const [fila] = await db.select().from(clientes).where(eq(clientes.id, c.id));
    expect(fila).toMatchObject({ activo: false, domicilio: "Conservado 1", nroDoc: c.nroDoc });
    expect((await esperarJson<ClientePublico>(await editar(cookieAdmin, c.id, { activo: true }), 200)).activo).toBe(true);
  });

  it("el vendedor no puede dar de baja ni reactivar (403) y no cambia nada", async () => {
    const c = await altaCliente();
    await esperarError(await editar(cookieVendedor, c.id, { activo: false }), 403, "SIN_PERMISO");
    await esperarError(await editar(cookieVendedor, c.id, { activo: true, nombre: "X" }), 403, "SIN_PERMISO");
    await esperarError(await listar(cookieVendedor, "?activo=todos"), 403, "SIN_PERMISO");
    expect(await esperarJson<ClientePublico>(await obtener(cookieAdmin, c.id), 200)).toMatchObject({ activo: true, nombre: c.nombre });
  });
});

// ---------------------------------------------------------------------------
// Sesión, formatos, métodos y fuente única del saldo
// ---------------------------------------------------------------------------

describe("sesión, formatos y métodos", () => {
  it("sin sesión las cuatro rutas responden 401 NO_AUTENTICADO en JSON", async () => {
    await esperarError(await listar(undefined), 401, "NO_AUTENTICADO");
    await esperarError(await crear(undefined, {}), 401, "NO_AUTENTICADO");
    await esperarError(await obtener(undefined, 1), 401, "NO_AUTENTICADO");
    await esperarError(await editar(undefined, 1, {}), 401, "NO_AUTENTICADO");
  });

  it("con una cookie manipulada o de un usuario inexistente responde 401", async () => {
    await esperarError(await listar(`${cookieAdmin}x`), 401, "NO_AUTENTICADO");
    await esperarError(await listar(await firmarSesion(999999)), 401, "NO_AUTENTICADO");
  });

  it("las respuestas exitosas usan JSON y los estados documentados", async () => {
    const creado = await crear(cookieAdmin, { tipoDoc: "DNI", nroDoc: "40111222", nombre: "Formato" });
    const c = await esperarJson<ClientePublico>(creado, 201);
    await esperarJson(await obtener(cookieAdmin, c.id), 200);
    await esperarJson(await editar(cookieAdmin, c.id, { nombre: "Formato 2" }), 200);
    await esperarJson(await listar(cookieAdmin), 200);
  });

  it("no existe DELETE en las rutas de clientes", () => {
    for (const modulo of [rutaClientes, rutaId]) expect("DELETE" in modulo).toBe(false);
  });

  it("la tabla clientes no tiene columna saldo y ningún servicio escribe un saldo", () => {
    expect(Object.keys(getTableColumns(clientes))).not.toContain("saldo");
    const carpeta = join(process.cwd(), "src", "servicios");
    for (const archivo of readdirSync(carpeta).filter((a) => a.endsWith(".ts") && !a.endsWith(".test.ts"))) {
      const codigo = readFileSync(join(carpeta, archivo), "utf8");
      // Ningún update/insert sobre clientes asigna un campo `saldo`.
      for (const bloque of codigo.matchAll(/\.(?:set|values)\(\{[\s\S]*?\}\)/g)) {
        expect(bloque[0], `${archivo}: ${bloque[0]}`).not.toMatch(/\bsaldo\s*[:,}]/);
      }
    }
  });
});
