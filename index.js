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

// --- NEW: LOG USER LANGUAGE PREFERENCE ---
async function logLanguage(psid, lang) {
    try {
        const gsapi = google.sheets({ version: 'v4', auth: client });
        // We'll append to a new tab called 'UserPrefs'
        await gsapi.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'UserPrefs!A:B',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[psid, lang]] }
        });
    } catch (e) { console.error("❌ Language logging failed", e); }
}

// --- UPDATED: SEARCH FAQ TAB WITH LANGUAGE AWARENESS ---
async function getSmartReply(userMessage, psid) {
    try {
        await client.authorize();
        const gsapi = google.sheets({ version: 'v4', auth: client });
        
        // 1. Get FAQ Data
        const faqResponse = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'FAQ!A2:B200', 
        });

        // 2. Try to detect language from the text characters
        let detectedLang = 'EN'; 
        if (/[\u0980-\u09FF]/.test(userMessage)) detectedLang = 'BN';
        if (/[çğıöşüİ]/.test(userMessage.toLowerCase())) detectedLang = 'TR';
        if (/[\u0600-\u06FF]/.test(userMessage)) detectedLang = 'AR';

        const rows = faqResponse.data.values;
        if (rows && rows.length) {
            const cleanUserMsg = userMessage.toLowerCase().trim();
            for (const row of rows) {
                if (!row[0] || !row[1]) continue;
                const keyword = row[0].toLowerCase().trim();
                if (cleanUserMsg.includes(keyword)) return row[1]; 
            }
        }

        // 3. Fallback logic - only sends the language detected
        const fallbacks = {
            'EN': "I'm sorry, I didn't catch that. Try keywords like 'Volunteer', 'Donate', 'Apply' or 'Contact'.",
            'BN': "দুঃখিত, আমি বুঝতে পারিনি। দয়া করে 'স্বেচ্ছাসেবক', 'দান', 'আবেদন' বা 'যোগাযোগ' এর মতো শব্দ ব্যবহার করুন।",
            'TR': "Üzgünüm, anlayamadım. Lütfen 'Gönüllü', 'Bağış', 'Başvur' veya 'İletişim' gibi kelimeleri deneyin.",
            'AR': "عذراً، لم أفهم ذلك. يرجى محاولة استخدام كلمات مثل 'متطوع' أو 'تبرع' أو 'تقديم' أو 'اتصال'."
        };

        return fallbacks[detectedLang] || fallbacks['EN'];

    } catch (error) {
        console.error('❌ Lookup Error:', error);
        return "I'm having trouble accessing my database.";
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

async function sendToMessenger(psid, text) {
    try {
        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: psid },
            message: { text: text }
        });
    } catch (e) {
        console.error("❌ Messenger API Error:", e.response ? e.response.data : e.message);
    }
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
            if (!entry.messaging) return;
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.postback) {
                const payload = webhook_event.postback.payload;
                let responseText = "";
                let selectedLang = "EN";

                if (payload === 'LANG_EN') {
                    responseText = "Welcome to Bangali Foundation! How can we help you today?\n\nYou can ask about:\n- Becoming a Beneficiary\n- Volunteering\n- Partnerships\n- Our Projects or Team";
                    selectedLang = "EN";
                } else if (payload === 'LANG_BN') {
                    responseText = "বাঙালি ফাউন্ডেশনে আপনাকে স্বাগতম! আমরা আপনাকে কীভাবে সাহায্য করতে পারি?\n\nআপনি জিজ্ঞাসা করতে পারেন:\n- হিতাধিকারী হওয়া\n- স্বেচ্ছাসেবক\n- অংশীদারিত্ব\n- আমাদের প্রজেক্ট বা টিম";
                    selectedLang = "BN";
                } else if (payload === 'LANG_TR') {
                    responseText = "Bangali Vakfı'na hoş geldiniz! Size nasıl yardımcı olabiliriz?\n\nŞunlar hakkında soru sorabilirsiniz:\n- Yararlanıcı Olmak\n- Gönüllülük\n- Ortaklıklar\n- Projelerimiz veya Ekibimiz";
                    selectedLang = "TR";
                } else if (payload === 'LANG_AR') {
                    responseText = "مرحباً بكم في مؤسسة بنغالي! كيف يمكننا مساعدتكم اليوم؟\n\nيمكنك السؤال عن:\n- كيف تصبح مستفيداً\n- التطوع\n- الشراكات\n- مشاريعنا أو فريقنا";
                    selectedLang = "AR";
                }
                
                await logLanguage(sender_psid, selectedLang); // SAVE CHOICE
                await sendToMessenger(sender_psid, responseText);
            } 
            else if (webhook_event.message && webhook_event.message.text) {
                const user_text = webhook_event.message.text;
                // PASS sender_psid to getSmartReply
                const bot_reply = await getSmartReply(user_text, sender_psid);
                await sendToMessenger(sender_psid, bot_reply);
                await logToSheet(sender_psid, user_text, bot_reply);
            }
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bot live on ${PORT}`));