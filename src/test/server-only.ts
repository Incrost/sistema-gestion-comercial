/**
 * Reemplazo vacío del paquete `server-only` para las pruebas.
 *
 * En Next.js, `import "server-only"` impide que un módulo de servidor termine
 * en el código del navegador. Vitest no ejecuta ese control (no es Next.js),
 * así que vitest.config.mts redirige el import a este archivo vacío.
 */
export {};
