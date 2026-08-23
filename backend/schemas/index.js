const { z } = require('zod');

const webhookPayloadSchema = z.object({
  event: z.string().min(1),
  message: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    content: z.string().optional().default(''),
    message_type: z.string().optional(),
    sender: z.object({
      type: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone_number: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  conversation: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    account_id: z.union([z.number(), z.string()]).optional(),
    inbox: z.object({
      id: z.union([z.number(), z.string()]).optional(),
      name: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  account: z.object({
    id: z.union([z.number(), z.string()]).optional(),
  }).passthrough().optional(),
  conversation_id: z.union([z.number(), z.string()]).optional(),
  content: z.string().optional(),
  inbox: z.object({}).passthrough().optional(),
}).passthrough();

const pedidoCreateSchema = z.object({
  conversation_id: z.string().optional().default('manual'),
  account_id: z.union([z.number(), z.string()]).optional().default(1),
  cliente: z.record(z.any()).optional().default({}),
  items: z.array(z.object({
    name: z.string().optional(),
    nombre: z.string().optional(),
    quantity: z.number().int().positive().optional(),
    cantidad: z.number().int().positive().optional(),
    price: z.number().nonnegative().optional(),
    precio: z.number().nonnegative().optional(),
  }).passthrough()).min(1),
});

const pedidoEstadoSchema = z.object({
  estado: z.enum(['pendiente', 'confirmado', 'en_preparacion', 'rechazado', 'cancelado', 'entregado']),
  cambiado_por: z.string().optional(),
});

const pedidoUpdateSchema = z.object({
  items: z.array(z.object({}).passthrough()).optional(),
  cliente: z.record(z.any()).optional(),
  estado: z.enum(['pendiente', 'confirmado', 'en_preparacion', 'rechazado', 'cancelado', 'entregado']).optional(),
  notas: z.string().optional(),
  motivo_modificacion: z.string().optional(),
  zona_envio_id: z.union([z.number(), z.string()]).optional(),
  forma_pago_id: z.union([z.number(), z.string()]).optional(),
  costo_envio: z.number().nonnegative().optional(),
  cambiado_por: z.string().optional(),
});

const configuracionSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(10000),
});

const localSchema = z.object({
  nombre: z.string().min(1).max(200),
  zona: z.string().max(200).optional(),
  direccion: z.string().optional(),
  telefono: z.string().max(50).optional(),
  horario: z.string().optional(),
});

const zonaEnvioSchema = z.object({
  departamento_ciudad: z.string().max(100).optional().default('Montevideo'),
  barrio_zona: z.string().min(1).max(150),
  costo_envio: z.union([z.number(), z.string()]).optional().default(0),
  activo: z.boolean().optional().default(true),
});

const formaPagoSchema = z.object({
  nombre: z.string().min(1).max(100),
  descripcion: z.string().optional().default(''),
  instrucciones: z.string().optional().default(''),
  activo: z.boolean().optional().default(true),
});

const llmConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const llmModelsSchema = z.object({
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const mercadopagoToggleSchema = z.object({
  enabled: z.boolean(),
});

const mercadopagoPreferenceSchema = z.object({
  pedido_id: z.union([z.number(), z.string()]),
});

module.exports = {
  webhookPayloadSchema,
  pedidoCreateSchema,
  pedidoEstadoSchema,
  pedidoUpdateSchema,
  configuracionSchema,
  localSchema,
  zonaEnvioSchema,
  formaPagoSchema,
  llmConfigSchema,
  llmModelsSchema,
  mercadopagoToggleSchema,
  mercadopagoPreferenceSchema,
};
