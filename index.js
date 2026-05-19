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

// POST: Handle Incoming Messages
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    // 1. IMMEDIATELY tell Meta we received the data to prevent the retry loop
    res.status(200).send('EVENT_RECEIVED');

    // 2. Process the events in the background asynchronously
    body.entry.forEach(async (entry) => {
      // Security Check: Ensure messaging array exists
      if (!entry.messaging || entry.messaging.length === 0) return;

      const webhook_event = entry.messaging[0];
      
      // Skip delivery, read receipts, or echo messages from the bot itself
      if (webhook_event.delivery || webhook_event.read || webhook_event.message?.is_echo) return;

      const sender_psid = webhook_event.sender?.id;
      const messageId = webhook_event.message?.mid;

      // Deduplication check
      if (isDuplicateMessage(messageId)) {
        console.log(`⏭️ Retried duplicate message intercepted and ignored: ${messageId}`);
        return;
      }

      // Handle message text processing safely
      if (webhook_event.message && webhook_event.message.text) {
        const message_text = webhook_event.message.text.toLowerCase().trim();
        let response_text = `Bangali Foundation received: ${webhook_event.message.text}`;

        // Simple Language Logic
        if (message_text.includes("merhaba") || message_text.includes("selam")) {
          response_text = "Bangali Foundation'a hoş geldiniz! Size nasıl yardımcı olabilirim?";
        } else if (message_text.includes("مرحبا") || message_text.includes("سلام")) {
          response_text = "مرحباً بكم في مؤسسة بنغالي! كيف يمكننا مساعدتكم؟";
        } else if (message_text.includes("hello") || message_text.includes("hi")) {
          response_text = "Welcome to Bangali Foundation! How can we help you today?";
        }

        // Send response via background Axios post
        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: response_text }
          });
          console.log(`✅ Reply sent successfully to user ${sender_psid}`);
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