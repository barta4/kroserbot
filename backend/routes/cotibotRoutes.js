const express = require('express');
const router = express.Router();
const cotibotController = require('../controllers/cotibotController');
const { optionalClienteAuth } = require('../middleware/clienteAuth');
const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

// Rate limiter específico para consultas de chat de la landing (previene abusos de cuota LLM)
const cotibotChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: isTest ? 1000 : 30, // máximo 30 mensajes por minuto por IP
  message: {
    error: 'Demasiadas consultas en poco tiempo. Por favor aguarde unos segundos antes de volver a consultar a Cotibot.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

// Rate limiter específico para creación de pedidos web (previene spam, abusos y flooding de pedidos/emails)
const cotibotPedidoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: isTest ? 1000 : 10, // máximo 10 pedidos cada 15 min por IP
  message: {
    error: 'Ha alcanzado el límite de pedidos permitidos temporalmente. Si necesita ayuda inmediata, comuníquese con sucursales o vía WhatsApp.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

router.post('/chat', cotibotChatLimiter, optionalClienteAuth, cotibotController.chat);
router.post('/pedido', cotibotPedidoLimiter, optionalClienteAuth, cotibotController.createWebPedido);

module.exports = router;
