import { describe, expect, it } from "vitest";

import { destinoSeguro } from "./destino-seguro";

describe("destinoSeguro", () => {
  it("acepta rutas internas", () => {
    expect(destinoSeguro("/ventas")).toBe("/ventas");
    expect(destinoSeguro("/clientes/4?pestana=cuenta")).toBe("/clientes/4?pestana=cuenta");
  });

  it("rechaza destinos externos, vacíos o que vuelven al login", () => {
    for (const valor of [
      undefined,
      null,
      "",
      "https://otro.sitio",
      "//otro.sitio",
      "/\\otro.sitio",
      "/login",
      "/login?desde=/",
      "/api/auth/me",
    ]) {
      expect(destinoSeguro(valor)).toBe("/");
    }
  });
});
