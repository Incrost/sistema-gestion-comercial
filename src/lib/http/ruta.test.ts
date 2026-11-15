import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import * as moduloDb from "@/db";
import { ApiError } from "@/lib/api-error";
import { CODIGOS_ERROR } from "@/lib/codigos-error";

// El envoltorio importa el módulo de sesión, que importa la base: se usa una temporal.
vi.mock("@/db", async () => (await import("@/test/base-de-prueba")).crearModuloDb());

import type { ModuloDbPrueba } from "@/test/base-de-prueba";

import { leerJson, responderError, rutaPublica } from "./ruta";

afterAll(() => (moduloDb as unknown as ModuloDbPrueba).cerrarBaseDePrueba());

afterEach(() => {
  vi.restoreAllMocks();
});

const contexto = { params: Promise.resolve({}) };

function pedido(cuerpo: string) {
  return new NextRequest("http://localhost/api/prueba", { method: "POST", body: cuerpo });
}

describe("leerJson", () => {
  it("devuelve el JSON leído", async () => {
    expect(await leerJson(pedido('{"a":1}'))).toEqual({ a: 1 });
  });

  it.each(["{no es json", "", "{'a':1}"])("cuerpo %j → 400 JSON_INVALIDO", async (cuerpo) => {
    const error = await leerJson(pedido(cuerpo)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("JSON_INVALIDO");
    expect((error as ApiError).status).toBe(400);
  });
});

describe("rutaPublica / responderError", () => {
  it("JSON inválido produce 400 JSON_INVALIDO con el formato estándar", async () => {
    const manejador = rutaPublica(async (req) => Response.json(await leerJson(req)));
    const respuesta = await manejador(pedido("{roto"), contexto);
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({
      error: { code: "JSON_INVALIDO", message: CODIGOS_ERROR.JSON_INVALIDO.mensaje },
    });
  });

  it("ZodError → 422 VALIDACION con detalle por campo", async () => {
    const manejador = rutaPublica(async () => {
      z.strictObject({ email: z.string() }).parse({});
      return Response.json({});
    });
    const respuesta = await manejador(pedido("{}"), contexto);
    expect(respuesta.status).toBe(422);
    const cuerpo = await respuesta.json();
    expect(cuerpo.error.code).toBe("VALIDACION");
    expect(cuerpo.error.details).toEqual([{ campo: "email", mensaje: "Es obligatorio." }]);
  });

  it("un error inesperado se registra y responde 500 ERROR_INTERNO sin detalles", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const respuesta = responderError(new Error("SQLITE_ERROR: no such table secreta"));
    expect(respuesta.status).toBe(500);
    const texto = await respuesta.text();
    expect(texto).not.toContain("SQLITE");
    expect(JSON.parse(texto)).toEqual({
      error: { code: "ERROR_INTERNO", message: CODIGOS_ERROR.ERROR_INTERNO.mensaje },
    });
    expect(log).toHaveBeenCalled();
  });
});

describe("señales internas de Next.js", () => {
  it("no se convierten en ERROR_INTERNO: el envoltorio las relanza (unstable_rethrow)", async () => {
    const { redirect } = await import("next/navigation");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const manejador = rutaPublica(async () => redirect("/login"));
    const error = await manejador(pedido("{}"), contexto).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT/);
    expect(log).not.toHaveBeenCalled();
  });
});
