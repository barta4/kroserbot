require('dotenv').config();

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (_err) {
  nodemailer = null;
}

const AREA_MAILS = {
  ecommerce: process.env.MAIL_ECOMMERCE || 'ecommerce@kroser.com.uy',
  rrhh: process.env.MAIL_RRHH || 'rrhh@kroser.com.uy',
  administracion: process.env.MAIL_ADMIN || 'admin@kroser.com.uy',
  franquicias: process.env.MAIL_FRANQUICIAS || 'franquicias@kroser.com.uy',
  info: process.env.MAIL_INFO || 'info@kroser.com.uy',
};

async function sendEmailWithRetry(mailOptions, retries = 3) {
  if (!nodemailer || !process.env.SMTP_HOST) {
    console.log(`[Email Mock] Sent to ${mailOptions.to} - Subject: "${mailOptions.subject}"`);
    return { success: true, mock: true };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[Email Sent] MessageId: ${info.messageId}`);
      return info;
    } catch (err) {
      console.warn(`[Email Attempt ${attempt}/${retries} failed] ${err.message}`);
      if (attempt === retries) return { success: false, error: err.message };
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

module.exports = {
  async sendDerivationAlert({ area, clienteNombre, clienteTelefono, clienteMail, conversationId, motivo }) {
    const targetMail = AREA_MAILS[area?.toLowerCase()] || AREA_MAILS.info;
    const subject = `[Bot Kroser] Derivación a Humano - Área: ${(area || 'INFO').toUpperCase()} (Conv #${conversationId})`;
    const body = `
Se ha registrado una solicitud de derivación en Chatwoot.

Detalles del Cliente:
- Nombre: ${clienteNombre || 'No especificado'}
- Teléfono: ${clienteTelefono || 'No especificado'}
- Email: ${clienteMail || 'No especificado'}
- ID Conversación Chatwoot: #${conversationId}
- Área de Derivación: ${(area || 'INFO').toUpperCase()}
- Motivo / Contexto: ${motivo || 'Atención requerida por agente'}

Por favor, ingresar a Chatwoot para retomar el contacto.
    `;

    return await sendEmailWithRetry({
      from: process.env.MAIL_FROM || 'bot@kroser.com.uy',
      to: targetMail,
      subject,
      text: body,
    });
  },

  async sendNewOrderAlert(pedido) {
    const targetMail = AREA_MAILS.ecommerce;
    const subject = `[Bot Kroser] NUEVO PEDIDO PENDIENTE #${pedido.id}`;
    const body = `
Un nuevo pedido ha sido generado vía WhatsApp / Chatwoot y requiere revisión humana.

Detalles del Pedido:
- ID Pedido: #${pedido.id}
- ID Conversación Chatwoot: #${pedido.conversation_id}
- Cliente: ${JSON.stringify(pedido.cliente, null, 2)}
- Items: ${JSON.stringify(pedido.items, null, 2)}
- Estado: PENDIENTE

Accede al Panel de Administración de Kroser para Confirmar o Rechazar este pedido.
    `;

    return await sendEmailWithRetry({
      from: process.env.MAIL_FROM || 'bot@kroser.com.uy',
      to: targetMail,
      subject,
      text: body,
    });
  },
};
