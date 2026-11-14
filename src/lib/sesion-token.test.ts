import { decodeJwt, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  DURACION_SESION_SEGUNDOS,
  firmarSesion,
  obtenerSecretoSesion,
  opcionesCookieSesion,
  SECRETO_DE_EJEMPLO,
  verificarSesion,
} from "./sesion-token";

const ahora = () => Math.floor(Date.now() / 1000);

/** Cambia un carácter del medio de una parte del token (0 = encabezado, 1 = contenido, 2 = firma). */
function alterar(token: string, parte: number): string {
  const partes = token.split(".");
  const texto = partes[parte];
  const i = Math.floor(texto.length / 2);
  partes[parte] = texto.slice(0, i) + (texto[i] === "A" ? "B" : "A") + texto.slice(i + 1);
  return partes.join(".");
}

describe("firma y verificación de la sesión", () => {
  it("una sesión firmada se verifica y devuelve el id del usuario", async () => {
    const token = await firmarSesion(7);
    expect(await verificarSesion(token)).toEqual({ usuarioId: 7 });
  });

  it("contiene solo el id, la emisión y el vencimiento", async () => {
    const contenido = decodeJwt(await firmarSesion(7));
    expect(Object.keys(contenido).sort()).toEqual(["exp", "iat", "sub"]);
    expect(contenido.sub).toBe("7");
    expect(contenido.exp! - contenido.iat!).toBe(DURACION_SESION_SEGUNDOS);
  });

  it("rechaza una sesión manipulada (contenido o firma)", async () => {
    const token = await firmarSesion(7);
    expect(await verificarSesion(alterar(token, 1))).toBeNull();
    expect(await verificarSesion(alterar(token, 2))).toBeNull();
  });

  it("rechaza una sesión con otro id pero firmada con otra clave", async () => {
    const ajena = await firmarSesion(1, {
      secreto: new TextEncoder().encode("otro-secreto-de-al-menos-32-caracteres!!"),
    });
    expect(await verificarSesion(ajena)).toBeNull();
  });

  it("rechaza una sesión vencida", async () => {
    const vieja = await firmarSesion(7, { ahora: ahora() - DURACION_SESION_SEGUNDOS - 60 });
    expect(await verificarSesion(vieja)).toBeNull();
  });

  it("rechaza un token sin vencimiento", async () => {
    const sinVencimiento = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("7")
      .setIssuedAt()
      .sign(obtenerSecretoSesion());
    expect(await verificarSesion(sinVencimiento)).toBeNull();
  });

  it("rechaza un token sin firma (alg none) y valores basura", async () => {
    const encabezado = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const contenido = Buffer.from(
      JSON.stringify({ sub: "1", iat: ahora(), exp: ahora() + 3600 }),
    ).toString("base64url");
    expect(await verificarSesion(`${encabezado}.${contenido}.`)).toBeNull();
    expect(await verificarSesion("no-es-un-token")).toBeNull();
    expect(await verificarSesion("")).toBeNull();
    expect(await verificarSesion(undefined)).toBeNull();
  });
});

describe("SESSION_SECRET", () => {
  it("falla con un mensaje claro si falta", () => {
    expect(() => obtenerSecretoSesion({ NODE_ENV: "development" })).toThrow(/falta.*SESSION_SECRET/);
  });

  it("falla si es demasiado corto", () => {
    expect(() =>
      obtenerSecretoSesion({ NODE_ENV: "development", SESSION_SECRET: "corto" }),
    ).toThrow(/al menos 32/);
  });

  it("acepta el valor de ejemplo en desarrollo pero lo rechaza en producción", () => {
    expect(() =>
      obtenerSecretoSesion({ NODE_ENV: "development", SESSION_SECRET: SECRETO_DE_EJEMPLO }),
    ).not.toThrow();
    expect(() =>
      obtenerSecretoSesion({ NODE_ENV: "production", SESSION_SECRET: SECRETO_DE_EJEMPLO }),
    ).toThrow(/producción/);
  });
});

describe("opciones de la cookie", () => {
  it("httpOnly, SameSite=Lax, Path=/ y duración centralizada", () => {
    expect(opcionesCookieSesion({ NODE_ENV: "development" })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: DURACION_SESION_SEGUNDOS,
    });
  });

  it("Secure solo en producción", () => {
    expect(opcionesCookieSesion({ NODE_ENV: "production" }).secure).toBe(true);
  });
});
