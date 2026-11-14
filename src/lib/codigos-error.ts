/**
 * Catálogo centralizado de códigos de error de la API (consigna, sección 11.8).
 *
 * Es el ÚNICO lugar donde se asocia cada código con su estado HTTP y con un
 * mensaje por defecto. Los servicios pueden lanzar un mensaje más preciso,
 * pero el código y el estado siempre salen de esta tabla.
 *
 * Criterio (sección 11.8): 409 cuando el pedido choca con el estado actual de
 * los datos; 422 cuando está bien formado pero rompe una regla de negocio.
 *
 * Módulo compartido: puede importarse desde el servidor y desde el cliente.
 */

export const CODIGOS_ERROR = {
  JSON_INVALIDO: {
    status: 400,
    mensaje: "El cuerpo de la solicitud no es un JSON válido.",
  },
  NO_AUTENTICADO: {
    status: 401,
    mensaje: "La sesión no existe o ha vencido. Inicie sesión nuevamente.",
  },
  CREDENCIALES_INVALIDAS: {
    status: 401,
    mensaje: "El email o la contraseña son incorrectos.",
  },
  SIN_PERMISO: {
    status: 403,
    mensaje: "No tiene permiso para realizar esta operación.",
  },
  NO_ENCONTRADO: {
    status: 404,
    mensaje: "El recurso solicitado no existe.",
  },
  CODIGO_DUPLICADO: {
    status: 409,
    mensaje: "Ya existe un producto con ese código.",
  },
  DOCUMENTO_DUPLICADO: {
    status: 409,
    mensaje: "Ya existe un cliente con ese documento.",
  },
  EMAIL_DUPLICADO: {
    status: 409,
    mensaje: "Ya existe un usuario con ese email.",
  },
  NOMBRE_DUPLICADO: {
    status: 409,
    mensaje: "Ya existe una categoría con ese nombre.",
  },
  CATEGORIA_EN_USO: {
    status: 409,
    mensaje: "La categoría tiene productos activos y no puede desactivarse.",
  },
  STOCK_INSUFICIENTE: {
    status: 409,
    mensaje: "La existencia no alcanza para la cantidad solicitada.",
  },
  FACTURA_ANULADA: {
    status: 409,
    mensaje: "La factura ya se encuentra anulada.",
  },
  VALIDACION: {
    status: 422,
    mensaje: "Hay campos con errores.",
  },
  PRODUCTO_INACTIVO: {
    status: 422,
    mensaje: "El producto está dado de baja y no puede venderse.",
  },
  CUENTA_CORRIENTE_NO_HABILITADA: {
    status: 422,
    mensaje: "El cliente no tiene la cuenta corriente habilitada.",
  },
  LIMITE_CREDITO_EXCEDIDO: {
    status: 422,
    mensaje: "La operación supera el límite de crédito del cliente.",
  },
  MONTO_INSUFICIENTE: {
    status: 422,
    mensaje: "El monto recibido no cubre el total.",
  },
  PAGO_SUPERA_DEUDA: {
    status: 422,
    mensaje: "El importe del pago supera el saldo adeudado.",
  },
  SALDO_PENDIENTE: {
    status: 422,
    mensaje: "El cliente tiene saldo pendiente en su cuenta corriente.",
  },
  CONTRASENA_ACTUAL_INCORRECTA: {
    status: 422,
    mensaje: "La contraseña actual es incorrecta.",
  },
  OPERACION_SOBRE_SI_MISMO: {
    status: 422,
    mensaje: "No puede desactivarse ni quitarse el rol de administrador a sí mismo.",
  },
  ERROR_INTERNO: {
    status: 500,
    mensaje: "Ocurrió un error inesperado. Intente nuevamente más tarde.",
  },
} as const satisfies Record<string, { status: number; mensaje: string }>;

/** Unión de todos los códigos válidos: "JSON_INVALIDO" | "NO_AUTENTICADO" | ... */
export type CodigoError = keyof typeof CODIGOS_ERROR;
