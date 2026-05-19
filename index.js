const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = 3000;

// This MUST be first - it tells Ngrok to skip the warning page
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Global memory cache to prevent duplicate Meta loops (stores for 2 minutes)
const processedMessageIds = new Map();

function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  if (processedMessageIds.has(messageId)) return true;

  processedMessageIds.set(messageId, true);
  setTimeout(() => processedMessageIds.delete(messageId), 120000);
  return false;
}

// GET: For Facebook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === 'bangali_foundation_2026') {
    console.log('✅ Webhook Verified Successfully');
    return res.status(200).send(challenge);
  }
  res.status(200).send('Server is Up');
});







app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    // 1. Instantly tell Meta we received the event so it never loops
    res.status(200).send('EVENT_RECEIVED');

    // 2. Process events in the background
    body.entry.forEach(async (entry) => {
      if (!entry.messaging || entry.messaging.length === 0) return;

      const webhook_event = entry.messaging[0];
      if (webhook_event.delivery || webhook_event.read || webhook_event.message?.is_echo) return;

      const sender_psid = webhook_event.sender?.id;
      const messageId = webhook_event.message?.mid || webhook_event.postback?.mid;

      // Deduplication check
      if (isDuplicateMessage(messageId)) return;

      let incoming_payload = "";

      // Check if it's a typed text message
      if (webhook_event.message && webhook_event.message.text) {
        incoming_payload = webhook_event.message.text.toLowerCase().trim();
      } 
      // Check if it's a Quick Reply button click
      else if (webhook_event.message && webhook_event.message.quick_reply) {
        incoming_payload = webhook_event.message.quick_reply.payload.toLowerCase().trim();
      } 
      // Check if it's a persistent menu or Postback button click
      else if (webhook_event.postback) {
        incoming_payload = webhook_event.postback.payload.toLowerCase().trim();
      }

      // If we captured an action or text, process the language routing
      if (incoming_payload) {
        let response_text = `Bangali Foundation received your request.`;

        // Language Logic (Matches both typed words and button payloads!)
        if (incoming_payload.includes("merhaba") || incoming_payload.includes("selam") || incoming_payload.includes("turkish")) {
          response_text = "Bangali Foundation'a hoş geldiniz! Size nasıl yardımcı olabilirim?";
        } else if (incoming_payload.includes("مرحبا") || incoming_payload.includes("سلام") || incoming_payload.includes("arabic")) {
          response_text = "مرحباً بكم في مؤسسة بنغالي! كيف يمكننا مساعدتكم؟";
        } else if (incoming_payload.includes("hello") || incoming_payload.includes("hi") || incoming_payload.includes("english")) {
          response_text = "Welcome to Bangali Foundation! How can we help you today?";
        }

        // Send the response back to the user
        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: response_text }
          });
          console.log(`✅ Reply sent successfully for payload: "${incoming_payload}" to user ${sender_psid}`);
        } catch (error) {
          const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
          console.error('❌ Error sending reply:', errMsg);
        }
      }
    });

  } else {
    res.sendStatus(404);
  }
});








app.listen(PORT, () => {
    console.log('------------------------------------');
    console.log(`🚀 SUCCESS: Bangali Foundation Bot is live!`);
    console.log(`📡 Listening on Port: ${PORT}`);
    console.log('------------------------------------');
});