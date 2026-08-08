require('dotenv').config();

let geminiClient = null;
try {
  if (process.env.GEMINI_API_KEY) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    geminiClient = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }
} catch (_err) {
  geminiClient = null;
}

let openaiClient = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (_err) {
  openaiClient = null;
}

async function callGemini(systemPrompt, userMessages) {
  if (!geminiClient) throw new Error('GEMINI_API_KEY missing or module unavailable');
  
  const historyText = userMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const fullPrompt = `${systemPrompt}\n\nConversación:\n${historyText}\n\nASISTENTE:`;
  
  const result = await geminiClient.generateContent(fullPrompt);
  const response = await result.response;
  return response.text();
}

async function callOpenAI(systemPrompt, userMessages) {
  if (!openaiClient) throw new Error('OPENAI_API_KEY missing or module unavailable');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...userMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.3,
  });

  return completion.choices[0].message.content;
}

module.exports = {
  async generateResponse(systemPrompt, userMessages) {
    try {
      if (process.env.GEMINI_API_KEY && geminiClient) {
        return await callGemini(systemPrompt, userMessages);
      }
    } catch (err) {
      console.warn(`[LLM] Gemini call fallback: ${err.message}`);
    }

    try {
      if (process.env.OPENAI_API_KEY && openaiClient) {
        return await callOpenAI(systemPrompt, userMessages);
      }
    } catch (err) {
      console.warn(`[LLM] OpenAI call fallback: ${err.message}`);
    }

    // Heuristic mock response
    const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
    if (lastUserMsg.toLowerCase().includes('factura') || lastUserMsg.toLowerCase().includes('reclamo')) {
      return 'DERIVAR: administracion';
    }
    if (lastUserMsg.toLowerCase().includes('comprar') || lastUserMsg.toLowerCase().includes('pedido')) {
      return '¡Perfecto! Con gusto te tomo el pedido. Por favor confirmame tu nombre, teléfono, dirección de entrega y los artículos que precisás.';
    }
    return '¡Hola! Bienvenido a Kroser. ¿En qué producto o consulta puedo ayudarte hoy?';
  },
};
