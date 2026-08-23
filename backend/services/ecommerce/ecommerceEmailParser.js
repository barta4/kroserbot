/**
 * ecommerceEmailParser.js
 * 
 * Parsea el contenido de un email de pedido e-commerce que llega vía Chatwoot.
 * Soporta un parser genérico + parser específico para Tiendanube.
 * 
 * Retorna un objeto con: orderNumber, customer, items, total, paymentStatus,
 * paymentMethod, shippingMethod.
 */

/**
 * Detecta si el contenido parece un email de pedido e-commerce.
 * Busca patrones comunes en emails de tiendas online.
 */
function looksLikeOrderEmail(content) {
  if (!content || typeof content !== 'string') return false;
  const lower = content.toLowerCase();

  const orderPatterns = [
    /pedido\s*#?\s*\d+/i,
    /orden\s*#?\s*\d+/i,
    /order\s*#?\s*\d+/i,
    /nuevo\s+pedido/i,
    /nueva\s+venta/i,
    /new\s+order/i,
    /compra\s+(realizada|confirmada|recibida)/i,
    /tiendanube/i,
    /nuvemshop/i,
  ];

  const dataPatterns = [
    /direcci[oó]n\s*(de\s+)?env[ií]o/i,
    /datos\s+del?\s+(cliente|comprador)/i,
    /m[eé]todo\s+de\s+pago/i,
    /forma\s+de\s+pago/i,
    /total\s*[:$]/i,
    /subtotal/i,
  ];

  const orderMatch = orderPatterns.some((p) => p.test(content));
  const dataMatch = dataPatterns.some((p) => p.test(content));

  // Needs at least one order pattern, or two data patterns
  return orderMatch || dataPatterns.filter((p) => p.test(content)).length >= 2;
}

/**
 * Detecta si el email viene de Tiendanube/Nuvemshop.
 */
function isTiendanubeEmail(content) {
  const lower = content.toLowerCase();
  return (
    lower.includes('tiendanube') ||
    lower.includes('nuvemshop') ||
    lower.includes('tiendanube.com') ||
    /pedido\s*#\d+\s*(en|de)\s+tu\s+tienda/i.test(content)
  );
}

/**
 * Parser genérico: extrae datos de un email de pedido usando regex.
 */
function parseGenericOrderEmail(content) {
  const result = {
    orderNumber: null,
    customer: {
      name: null,
      email: null,
      phone: null,
      address: null,
    },
    items: [],
    total: null,
    paymentStatus: 'pending',
    paymentMethod: null,
    shippingMethod: null,
    rawContent: content,
  };

  // Order number
  const orderMatch = content.match(/(?:pedido|orden|order)\s*#?\s*(\d+)/i);
  if (orderMatch) {
    result.orderNumber = `#${orderMatch[1]}`;
  }

  // Customer name
  const namePatterns = [
    /(?:nombre|cliente|comprador|buyer)[:\s]+([^\n\r,]+)/i,
    /(?:datos del cliente|customer)[:\s]*\n\s*([^\n\r]+)/i,
  ];
  for (const pattern of namePatterns) {
    const match = content.match(pattern);
    if (match) {
      result.customer.name = match[1].trim();
      break;
    }
  }

  // Customer email
  const emailMatch = content.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (emailMatch) {
    result.customer.email = emailMatch[0];
  }

  // Customer phone
  const phonePatterns = [
    /(?:tel[eé]fono|phone|celular|cel)[:\s]+([\d\s\-+()]+)/i,
    /(?:09\d{7})/,
    /(?:\+598\s?\d{8})/,
  ];
  for (const pattern of phonePatterns) {
    const match = content.match(pattern);
    if (match) {
      result.customer.phone = (match[1] || match[0]).trim();
      break;
    }
  }

  // Customer address
  const addressPatterns = [
    /(?:direcci[oó]n|address|env[ií]o\s+a)[:\s]+([^\n\r]+(?:\n[^\n\r]+)?)/i,
    /(?:direcci[oó]n\s+de\s+env[ií]o)[:\s]*\n?\s*([^\n\r]+)/i,
  ];
  for (const pattern of addressPatterns) {
    const match = content.match(pattern);
    if (match) {
      result.customer.address = match[1].trim();
      break;
    }
  }

  // Total amount
  const totalPatterns = [
    /total[:\s]*\$?\s*([\d.,]+)/i,
    /monto\s+total[:\s]*\$?\s*([\d.,]+)/i,
  ];
  for (const pattern of totalPatterns) {
    const match = content.match(pattern);
    if (match) {
      result.total = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
      break;
    }
  }

  // Payment status
  const paidPatterns = [
    /pago\s+(confirmado|aprobado|realizado|acreditado)/i,
    /payment\s+(confirmed|approved|completed)/i,
    /estado\s+del?\s+pago[:\s]*(aprobado|confirmado|pagado|acreditado)/i,
    /pagado/i,
    /paid/i,
  ];
  const pendingPatterns = [
    /pago\s+(pendiente|en\s+proceso)/i,
    /payment\s+(pending|processing)/i,
    /estado\s+del?\s+pago[:\s]*(pendiente)/i,
    /aguardando\s+pago/i,
  ];

  if (paidPatterns.some((p) => p.test(content))) {
    result.paymentStatus = 'paid';
  } else if (pendingPatterns.some((p) => p.test(content))) {
    result.paymentStatus = 'pending';
  }

  // Payment method
  const paymentMethodPatterns = [
    /(?:m[eé]todo|forma|medio)\s+de\s+pago[:\s]+([^\n\r]+)/i,
    /(?:payment\s+method)[:\s]+([^\n\r]+)/i,
  ];
  for (const pattern of paymentMethodPatterns) {
    const match = content.match(pattern);
    if (match) {
      result.paymentMethod = match[1].trim();
      break;
    }
  }

  // Shipping method
  const shippingPatterns = [
    /(?:m[eé]todo|forma|tipo)\s+de\s+env[ií]o[:\s]+([^\n\r]+)/i,
    /(?:shipping\s+method)[:\s]+([^\n\r]+)/i,
    /(?:entrega|delivery)[:\s]+([^\n\r]+)/i,
  ];
  for (const pattern of shippingPatterns) {
    const match = content.match(pattern);
    if (match) {
      result.shippingMethod = match[1].trim();
      break;
    }
  }

  // Items: try to extract product lines
  // Common pattern: "ProductName x Qty - $Price" or "Qty x ProductName $Price"
  const itemPatterns = [
    /(?:^|\n)\s*[-•]\s*(.+?)\s+x\s*(\d+)\s*[-–]\s*\$?\s*([\d.,]+)/gm,
    /(?:^|\n)\s*(\d+)\s*x\s+(.+?)\s*[-–]\s*\$?\s*([\d.,]+)/gm,
    /(?:^|\n)\s*[-•]\s*(.+?)\s*\|\s*(\d+)\s*\|\s*\$?\s*([\d.,]+)/gm,
  ];

  for (const pattern of itemPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (pattern === itemPatterns[1]) {
        // "Qty x Name $Price" format
        result.items.push({
          name: match[2].trim(),
          quantity: parseInt(match[1], 10),
          price: parseFloat(match[3].replace(/\./g, '').replace(',', '.')),
        });
      } else {
        // "Name x Qty - $Price" format
        result.items.push({
          name: match[1].trim(),
          quantity: parseInt(match[2], 10),
          price: parseFloat(match[3].replace(/\./g, '').replace(',', '.')),
        });
      }
    }
    if (result.items.length > 0) break;
  }

  return result;
}

/**
 * Parser específico para Tiendanube / Nuvemshop.
 * Tiendanube sends emails with a specific format.
 */
function parseTiendanubeOrderEmail(content) {
  const result = parseGenericOrderEmail(content);

  // Tiendanube-specific order number patterns
  const tnOrderMatch = content.match(
    /(?:Pedido|Venta)\s*#(\d+)/i
  );
  if (tnOrderMatch) {
    result.orderNumber = `#${tnOrderMatch[1]}`;
  }

  // Tiendanube payment status patterns
  if (
    /pago\s+(confirmado|aprobado|acreditado)/i.test(content) ||
    /El pago fue aprobado/i.test(content) ||
    /estado.*aprobado/i.test(content)
  ) {
    result.paymentStatus = 'paid';
  }

  // Tiendanube often includes "Datos del comprador" section
  const buyerSection = content.match(
    /(?:Datos del comprador|Datos del cliente)[:\s]*\n([\s\S]*?)(?:\n\s*\n|Datos de env|Productos|$)/i
  );
  if (buyerSection) {
    const section = buyerSection[1];
    const nameLine = section.match(/(?:Nombre)[:\s]+(.+)/i);
    if (nameLine) result.customer.name = nameLine[1].trim();

    const emailLine = section.match(/([\w.+-]+@[\w-]+\.[\w.]+)/);
    if (emailLine) result.customer.email = emailLine[1];

    const phoneLine = section.match(/(?:Tel|Cel)[:\s]+([\d\s\-+()]+)/i);
    if (phoneLine) result.customer.phone = phoneLine[1].trim();
  }

  // Tiendanube shipping address section
  const shippingSection = content.match(
    /(?:Datos de env[ií]o|Direcci[oó]n de env[ií]o)[:\s]*\n([\s\S]*?)(?:\n\s*\n|Productos|Resumen|$)/i
  );
  if (shippingSection) {
    const lines = shippingSection[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l);
    if (lines.length > 0) {
      result.customer.address = lines.join(', ');
    }
  }

  return result;
}

/**
 * Main parse function: auto-detects platform and routes to specific parser.
 */
function parseOrderEmail(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  if (isTiendanubeEmail(content)) {
    console.log('[EcommerceParser] Detected Tiendanube email format');
    return parseTiendanubeOrderEmail(content);
  }

  console.log('[EcommerceParser] Using generic email parser');
  return parseGenericOrderEmail(content);
}

module.exports = {
  looksLikeOrderEmail,
  parseOrderEmail,
  isTiendanubeEmail,
  parseGenericOrderEmail,
  parseTiendanubeOrderEmail,
};
