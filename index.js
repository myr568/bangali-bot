const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const SPREADSHEET_ID = '16kuhcidjptgfxqaB1y0ujeEb59zrewVkUw7o6bVWynw';

let keys = JSON.parse(process.env.GOOGLE_CREDS);

const client = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
);

// --- NEW: FUNCTION TO SEARCH THE FAQ TAB ---
async function getSmartReply(userMessage) {
    try {
        await client.authorize();
        const gsapi = google.sheets({ version: 'v4', auth: client });
        
        // Fetch the FAQ tab data
        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'FAQ!A2:B100', // Looking at Keywords and Responses
        });

        const rows = response.data.values;
        if (rows && rows.length) {
            // Check if any keyword exists inside the user's message
            for (const row of rows) {
                const keyword = row[0].toLowerCase();
                if (userMessage.toLowerCase().includes(keyword)) {
                    return row[1]; // Return the matching response
                }
            }
        }
        // Fallback if no keyword is found
        return "Thank you for contacting Bangali Foundation. One of our team members will get back to you soon. For immediate help, type 'Help'.";
    } catch (error) {
        console.error('❌ Lookup Error:', error);
        return "I'm having trouble accessing my database. Please try again later.";
    }
}

async function logToSheet(psid, message, response) {
    try {
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const timestamp = new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"});
        await gsapi.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:D',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[timestamp, psid, message, response]] }
        });
    } catch (e) { console.error("Logging failed", e); }
}

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === 'bangali_foundation_2026') {
        res.send(req.query['hub.challenge']);
    }
});

app.post('/webhook', (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');
        body.entry.forEach(async (entry) => {
            const event = entry.messaging[0];
            if (event.message && event.message.text) {
                const sender_psid = event.sender.id;
                const user_text = event.message.text;

                // GET THE SMART REPLY
                const bot_reply = await getSmartReply(user_text);

                // SEND TO MESSENGER
                await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sender_psid },
                    message: { text: bot_reply }
                });

                // LOG THE INTERACTION
                await logToSheet(sender_psid, user_text, bot_reply);
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Intelligent Bot live on ${PORT}`));