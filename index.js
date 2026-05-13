const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(bodyParser.json());

// --- CONFIGURATION ---
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const SPREADSHEET_ID = '16kuhcidjptgfxqaB1y0ujeEb59zrewVkUw7o6bVWynw';

// Gemini 1.5 Flash Initialization
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ 
    model: "gemini-3-flash-001", // Added the version suffix
    systemInstruction: "You are the official assistant for Bangali Foundation. Be polite, professional, and concise. Use the user's preferred language. If you don't know an answer, refer them to mohammadyasin568@gmail.com."
});

// Google Sheets Auth
let keys = JSON.parse(process.env.GOOGLE_CREDS);
const client = new google.auth.JWT(
    keys.client_email, null, keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
);

// --- HELPER: GET USER LANGUAGE ---
async function getUserLanguage(psid) {
    try {
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'UserPrefs!A:B',
        });
        const rows = response.data.values;
        if (rows) {
            const userRow = rows.reverse().find(row => row[0] === psid);
            return userRow ? userRow[1] : 'EN';
        }
    } catch (e) { return 'EN'; }
}

// --- LOG LANGUAGE SELECTION ---
async function logLanguage(psid, lang) {
    try {
        const gsapi = google.sheets({ version: 'v4', auth: client });
        await gsapi.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'UserPrefs!A:B',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[psid, lang]] }
        });
    } catch (e) { console.error("Error logging language", e); }
}



// --- CORE: SMART REPLY LOGIC ---
async function getSmartReply(userMessage, psid) {
    try {
        await client.authorize();
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const lang = await getUserLanguage(psid);

        // 1. FAQ Check (Works fine)
        const faqRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'FAQ!A2:B500',
        });
        const rows = faqRes.data.values;
        if (rows) {
            const match = rows.find(row => userMessage.toLowerCase().includes(row[0].toLowerCase()));
            if (match) return match[1];
        }

        // USE THIS simplified AI call inside your getSmartReply function
        const result = await aiModel.generateContent(`User Language: ${lang}. Message: ${userMessage}`);
        const response = await result.response;
            return response.text();


        
        // Final safety check: if AI returns empty
        return text && text.length > 0 ? text : "I understand you, but I'm having trouble phrasing a reply. Please try again!";

    } catch (error) {
        // This log will tell us EXACTLY why it's failing in Render Logs
        console.error('--- GEMINI ERROR DETAIL ---');
        console.error(error.message); 
        return "I'm having a technical moment. Please try again or email us!";
    }
}



// --- MESSENGER SENDING ---
async function sendToMessenger(psid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: psid },
            message: { text: text }
        });
    } catch (e) { console.error("Messenger Post Error"); }
}

// --- WEBHOOKS ---
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
            if (!entry.messaging) return;
            const event = entry.messaging[0];
            const psid = event.sender.id;

            if (event.postback) {
                const payload = event.postback.payload;
                const langMap = { 'LANG_EN': 'EN', 'LANG_BN': 'BN', 'LANG_TR': 'TR', 'LANG_AR': 'AR' };
                const selected = langMap[payload] || 'EN';
                await logLanguage(psid, selected);
                
                const welcome = {
                    'EN': "Welcome to Bangali Foundation! How can we help?",
                    'BN': "বাঙালি ফাউন্ডেশনে স্বাগতম! আমরা কীভাবে সাহায্য করতে পারি?",
                    'TR': "Bangali Vakfı'na hoş geldiniz! Nasıl yardımcı olabiliriz?",
                    'AR': "مرحباً بكم في مؤسسة بنغالي! كيف يمكننا مساعدتكم؟"
                };
                await sendToMessenger(psid, welcome[selected]);
            } 
            else if (event.message && event.message.text) {
                const reply = await getSmartReply(event.message.text, psid);
                await sendToMessenger(psid, reply);
            }
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bangali Bot with Gemini 1.5 Flash is Live!`));