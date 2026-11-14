/**
 * Ayudantes para probar Route Handlers: arman el NextRequest como lo haría
 * Next.js y verifican el formato estándar de error (sección 11.1).
 */
import { NextRequest } from "next/server";
import { expect } from "vitest";

import { NOMBRE_COOKIE_SESION } from "@/lib/sesion-token";

export function pedido(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: string | object; cookie?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opciones.cookie !== undefined) {
    headers.set("cookie", `${NOMBRE_COOKIE_SESION}=${opciones.cookie}`);
  }
  const cuerpo =
    typeof opciones.cuerpo === "object" ? JSON.stringify(opciones.cuerpo) : opciones.cuerpo;
  return new NextRequest(`http://localhost${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers,
    body: cuerpo,
  });
}

export const sinParametros = { params: Promise.resolve({}) };
export const conId = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

/** Verifica estado, Content-Type JSON y la forma { error: { code, message } }. */
export async function esperarError(respuesta: Response, status: number, code: string) {
  expect(respuesta.status).toBe(status);
  expect(respuesta.headers.get("content-type")).toContain("application/json");
  const cuerpo = await respuesta.json();
  expect(Object.keys(cuerpo)).toEqual(["error"]);
  expect(cuerpo.error.code).toBe(code);
  expect(typeof cuerpo.error.message).toBe("string");
  return cuerpo as { error: { code: string; message: string; details?: unknown } };
}

/** Verifica estado y Content-Type JSON de una respuesta exitosa y devuelve el cuerpo. */
export async function esperarJson<T = Record<string, unknown>>(respuesta: Response, status: number) {
  if (respuesta.status !== status) {
    throw new Error(`Se esperaba ${status} y llegó ${respuesta.status}: ${await respuesta.text()}`);
  }
  expect(respuesta.headers.get("content-type")).toContain("application/json");
  return (await respuesta.json()) as T;
}
