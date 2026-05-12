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
        
        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'FAQ!A2:B200', 
        });

        const rows = response.data.values;
        if (rows && rows.length) {
            // Clean up the user's message (lowercase and remove extra spaces)
            const cleanUserMsg = userMessage.toLowerCase().trim();

            for (const row of rows) {
                if (!row[0] || !row[1]) continue;

                const keyword = row[0].toLowerCase().trim();
                const botResponse = row[1];

                // Check if the user's message contains the keyword
                if (cleanUserMsg.includes(keyword)) {
                    return botResponse; 
                }
            }
        }
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
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.postback) {
                const payload = webhook_event.postback.payload;
                let responseText = "";

                if (payload === 'LANG_EN') {
                    responseText = "Welcome to Bangali Foundation! How can we help you today?\n\nYou can ask about:\n- Becoming a Beneficiary\n- Volunteering\n- Partnerships\n- Our Projects or Team";
                } else if (payload === 'LANG_BN') {
                    responseText = "বাঙালি ফাউন্ডেশনে আপনাকে স্বাগতম! আমরা আপনাকে কীভাবে সাহায্য করতে পারি?\n\nআপনি জিজ্ঞাসা করতে পারেন:\n- হিতাধিকারী হওয়া\n- স্বেচ্ছাসেবক\n- অংশীদারিত্ব\n- আমাদের প্রজেক্ট বা টিম";
                } else if (payload === 'LANG_TR') {
                    responseText = "Bangali Vakfı'na hoş geldiniz! Size nasıl yardımcı olabiliriz?\n\nŞunlar hakkında soru sorabilirsiniz:\n- Yararlanıcı Olmak\n- Gönüllülük\n- Ortaklıklar\n- Projelerimiz veya Ekibimiz";
                } else if (payload === 'LANG_AR') {
                    responseText = "مرحباً بكم في مؤسسة بنغالي! كيف يمكننا مساعدتكم اليوم؟\n\nيمكنك السؤال عن:\n- كيف تصبح مستفيداً\n- التطوع\n- الشراكات\n- مشاريعنا أو فريقنا";
                }

                await sendToMessenger(sender_psid, responseText);
            } 
            else if (webhook_event.message && webhook_event.message.text) {
                const user_text = webhook_event.message.text;
                const bot_reply = await getSmartReply(user_text);
                await sendToMessenger(sender_psid, bot_reply);
                await logToSheet(sender_psid, user_text, bot_reply);
            }
        });
    }
});