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

// Gemini 2.5 Flash Initialization
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
            return userRow ? userRow[1] : null; // Returns null if no language choice is registered yet
        }
    } catch (e) { return null; }
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

// --- GLOBAL REUSABLE VERTICAL MENU FUNCTION ---
async function sendVerticalMenu(psid, selectedLang) {
    const lang = selectedLang || 'EN';
    
    const localizedPrompts = {
        'EN': { card1: "Main Options", card2: "More Activities", welcome: "Please select an option from our official menus below to continue:" },
        'BN': { card1: "প্রধান বিকল্পসমূহ", card2: "অন্যান্য কার্যক্রম", welcome: "সামনে অগ্রসর হতে অনুগ্রহ করে নিচের অফিসিয়াল লিঙ্কসমূহ থেকে যেকোনো একটি বিকল্প বেছে নিন:" },
        'TR': { card1: "Ana Seçenekler", card2: "Diğer Faaliyetler", welcome: "Devam etmek için lütfen aşağıdaki resmi seçeneklerimizden birini seçin:" },
        'AR': { card1: "الخيارات الرئيسية", card2: "المزيد من الأنشطة", welcome: "يرجى اختيار أحد الخيارات من قوائمنا الرسمية أدناه للمتابعة:" }
    };

    const translations = {
        'EN': { donate: "Donate 💰", volunteer: "Be a Volunteer 🤝", aid: "Need Help/Aid? 🙋‍♂️", partner: "Be a Partner 🏢", projects: "Our Projects 📂" },
        'BN': { donate: "দান করুন 💰", volunteer: "স্বেচ্ছাসেবক হোন 🤝", aid: "সাহায্য প্রয়োজন? 🙋‍♂️", partner: "পার্টনার হোন 🏢", projects: "আমাদের প্রকল্পসমূহ 📂" },
        'TR': { donate: "Bağış Yap 💰", volunteer: "Gönüllü Ol 🤝", aid: "Yardım Lazım Mı? 🙋‍♂️", partner: "Ortak Ol 🏢", projects: "Projelerimiz 📂" },
        'AR': { donate: "تبرع الآن 💰", volunteer: "كن متطوعاً 🤝", aid: "هل تحتاج مساعدة؟ 🙋‍♂️", partner: "كن شريكاً 🏢", projects: "مشاريعنا 📂" }
    };

    const currentLang = localizedPrompts[lang];
    const labels = translations[lang];

    try {
        // Text Alert
        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: psid },
            message: { text: currentLang.welcome }
        });

        // Card 1
        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: psid },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: currentLang.card1,
                        buttons: [
                            { type: "web_url", url: "https://bangalifoundation.org/support-us/", title: labels.donate },
                            { type: "web_url", url: "https://bangalifoundation.org/become-a-volunteer/", title: labels.volunteer },
                            { type: "web_url", url: "https://bangalifoundation.org/become-a-beneficiary/", title: labels.aid }
                        ]
                    }
                }
            }
        });

        // Card 2
        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: psid },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: currentLang.card2,
                        buttons: [
                            { type: "web_url", url: "https://bangalifoundation.org/become-a-partner/", title: labels.partner },
                            { type: "web_url", url: "https://bangalifoundation.org/our-initiatives/", title: labels.projects }
                        ]
                    }
                }
            }
        });
    } catch (err) { console.error("Error sending vertical menu layout stacks"); }
}

// --- CORE: SMART REPLY LOGIC ---
async function getSmartReply(userMessage, psid, lang) {
    try {
        await client.authorize();
        const gsapi = google.sheets({ version: 'v4', auth: client });

        // 1. Check FAQ
        const faqRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'FAQ!A2:B500',
        });
        const rows = faqRes.data.values;
        if (rows) {
            const match = rows.find(row => userMessage.toLowerCase().includes(row[0].toLowerCase()));
            if (match) return match[1];
        }

        // 2. AI Call with Gemini 2.5 Flash
        const result = await aiModel.generateContent(`User Language: ${lang}. Message: ${userMessage}`);
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error('--- ERROR LOG ---');
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

            // --- 1. HANDLE POSTBACK EVENTS (Language Selection / Get Started) ---
            if (event.postback) {
                const payload = event.postback.payload;

                if (payload === 'GET_STARTED_PAYLOAD') {
                    try {
                        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: psid },
                            message: {
                                attachment: {
                                    type: "template",
                                    payload: {
                                        template_type: "button",
                                        text: "Please select your preferred language / অনুগ্রহ করে আপনার পছন্দের ভাষা নির্বাচন করুন:",
                                        buttons: [
                                            { type: "postback", title: "English 🇬🇧", payload: "LANG_EN" },
                                            { type: "postback", title: "বাংলা 🇧🇩", payload: "LANG_BN" },
                                            { type: "postback", title: "Türkçe 🇹🇷", payload: "LANG_TR" }
                                        ]
                                    }
                                }
                            }
                        });
                        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: psid },
                            message: {
                                attachment: {
                                    type: "template",
                                    payload: {
                                        template_type: "button",
                                        text: "More Options:",
                                        buttons: [
                                            { type: "postback", title: "العربية 🇸🇦", payload: "LANG_AR" }
                                        ]
                                    }
                                }
                            }
                        });
                    } catch (e) { console.error("Error displaying main language options layout block"); }
                } 
                else {
                    const langMap = { 'LANG_EN': 'EN', 'LANG_BN': 'BN', 'LANG_TR': 'TR', 'LANG_AR': 'AR' };
                    const selected = langMap[payload] || 'EN';
                    await logLanguage(psid, selected);
                    
                    // Show them the vertical stack option sheets instantly 
                    await sendVerticalMenu(psid, selected);
                }
            } 
            
            // --- 2. HANDLE TEXT INPUT MESSAGES (Gatekeeping Added) ---
            else if (event.message && event.message.text) {
                const lang = await getUserLanguage(psid);

                // GATEKEEPER: If user hasn't completed language choice or tries to chat without clicking buttons
                if (!lang) {
                    // Send them back to the start workflow
                    try {
                        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: psid },
                            message: {
                                attachment: {
                                    type: "template",
                                    payload: {
                                        template_type: "button",
                                        text: "Please choose your language first to unlock options / কথোপকথন শুরু করতে প্রথমে ভাষা নির্বাচন করুন:",
                                        buttons: [
                                            { type: "postback", title: "English 🇬🇧", payload: "LANG_EN" },
                                            { type: "postback", title: "বাংলা 🇧🇩", payload: "LANG_BN" },
                                            { type: "postback", title: "Türkçe 🇹🇷", payload: "LANG_TR" }
                                        ]
                                    }
                                }
                            }
                        });
                    } catch (err) { console.error("Gatekeeper intercept tracking error"); }
                } 
                else {
                    // Force display of the menu options if they attempt to write loose text
                    // If you want them to text freely later, swap this block with standard getSmartReply call.
                    await sendVerticalMenu(psid, lang);
                }
            }
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bangali Bot with Strict Navigation Gatekeeping is Live!`));