require('dotenv').config();

let axios = null;
try {
  axios = require('axios');
} catch (_err) {
  axios = null;
}

const CHATWOOT_URL = process.env.CHATWOOT_API_URL || 'https://app.chatwoot.com';
const CHATWOOT_TOKEN = process.env.CHATWOOT_API_TOKEN || '';

let client = null;
if (axios && CHATWOOT_TOKEN) {
  client = axios.create({
    baseURL: CHATWOOT_URL,
    headers: {
      api_access_token: CHATWOOT_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

module.exports = {
  async sendMessage(accountId, conversationId, content) {
    if (!client) {
      console.log(`[Chatwoot Outgoing Mock] Conv #${conversationId}: "${content}"`);
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
      console.error(`[Chatwoot Error] Conv #${conversationId}:`, err.message);
      return { success: false, error: err.message };
    }
  },

  async assignAgent(accountId, conversationId, assigneeId) {
    if (!client) {
      console.log(`[Chatwoot Assign Mock] Conv #${conversationId} -> Agent #${assigneeId}`);
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
      console.error(`[Chatwoot Assign Error] Conv #${conversationId}:`, err.message);
      return { success: false, error: err.message };
    }
  },
};
