const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const keys = JSON.parse(process.env.GOOGLE_CREDS);


const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const SPREADSHEET_ID = '16kuhcidjptgfxqaB1y0ujeEb59zrewVkUw7o6bVWynw';

// Google Sheets Setup
const client = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
);

async function logToSheet(psid, message, response) {
    try {
        await client.authorize();
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const timestamp = new Date().toLocaleString();
        
        const appendOptions = {
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:D',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[timestamp, psid, message, response]] }
        };

        await gsapi.spreadsheets.values.append(appendOptions);
        console.log('📊 Logged to Google Sheet!');
    } catch (error) {
        console.error('❌ Google Sheets Error:', error);
    }
}

// Webhook Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === 'bangali_foundation_2026') {
        return res.status(200).send(challenge);
    }
    res.status(200).send('Server is Up');
});

// Handling Messages
app.post('/webhook', (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED'); // Tell FB we got it immediately

        body.entry.forEach(async (entry) => {
            const webhook_event = entry.messaging[0];
            if (webhook_event.message && webhook_event.message.text) {
                const sender_psid = webhook_event.sender.id;
                const message_text = webhook_event.message.text;
                const bot_reply = `Bangali Foundation received: ${message_text}`;

                console.log(`📩 Received: "${message_text}"`);

                // 1. Send reply to User
                try {
                    await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                        recipient: { id: sender_psid },
                        message: { text: bot_reply }
                    });
                    console.log('✅ Reply sent!');
                    
                    // 2. Log details to Google Sheet
                    await logToSheet(sender_psid, message_text, bot_reply);
                } catch (error) {
                    console.error('❌ Messenger Error:', error.response ? error.response.data : error);
                }
            }
        });
    } else {
        res.sendStatus(404);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bot is live on port ${PORT}`);
});