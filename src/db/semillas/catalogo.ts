/**
 * Datos iniciales: categorías y productos (sección 8, «Datos de prueba»;
 * sección 10.7).
 *
 * Todo se crea con los MISMOS servicios que usa la aplicación
 * (crearCategoria, crearProducto, actualizarProducto, registrarMovimientoManual):
 * el stock inicial entra como ingreso «Stock inicial» a través de moverStock(),
 * nunca escribiendo la existencia a mano. Así la existencia de cada producto
 * coincide con la suma de sus movimientos (regla 2).
 *
 * Idempotente: una categoría se busca por nombre y un producto por código; si
 * ya existe NO se vuelve a crear ni se modifica, y tampoco se le agregan
 * movimientos. Se puede ejecutar todas las veces que se quiera.
 *
 * Solo servidor (lo usa scripts/seed.ts).
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import type { TipoMovimientoManual } from "@/config/motivos-stock";
import { db } from "@/db";
import { categorias, productos } from "@/db/schema";
import type { UsuarioAutenticado } from "@/servicios/auth";
import { crearCategoria } from "@/servicios/categorias";
import { actualizarProducto, crearProducto } from "@/servicios/productos";
import { registrarMovimientoManual } from "@/servicios/stock";

type MovimientoSemilla = {
  tipo: TipoMovimientoManual;
  cantidad: number;
  motivo: string;
  observacion?: string;
};

type ProductoSemilla = {
  codigo: string;
  descripcion: string;
  categoria: string;
  /** Centavos (regla 10): 1250000 = $ 12.500,00. */
  precio: number;
  stockMinimo: number;
  stockInicial: number;
  activo?: false;
  /** Movimientos de ejemplo que se registran solo al crear el producto. */
  movimientos?: MovimientoSemilla[];
};

export const CATEGORIAS_SEMILLA = [
  "Herramientas",
  "Electricidad",
  "Plomería",
  "Pinturería",
  "Bulonería",
  "Jardín",
] as const;

/**
 * 30 productos con distintos niveles de existencia. Quedan bajo el mínimo
 * (existencia < stockMinimo): HE-003, HE-005, EL-003, EL-005, PL-003,
 * PI-002, BU-002 y JA-004. HE-006 y JA-003 tienen existencia IGUAL al mínimo
 * (no están bajo el mínimo). JA-005 está dado de baja.
 */
export const PRODUCTOS_SEMILLA: readonly ProductoSemilla[] = [
  {
    codigo: "HE-001", descripcion: "Martillo carpintero 500 g", categoria: "Herramientas",
    precio: 1250000, stockMinimo: 5, stockInicial: 24,
    movimientos: [
      { tipo: "ingreso", cantidad: 6, motivo: "Reposición", observacion: "Remito proveedor 1520" },
      { tipo: "egreso", cantidad: 2, motivo: "Rotura", observacion: "Caída en depósito" },
    ],
  },
  { codigo: "HE-002", descripcion: "Destornillador plano 6 mm", categoria: "Herramientas", precio: 320000, stockMinimo: 10, stockInicial: 40 },
  { codigo: "HE-003", descripcion: "Destornillador Phillips PH2", categoria: "Herramientas", precio: 340000, stockMinimo: 10, stockInicial: 8 },
  { codigo: "HE-004", descripcion: "Pinza universal 8 pulgadas", categoria: "Herramientas", precio: 890000, stockMinimo: 5, stockInicial: 12 },
  { codigo: "HE-005", descripcion: "Llave ajustable 10 pulgadas", categoria: "Herramientas", precio: 1450000, stockMinimo: 4, stockInicial: 3 },
  { codigo: "HE-006", descripcion: "Cinta métrica 5 m", categoria: "Herramientas", precio: 560000, stockMinimo: 8, stockInicial: 8 },
  { codigo: "EL-001", descripcion: "Cinta aisladora 20 m", categoria: "Electricidad", precio: 190000, stockMinimo: 20, stockInicial: 60 },
  {
    codigo: "EL-002", descripcion: "Lámpara LED 12 W", categoria: "Electricidad",
    precio: 320000, stockMinimo: 15, stockInicial: 45,
    movimientos: [{ tipo: "egreso", cantidad: 3, motivo: "Uso interno", observacion: "Iluminación del local" }],
  },
  { codigo: "EL-003", descripcion: "Tomacorriente doble", categoria: "Electricidad", precio: 410000, stockMinimo: 10, stockInicial: 0 },
  { codigo: "EL-004", descripcion: "Cable unipolar 2,5 mm rollo 100 m", categoria: "Electricidad", precio: 4850000, stockMinimo: 3, stockInicial: 5 },
  { codigo: "EL-005", descripcion: "Interruptor termomagnético 2x16 A", categoria: "Electricidad", precio: 1290000, stockMinimo: 4, stockInicial: 2 },
  { codigo: "PL-001", descripcion: "Cinta de teflón 3/4 pulgada", categoria: "Plomería", precio: 95000, stockMinimo: 30, stockInicial: 80 },
  { codigo: "PL-002", descripcion: "Canilla esférica 1/2 pulgada", categoria: "Plomería", precio: 780000, stockMinimo: 6, stockInicial: 10 },
  { codigo: "PL-003", descripcion: "Codo PVC 90° 40 mm", categoria: "Plomería", precio: 120000, stockMinimo: 25, stockInicial: 18 },
  { codigo: "PL-004", descripcion: "Sellador siliconado transparente 280 ml", categoria: "Plomería", precio: 650000, stockMinimo: 8, stockInicial: 14 },
  { codigo: "PI-001", descripcion: "Látex interior blanco 4 L", categoria: "Pinturería", precio: 2350000, stockMinimo: 6, stockInicial: 9 },
  { codigo: "PI-002", descripcion: "Esmalte sintético negro 1 L", categoria: "Pinturería", precio: 1480000, stockMinimo: 5, stockInicial: 4 },
  { codigo: "PI-003", descripcion: "Pincel número 20", categoria: "Pinturería", precio: 260000, stockMinimo: 12, stockInicial: 30 },
  { codigo: "PI-004", descripcion: "Rodillo de lana 22 cm", categoria: "Pinturería", precio: 590000, stockMinimo: 6, stockInicial: 11 },
  {
    codigo: "PI-005", descripcion: "Lija al agua grano 180", categoria: "Pinturería",
    precio: 75000, stockMinimo: 50, stockInicial: 120,
    movimientos: [{ tipo: "egreso", cantidad: 10, motivo: "Vencimiento", observacion: "Lote humedecido" }],
  },
  { codigo: "BU-001", descripcion: "Tornillo autoperforante 8x1 caja x100", categoria: "Bulonería", precio: 420000, stockMinimo: 10, stockInicial: 25 },
  { codigo: "BU-002", descripcion: "Tarugo de nylon 8 mm bolsa x50", categoria: "Bulonería", precio: 180000, stockMinimo: 15, stockInicial: 7 },
  { codigo: "BU-003", descripcion: "Bulón cabeza hexagonal 1/4 x 2", categoria: "Bulonería", precio: 25000, stockMinimo: 100, stockInicial: 350 },
  { codigo: "BU-004", descripcion: "Arandela plana 1/4 bolsa x100", categoria: "Bulonería", precio: 95000, stockMinimo: 20, stockInicial: 40 },
  { codigo: "BU-005", descripcion: "Clavo punta París 2 pulgadas x kg", categoria: "Bulonería", precio: 310000, stockMinimo: 10, stockInicial: 16 },
  { codigo: "JA-001", descripcion: "Manguera 1/2 pulgada 15 m", categoria: "Jardín", precio: 1890000, stockMinimo: 4, stockInicial: 6 },
  { codigo: "JA-002", descripcion: "Tijera de podar", categoria: "Jardín", precio: 980000, stockMinimo: 3, stockInicial: 5 },
  { codigo: "JA-003", descripcion: "Regadera plástica 10 L", categoria: "Jardín", precio: 720000, stockMinimo: 4, stockInicial: 4 },
  { codigo: "JA-004", descripcion: "Guantes de jardinería", categoria: "Jardín", precio: 350000, stockMinimo: 10, stockInicial: 3 },
  { codigo: "JA-005", descripcion: "Pala de punta (discontinuada)", categoria: "Jardín", precio: 1650000, stockMinimo: 3, stockInicial: 2, activo: false },
];

export type ResultadoSemillaCatalogo = {
  categoriasCreadas: number;
  categoriasExistentes: number;
  productosCreados: number;
  productosExistentes: number;
  movimientosCreados: number;
};

async function idCategoriaPorNombre(nombre: string): Promise<number | undefined> {
  const [fila] = await db
    .select({ id: categorias.id })
    .from(categorias)
    .where(sql`lower(${categorias.nombre}) = lower(${nombre})`)
    .limit(1);
  return fila?.id;
}

async function existeProducto(codigo: string): Promise<boolean> {
  const [fila] = await db
    .select({ id: productos.id })
    .from(productos)
    .where(eq(productos.codigo, codigo))
    .limit(1);
  return fila !== undefined;
}

/**
 * Crea las categorías y los productos que falten, con el administrador
 * indicado como autor de los movimientos (regla 11).
 */
export async function sembrarCatalogo(admin: UsuarioAutenticado): Promise<ResultadoSemillaCatalogo> {
  const resultado: ResultadoSemillaCatalogo = {
    categoriasCreadas: 0,
    categoriasExistentes: 0,
    productosCreados: 0,
    productosExistentes: 0,
    movimientosCreados: 0,
  };

  const idsCategorias = new Map<string, number>();
  for (const nombre of CATEGORIAS_SEMILLA) {
    let id = await idCategoriaPorNombre(nombre);
    if (id === undefined) {
      id = (await crearCategoria(admin, { nombre })).id;
      resultado.categoriasCreadas++;
    } else {
      resultado.categoriasExistentes++;
    }
    idsCategorias.set(nombre, id);
  }

  for (const semilla of PRODUCTOS_SEMILLA) {
    if (await existeProducto(semilla.codigo)) {
      resultado.productosExistentes++;
      continue;
    }

    // Producto + movimiento «Stock inicial» en una sola transacción.
    const producto = await crearProducto(admin, {
      codigo: semilla.codigo,
      descripcion: semilla.descripcion,
      categoriaId: idsCategorias.get(semilla.categoria),
      precio: semilla.precio,
      stockMinimo: semilla.stockMinimo,
      stockInicial: semilla.stockInicial,
    });
    resultado.productosCreados++;
    if (semilla.stockInicial > 0) resultado.movimientosCreados++;

    for (const movimiento of semilla.movimientos ?? []) {
      await registrarMovimientoManual(admin, { id: String(producto.id) }, movimiento);
      resultado.movimientosCreados++;
    }

    // Baja lógica (RF-P3): conserva el producto y su historial.
    if (semilla.activo === false) {
      await actualizarProducto(admin, { id: String(producto.id) }, { activo: false });
    }
  }

  return resultado;
}
