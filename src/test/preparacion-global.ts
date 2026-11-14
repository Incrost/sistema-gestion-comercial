/**
 * Preparación global de Vitest: al terminar TODAS las pruebas, borra las
 * bases temporales creadas por src/test/base-de-prueba.ts.
 *
 * Se hace aquí y no al final de cada archivo porque en Windows el archivo
 * SQLite queda bloqueado mientras vive el proceso que lo abrió; esta función
 * corre en el proceso principal, cuando los de prueba ya terminaron.
 */
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PREFIJO_BASE_PRUEBA = "sgc-prueba-";

export default function preparacionGlobal() {
  return function limpiarBasesDePrueba() {
    for (const nombre of readdirSync(tmpdir())) {
      if (nombre.startsWith(PREFIJO_BASE_PRUEBA)) {
        try {
          rmSync(join(tmpdir(), nombre), {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
          });
        } catch {
          // Windows puede retener el archivo unos instantes más después de
          // que terminan los procesos de prueba. Queda para la próxima
          // ejecución, que vuelve a recorrer la carpeta temporal.
        }
      }
    }
  };
}
