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

// Gemini Initialization
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    systemInstruction: `
        You are the official AI assistant for the Bangali Foundation.
        Website: https://bangalifoundation.org/
        
        CRITICAL RULES:
        1. Always represent https://bangalifoundation.org/ as our official site.
        2. Our mission is to provide aid, education, and support to underprivileged communities.
        3. Do NOT confuse us with cultural or heritage-only organizations.
        4. Treasurer: Md. Romjan.
        5. For technical issues, contact Mohammad Yasin (mohammadyasin568@gmail.com).
        
        TONE: Polite, professional, and concise.
        LANGUAGE: Always reply in the user's preferred language.
    `
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

// --- CORE: AI / FAQ LOGIC ---
async function getSmartReply(userMessage, psid) {
    try {
        await client.authorize();
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const lang = await getUserLanguage(psid);

        const faqRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'FAQ!A2:B500',
        });
        const rows = faqRes.data.values;
        if (rows) {
            const match = rows.find(row => userMessage.toLowerCase().includes(row[0].toLowerCase()));
            if (match) return match[1];
        }

        const result = await aiModel.generateContent(`User Language: ${lang}. Message: ${userMessage}`);
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error('--- ERROR LOG ---', error.message);
        return "I'm having a technical moment. Please try again or email us!";
    }
}

// --- MESSENGER SENDING ---
async function sendToMessenger(psid, text, quickReplies = null) {
    const payload = {
        recipient: { id: psid },
        message: { text: text }
    };
    if (quickReplies) payload.message.quick_replies = quickReplies;

    try {
        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, payload);
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

            // HANDLE LANGUAGE SELECTION (POSTBACK)
            if (event.postback) {
                const payload = event.postback.payload;
                const langMap = { 'LANG_EN': 'EN', 'LANG_BN': 'BN', 'LANG_TR': 'TR', 'LANG_AR': 'AR' };
                const selected = langMap[payload] || 'EN';
                await logLanguage(psid, selected);
                
                const menuTitles = {
                    'EN': "Welcome to Bangali Foundation! How can we help? Choose an option:",
                    'BN': "বাঙালি ফাউন্ডেশনে স্বাগতম! আমরা কীভাবে সাহায্য করতে পারি? একটি বিকল্প বেছে নিন:",
                    'TR': "Bangali Vakfı'na hoş geldiniz! Nasıl yardımcı olabiliriz? Bir seçenek belirleyin:",
                    'AR': "مرحباً بكم في مؤسسة بنغالي! كيف يمكننا مساعدتكم؟ اختر أحد الخيارات:"
                };

                const quickReplies = {
                    'EN': [
                        { content_type: "text", title: "Donate 💰", payload: "OPT_DONATE" },
                        { content_type: "text", title: "Volunteer 🤝", payload: "OPT_VOLUNTEER" },
                        { content_type: "text", title: "Need Aid? 🙋‍♂️", payload: "OPT_AID" },
                        { content_type: "text", title: "Partner 🏢", payload: "OPT_PARTNER" },
                        { content_type: "text", title: "Projects 📂", payload: "OPT_PROJECTS" }
                    ],
                    'BN': [
                        { content_type: "text", title: "দান করুন 💰", payload: "OPT_DONATE" },
                        { content_type: "text", title: "স্বেচ্ছাসেবক 🤝", payload: "OPT_VOLUNTEER" },
                        { content_type: "text", title: "সাহায্য চাই? 🙋‍♂️", payload: "OPT_AID" },
                        { content_type: "text", title: "পার্টনার 🏢", payload: "OPT_PARTNER" },
                        { content_type: "text", title: "প্রকল্প 📂", payload: "OPT_PROJECTS" }
                    ],
                    'TR': [
                        { content_type: "text", title: "Bağış Yap 💰", payload: "OPT_DONATE" },
                        { content_type: "text", title: "Gönüllü Ol 🤝", payload: "OPT_VOLUNTEER" },
                        { content_type: "text", title: "Yardım? 🙋‍♂️", payload: "OPT_AID" },
                        { content_type: "text", title: "Ortak Ol 🏢", payload: "OPT_PARTNER" },
                        { content_type: "text", title: "Projeler 📂", payload: "OPT_PROJECTS" }
                    ],
                    'AR': [
                        { content_type: "text", title: "تبرع الآن 💰", payload: "OPT_DONATE" },
                        { content_type: "text", title: "متطوع 🤝", payload: "OPT_VOLUNTEER" },
                        { content_type: "text", title: "بحاجة لمساعدة؟ 🙋‍♂️", payload: "OPT_AID" },
                        { content_type: "text", title: "شريك 🏢", payload: "OPT_PARTNER" },
                        { content_type: "text", title: "مشاريعنا 📂", payload: "OPT_PROJECTS" }
                    ]
                };

                await sendToMessenger(psid, menuTitles[selected], quickReplies[selected]);
            } 
            
            // HANDLE MESSAGES & BUTTON CLICKS
            else if (event.message && event.message.text) {
                if (event.message.quick_reply) {
                    const payload = event.message.quick_reply.payload;
                    const lang = await getUserLanguage(psid);
                    
                    const responses = {
                        'OPT_DONATE': {
                            'EN': "Thank you! Support us directly here: https://bangalifoundation.org/support-us/",
                            'BN': "ধন্যবাদ! সরাসরি আমাদের সাপোর্ট করুন এখানে: https://bangalifoundation.org/support-us/",
                            'TR': "Teşekkürler! Bize buradan doğrudan destek olabilirsiniz: https://bangalifoundation.org/support-us/",
                            'AR': "شكراً لك! ادعمنا مباشرة من هنا: https://bangalifoundation.org/support-us/"
                        },
                        'OPT_VOLUNTEER': {
                            'EN': "Click the link https://bangalifoundation.org/become-a-volunteer/ to fill up the form to be our volunteer.",
                            'BN': "আমাদের স্বেচ্ছাসেবক হতে এই লিঙ্কের ফর্মটি পূরণ করুন: https://bangalifoundation.org/become-a-volunteer/",
                            'TR': "Gönüllü olmak için şu bağlantıdaki formu doldurun: https://bangalifoundation.org/become-a-volunteer/",
                            'AR': "انقر على الرابط لتعبئة النموذج لتصبح متطوعاً: https://bangalifoundation.org/become-a-volunteer/"
                        },
                        'OPT_AID': {
                            'EN': "Click the link https://bangalifoundation.org/become-a-beneficiary/ to become a beneficiary.",
                            'BN': "সাহায্য পেতে এই লিঙ্কে ক্লিক করে আবেদন করুন: https://bangalifoundation.org/become-a-beneficiary/",
                            'TR': "Yardım almak için şu bağlantıya tıklayarak başvurun: https://bangalifoundation.org/become-a-beneficiary/",
                            'AR': "انقر على الرابط لتصبح مستفيداً من المساعدات: https://bangalifoundation.org/become-a-beneficiary/"
                        },
                        'OPT_PARTNER': {
                            'EN': "Fill in the form in the following link to become a partner: https://bangalifoundation.org/become-a-partner/",
                            'BN': "পার্টনার হতে নিচের লিঙ্কের ফর্মটি পূরণ করুন: https://bangalifoundation.org/become-a-partner/",
                            'TR': "Ortak olmak için şu bağlantıdaki formu doldurun: https://bangalifoundation.org/become-a-partner/",
                            'AR': "يرجى تعبئة النموذج لتصبح شريكاً لنا: https://bangalifoundation.org/become-a-partner/"
                        },
                        'OPT_PROJECTS': {
                            'EN': "Learn about our initiatives here: https://bangalifoundation.org/our-initiatives/",
                            'BN': "আমাদের উদ্যোগগুলো সম্পর্কে জানুন এখানে: https://bangalifoundation.org/our-initiatives/",
                            'TR': "Girişimlerimiz hakkında buradan bilgi alabilirsiniz: https://bangalifoundation.org/our-initiatives/",
                            'AR': "تعرف على مبادراتنا من هنا: https://bangalifoundation.org/our-initiatives/"
                        }
                    };
                    await sendToMessenger(psid, responses[payload][lang] || responses[payload]['EN']);
                } else {
                    const reply = await getSmartReply(event.message.text, psid);
                    await sendToMessenger(psid, reply);
                }
            }
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bangali Bot Live with Interactive Menu!`));