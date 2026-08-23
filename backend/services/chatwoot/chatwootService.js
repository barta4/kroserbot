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
};

