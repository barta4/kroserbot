require('dotenv').config();

let axios = null;
try {
  axios = require('axios');
} catch (_err) {
  axios = null;
}

const configuracionRepo = require('../../repositories/configuracionRepository');
const logger = require('../../config/logger');

async function getChatwootClient() {
  if (!axios) return null;

  const dbUrl = await configuracionRepo.get('chatwoot_base_url');
  const dbToken = await configuracionRepo.get('chatwoot_api_token');

  const baseURL = (dbUrl && dbUrl.trim()) || process.env.CHATWOOT_BASE_URL || process.env.CHATWOOT_API_URL || 'https://app.chatwoot.com';
  const token = (dbToken && dbToken.trim()) || process.env.CHATWOOT_API_ACCESS_TOKEN || process.env.CHATWOOT_API_TOKEN || '';

  if (!token) return null;

  return axios.create({
    baseURL,
    headers: {
      api_access_token: token,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

module.exports = {
  async sendMessage(accountId, conversationId, content) {
    const client = await getChatwootClient();
    if (!client) {
      logger.info('Chatwoot outgoing mock', { conversationId, contentLength: content.length });
      return { success: true, mock: true };
    }

    try {
      const response = await client.post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
        {
          content,
          message_type: 'outgoing',
          private: false,
        }
      );
      return response.data;
    } catch (err) {
      logger.error('Chatwoot send error', { conversationId, error: err.message });
      return { success: false, error: err.message };
    }
  },

  async assignAgent(accountId, conversationId, assigneeId) {
    const client = await getChatwootClient();
    if (!client) {
      logger.info('Chatwoot assign mock', { conversationId, assigneeId });
      return { success: true, mock: true };
    }

    try {
      const response = await client.post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/assignments`,
        {
          assignee_id: assigneeId,
        }
      );
      return response.data;
    } catch (err) {
      logger.error('Chatwoot assign error', { conversationId, error: err.message });
      return { success: false, error: err.message };
    }
  },

  async toggleTypingStatus(accountId, conversationId, typingStatus = 'on') {
    const client = await getChatwootClient();
    if (!client) {
      logger.info('Chatwoot typing indicator mock', { conversationId, typingStatus });
      return { success: true, mock: true };
    }

    try {
      const response = await client.post(
        `/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_typing_status`,
        {
          typing_status: typingStatus === 'off' ? 'off' : 'on',
        }
      );
      return response.data;
    } catch (err) {
      // Typing status failures should not disrupt conversation flow
      logger.warn('Chatwoot typing indicator error', { conversationId, typingStatus, error: err.message });
      return { success: false, error: err.message };
    }
  },

  async getInboxes(accountId = null) {
    const client = await getChatwootClient();
    const accId = accountId || (await configuracionRepo.get('chatwoot_account_id')) || process.env.CHATWOOT_ACCOUNT_ID || 1;

    if (!client) {
      // Fallback inboxes if Chatwoot is not connected or running in local dev
      return [
        { id: 1, name: 'WhatsApp Ventas Central', channel_type: 'Channel::Whatsapp', phone_number: '+598 99 000 111', is_mock: true },
        { id: 2, name: 'Instagram Direct @kroser', channel_type: 'Channel::Instagram', is_mock: true },
        { id: 3, name: 'Chat Web Widget Oficial', channel_type: 'Channel::WebWidget', is_mock: true },
        { id: 4, name: 'Consultas Email', channel_type: 'Channel::Email', email: 'contacto@kroser.com.uy', is_mock: true },
        { id: 5, name: 'Facebook Messenger', channel_type: 'Channel::FacebookPage', is_mock: true },
        { id: 6, name: 'Canal Telegram Soporte', channel_type: 'Channel::Telegram', is_mock: true },
      ];
    }

    try {
      const response = await client.get(`/api/v1/accounts/${accId}/inboxes`);
      const payload = response.data?.payload || response.data || [];
      return payload.map(inbox => ({
        id: inbox.id,
        name: inbox.name,
        channel_type: inbox.channel_type,
        phone_number: inbox.phone_number || (inbox.channel && inbox.channel.phone_number) || '',
        email: inbox.email || (inbox.channel && inbox.channel.email) || '',
        avatar_url: inbox.avatar_url,
        greeting_enabled: inbox.greeting_enabled,
        is_mock: false,
      }));
    } catch (err) {
      logger.error('Chatwoot getInboxes error', { error: err.message });
      // Return fallback gracefully
      return [
        { id: 1, name: 'WhatsApp Ventas Central (Offline)', channel_type: 'Channel::Whatsapp', is_mock: true },
        { id: 2, name: 'Instagram Direct (Offline)', channel_type: 'Channel::Instagram', is_mock: true },
        { id: 3, name: 'Chat Web Widget (Offline)', channel_type: 'Channel::WebWidget', is_mock: true },
      ];
    }
  },
};

