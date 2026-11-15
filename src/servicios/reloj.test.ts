/**
 * Pruebas del reloj de los servicios (src/servicios/reloj.ts): la fecha
 * simulada es interna, acotada al trabajo que la usa, nunca futura, y la API
 * no acepta fechas de emisión elegidas por el cliente.
 */
import { describe, expect, it } from "vitest";

import { esquemaAltaPago } from "@/lib/validacion-pagos";
import { esquemaEmisionFactura } from "@/lib/validacion-facturas";
import { esquemaMovimientoManual } from "@/lib/validacion-productos";

import { ahora, conFechaSimulada } from "./reloj";

describe("reloj de los servicios", () => {
  it("sin simulación, ahora() es la hora real", () => {
    const antes = Date.now();
    const valor = ahora().getTime();
    expect(valor).toBeGreaterThanOrEqual(antes);
    expect(valor).toBeLessThanOrEqual(Date.now());
  });

  it("dentro de conFechaSimulada() devuelve la fecha indicada, también tras await", async () => {
    const fecha = new Date("2026-10-20T13:15:00.000Z");
    const vistas = await conFechaSimulada(fecha, async () => {
      const primera = ahora().toISOString();
      await new Promise((r) => setTimeout(r, 5));
      return [primera, ahora().toISOString()];
    });
    expect(vistas).toEqual([fecha.toISOString(), fecha.toISOString()]);
    expect(ahora().getTime()).toBeGreaterThan(fecha.getTime()); // fuera, vuelve la hora real
  });

  it("no afecta a otro trabajo que corre al mismo tiempo", async () => {
    const fecha = new Date("2026-10-20T13:15:00.000Z");
    let otra = 0;
    await Promise.all([
      conFechaSimulada(fecha, () => new Promise((r) => setTimeout(r, 10))),
      (async () => {
        await new Promise((r) => setTimeout(r, 2));
        otra = ahora().getTime();
      })(),
    ]);
    expect(otra).toBeGreaterThan(fecha.getTime());
  });

  it("rechaza fechas futuras o inválidas", () => {
    expect(() => conFechaSimulada(new Date(Date.now() + 60_000), async () => 1)).toThrow(RangeError);
    expect(() => conFechaSimulada(new Date("no es fecha"), async () => 1)).toThrow(RangeError);
  });

  it("la API no acepta fechas elegidas por el cliente", () => {
    const fecha = "2026-10-01T12:00:00.000Z";
    expect(
      esquemaEmisionFactura.safeParse({ clienteId: null, items: [{ productoId: 1, cantidad: 1 }], pago: { forma: "contado" }, fecha }).success,
    ).toBe(false);
    expect(esquemaAltaPago.safeParse({ importe: 100, medio: "efectivo", fecha }).success).toBe(false);
    expect(esquemaMovimientoManual.safeParse({ tipo: "ingreso", cantidad: 1, motivo: "Reposición", fecha }).success).toBe(false);
  });
});
