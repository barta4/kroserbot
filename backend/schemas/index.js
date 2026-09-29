const { z } = require('zod');

const webhookPayloadSchema = z.object({
  event: z.string().min(1),
  id: z.union([z.number(), z.string()]).nullable().optional(),
  message: z.object({
    id: z.union([z.number(), z.string()]).nullable().optional(),
    content: z.string().nullable().optional().transform(v => v || ''),
    message_type: z.union([z.string(), z.number()]).nullable().optional(),
    sender: z.object({
      id: z.union([z.number(), z.string()]).nullable().optional(),
      type: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone_number: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
    attachments: z.array(z.any()).nullable().optional(),
  }).passthrough().nullable().optional(),
  conversation: z.object({
    id: z.union([z.number(), z.string()]).nullable().optional(),
    account_id: z.union([z.number(), z.string()]).nullable().optional(),
    inbox: z.object({
      id: z.union([z.number(), z.string()]).nullable().optional(),
      name: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
  }).passthrough().nullable().optional(),
  account: z.object({
    id: z.union([z.number(), z.string()]).nullable().optional(),
  }).passthrough().nullable().optional(),
  sender: z.object({
    id: z.union([z.number(), z.string()]).nullable().optional(),
    type: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone_number: z.string().nullable().optional(),
  }).passthrough().nullable().optional(),
  conversation_id: z.union([z.number(), z.string()]).nullable().optional(),
  content: z.string().nullable().optional().transform(v => v || ''),
  attachments: z.array(z.any()).nullable().optional(),
  message_type: z.union([z.string(), z.number()]).nullable().optional(),
  inbox: z.object({}).passthrough().nullable().optional(),
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
  notas: z.string().nullable().optional(),
  motivo_modificacion: z.string().nullable().optional(),
  zona_envio_id: z.union([z.number(), z.string()]).nullable().optional(),
  forma_pago_id: z.union([z.number(), z.string()]).nullable().optional(),
  costo_envio: z.union([z.number(), z.string()]).nullable().optional(),
  cambiado_por: z.string().nullable().optional(),
});

const configuracionSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(10000).nullable().optional().default(''),
});

const localSchema = z.object({
  nombre: z.string().min(1).max(200),
  zona: z.string().max(200).nullable().optional(),
  direccion: z.string().nullable().optional(),
  telefono: z.string().max(50).nullable().optional(),
  horario: z.string().nullable().optional(),
});

const zonaEnvioSchema = z.object({
  departamento_ciudad: z.string().max(100).nullable().optional().default('Montevideo'),
  barrio_zona: z.string().min(1).max(150),
  costo_envio: z.union([z.number(), z.string()]).nullable().optional().default(0),
  activo: z.boolean().optional().default(true),
});

const formaPagoSchema = z.object({
  nombre: z.string().min(1).max(100),
  descripcion: z.string().nullable().optional().default(''),
  instrucciones: z.string().nullable().optional().default(''),
  activo: z.boolean().optional().default(true),
});

const llmConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  fallbackProvider: z.string().optional(),
  fallbackModel: z.string().optional(),
  fallbackApiKey: z.string().optional(),
  fallbackBaseUrl: z.string().optional(),
  fallbackEnabled: z.union([z.boolean(), z.string()]).optional(),
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
