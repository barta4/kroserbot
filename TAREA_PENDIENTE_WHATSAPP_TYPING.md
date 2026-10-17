# 📌 Tarea Pendiente: Indicador de "Escribiendo..." en WhatsApp

## Diagnóstico y Contexto
- **Problema actual:** El bot ya ejecuta `chatwootService.toggleTypingStatus(..., 'on')` antes de consultar al LLM y buscar productos en el catálogo, pero los usuarios en WhatsApp no ven el estado "escribiendo...".
- **Causa raíz confirmada:** Chatwoot (incluso en su versión v4.12+ donde habilitó el endpoint para bots) únicamente propaga el typing status por WebSockets internos hacia el panel de agentes y el widget web. **No tiene soporte nativo para propagar el typing a la API de WhatsApp** (Issue abierto en GitHub de Chatwoot: `#13984`).

---

## Solución Propuesta (Bypass directo a Meta Cloud API)
Cuando el bot recibe un mensaje de WhatsApp (identificable en el payload de Uruchat/Chatwoot), disparar directamente a la Graph API de Meta el indicador de escritura:

```http
POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "<wamid_del_mensaje_cliente>",
  "typing_indicator": {
    "type": "text"
  }
}
```

### Beneficios:
1. **Doble tilde azul (leído):** Marca el mensaje entrante como leído de inmediato.
2. **"Escribiendo...":** Muestra los puntos suspensivos en el celular del cliente durante un máximo de 25 segundos (o hasta que se envíe la respuesta), logrando el efecto humano deseado.
3. **No altera Uruchat:** El envío del texto final y la gestión de la conversación siguen haciéndose normalmente a través de Uruchat.

---

## Qué se necesita para activarlo cuando se retome:
1. **Credenciales de Meta / WhatsApp Business:**
   - `WHATSAPP_PHONE_NUMBER_ID` (disponible en la bandeja de Uruchat o en Meta Business Manager).
   - `WHATSAPP_ACCESS_TOKEN` (Token permanente de System User con permiso `whatsapp_business_messaging`).
2. **Implementación en backend:**
   - Crear `backend/services/media/whatsappTypingService.js`.
   - Registrar variables en `backend/config/secretKeys.js` y `configuracionController.js`.
   - Invocarlo en `webhookService.js` en el paso previo a la llamada del LLM (`generateWithTools`) y entre burbujas si hay chunking.
   - Tests unitarios con Axios mockeado.
