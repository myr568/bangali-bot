const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

// This MUST be first - it tells Ngrok to skip the warning page
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// GET: For Facebook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === 'bangali_foundation_2026') {
    console.log('✅ Webhook Verified Successfully');
    return res.status(200).send(challenge);
  }
  res.status(200).send('Server is Up'); // Always send 200 to keep connection green
});



const axios = require('axios');
const PAGE_ACCESS_TOKEN = 'EAAVcyCPNmgABRdXoOO7fpRONvTi7u6GzVXni8VKbHKSFP3EoRobauncltjAYfFMPq34vCHr1fz8U0RRqqPQyLIZCTHgjIqI0ZA4aFHOu7G8tZAS9S5iZBn2Vte5LZBLrCrw5u1MVWYvxefUDFQ9mjg5fxwvN2ZCqJwToaRo0fXSgeJUvSnq7rF7KK1zDQSLT0LCAhimHZAbXQeGWZBzsnWhpZCAZDZD';

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhook_event = entry.messaging[0];
      const sender_psid = webhook_event.sender.id; // User's ID
      const message_text = webhook_event.message.text; // What they said

      console.log(`📩 Received: "${message_text}" from ${sender_psid}`);

      // SEND A REPLY
      try {
        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: `Bangali Foundation received: ${message_text}` }
        });
        console.log('✅ Reply sent!');
      } catch (error) {
        console.error('❌ Error sending reply:', error.response.data);
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log('------------------------------------');
    console.log(`🚀 SUCCESS: Bangali Foundation Bot is live!`);
    console.log(`📡 Listening on Port: ${PORT}`);
    console.log('------------------------------------');
});