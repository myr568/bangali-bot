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
            return userRow ? userRow[1] : null;
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

// --- HELPER: CHECK IF USER IS UNLOCKED ---
async function checkUserUnlocked(psid) {
    try {
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const response = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'UnlockedUsers!A:A',
        });
        const rows = response.data.values;
        if (rows) {
            return rows.some(row => row[0] === psid);
        }
        return false;
    } catch (e) { return false; }
}

// --- HELPER: LOG UNLOCKED USER ---
async function logUnlockedUser(psid) {
    try {
        const gsapi = google.sheets({ version: 'v4', auth: client });
        await gsapi.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'UnlockedUsers!A:A',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[psid]] }
        });
    } catch (e) { console.error("Error logging unlocked user", e); }
}

// --- GLOBAL REUSABLE LANGUAGE SELECTOR (QUICK REPLIES - ALL 4 TOGETHER) ---
async function sendLanguageSelector(psid, textPrompt) {
    try {
        await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: psid },
            message: {
                text: textPrompt,
                quick_replies: [
                    { content_type: "text", title: "English 🇬🇧", payload: "LANG_EN" },
                    { content_type: "text", title: "বাংলা 🇧🇩", payload: "LANG_BN" },
                    { content_type: "text", title: "Türkçe 🇹🇷", payload: "LANG_TR" },
                    { content_type: "text", title: "العربية 🇸🇦", payload: "LANG_AR" }
                ]
            }
        });
    } catch (e) { console.error("Error sending language selection Quick Replies menu"); }
}

// --- GLOBAL REUSABLE VERTICAL MENU FUNCTION (STACKED CARDS) ---
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
        await sendToMessenger(psid, currentLang.welcome);

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
                            { type: "postback", title: labels.donate, payload: "CLICK_DONATE" },
                            { type: "postback", title: labels.volunteer, payload: "CLICK_VOLUNTEER" },
                            { type: "postback", title: labels.aid, payload: "CLICK_AID" }
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
                            { type: "postback", title: labels.partner, payload: "CLICK_PARTNER" },
                            { type: "postback", title: labels.projects, payload: "CLICK_PROJECTS" }
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

            // --- 1. HANDLE QUICK REPLIES & POSTBACK EVENTS ---
            let payload = null;
            if (event.postback) payload = event.postback.payload;
            if (event.message && event.message.quick_reply) payload = event.message.quick_reply.payload;

            if (payload) {
                // Scenario A: Get Started click
                if (payload === 'GET_STARTED_PAYLOAD') {
                    await sendLanguageSelector(psid, "Please select your preferred language / অনুগ্রহ করে আপনার পছন্দের ভাষা নির্বাচন করুন:");
                } 
                // Scenario B: Language Chosen
                else if (payload.startsWith('LANG_')) {
                    const langMap = { 'LANG_EN': 'EN', 'LANG_BN': 'BN', 'LANG_TR': 'TR', 'LANG_AR': 'AR' };
                    const selected = langMap[payload] || 'EN';
                    await logLanguage(psid, selected);
                    await sendVerticalMenu(psid, selected);
                }
                // Scenario C: Menu Options Clicked
                else if (payload.startsWith('CLICK_')) {
                    const lang = await getUserLanguage(psid) || 'EN';
                    
                    const optionLinks = {
                        'CLICK_DONATE': {
                            'EN': "Thank you for your generosity! Click here to make a donation directly: https://bangalifoundation.org/support-us/",
                            'BN': "আপনার উদারতার জন্য ধন্যবাদ! সরাসরি দান করতে এখানে ক্লিক করুন: https://bangalifoundation.org/support-us/",
                            'TR': "Cömertliğiniz için teşekkür ederiz! Doğrudan bağış yapmak için buraya tıklayın: https://bangalifoundation.org/support-us/",
                            'AR': "شكراً لكرمك! انقر هنا لتقديم التبرع مباشرة: https://bangalifoundation.org/support-us/"
                        },
                        'CLICK_VOLUNTEER': {
                            'EN': "Click the link https://bangalifoundation.org/become-a-volunteer/ to fill up the form to be our volunteer.",
                            'BN': "আমাদের স্বেচ্ছাসেবক হতে ফর্মটি পূরণ করতে এই লিঙ্কে ক্লিক করুন: https://bangalifoundation.org/become-a-volunteer/",
                            'TR': "Gönüllümüz olmak üzere formu doldurmak için şu bağlantıya tıklayın: https://bangalifoundation.org/become-a-volunteer/",
                            'AR': "انقر على الرابط لتعبئة النموذج لتصبح متطوعاً معنا: https://bangalifoundation.org/become-a-volunteer/"
                        },
                        'CLICK_AID': {
                            'EN': "Click the link https://bangalifoundation.org/become-a-beneficiary/ to become a beneficiary.",
                            'BN': "সুবিধাভোগী বা সাহায্য পেতে এই লিঙ্কে ক্লিক করে আবেদন করুন: https://bangalifoundation.org/become-a-beneficiary/",
                            'TR': "Yararlanıcı (yardım alan) olmak için şu bağlantıya tıklayın: https://bangalifoundation.org/become-a-beneficiary/",
                            'AR': "انقر على الرابط لتصبح مستفيداً من المساعدات: https://bangalifoundation.org/become-a-beneficiary/"
                        },
                        'CLICK_PARTNER': {
                            'EN': "Fill in the form in the following link to become a partner: https://bangalifoundation.org/become-a-partner/",
                            'BN': "আমাদের পার্টনার বা সহযোগী হতে এই লিঙ্কের ফর্মটি পূরণ করুন: https://bangalifoundation.org/become-a-partner/",
                            'TR': "Ortak veya paydaş olmak için aşağıdaki bağlantıda yer alan formu doldurun: https://bangalifoundation.org/become-a-partner/",
                            'AR': "يرجى تعبئة النموذج الموجود في الرابط التالي لتصبح شريكاً لنا: https://bangalifoundation.org/become-a-partner/"
                        },
                        'CLICK_PROJECTS': {
                            'EN': "Click here to learn all about our current projects and initiatives: https://bangalifoundation.org/our-initiatives/",
                            'BN': "আমাদের চলমান প্রকল্প ও উদ্যোগগুলি সম্পর্কে জানতে এখানে ক্লিক করুন: https://bangalifoundation.org/our-initiatives/",
                            'TR': "Mevcut projelerimiz ve girişimlerimiz hakkında bilgi edinmek için buraya tıklayın: https://bangalifoundation.org/our-initiatives/",
                            'AR': "انقر هنا للتعرف على جميع مشاريعنا ومبادراتنا الحالية: https://bangalifoundation.org/our-initiatives/"
                        }
                    };

                    const textReply = optionLinks[payload][lang] || optionLinks[payload]['EN'];
                    await sendToMessenger(psid, textReply);
                    await logUnlockedUser(psid);
                    
                    const unlockAlert = {
                        'EN': "🔒 Menu Completed! You can now ask any question or type freely to talk with our assistant.",
                        'BN': "🔒 মেনু সম্পন্ন হয়েছে! এখন আপনি যেকোনো প্রশ্ন জিজ্ঞাসা করতে পারেন বা আমাদের সহকারীর সাথে চ্যাট করতে পারেন।",
                        'TR': "🔒 Menü Tamamlandı! Artık asistanımızla konuşmak için istediğiniz soruyu sorabilir veya serbestçe yazabilirsiniz.",
                        'AR': "🔒 اكتملت القائمة! يمكنك الآن طرح أي سؤال أو الكتابة بحرية للتحدث مع مساعدنا."
                    };
                    await sendToMessenger(psid, unlockAlert[lang]);
                }
            } 
            
            // --- 2. HANDLE TEXT INPUT MESSAGES ---
            else if (event.message && event.message.text) {
                const lang = await getUserLanguage(psid);
                const isUnlocked = await checkUserUnlocked(psid);

                // Gatekeeper A: No language selected yet
                if (!lang) {
                    await sendLanguageSelector(psid, "Please choose your language first to unlock options / কথোপকথন শুরু করতে প্রথমে ভাষা নির্বাচন করুন:");
                } 
                // Gatekeeper B: Has language, but hasn't clicked an option yet
                else if (!isUnlocked) {
                    await sendVerticalMenu(psid, lang);
                } 
                // Passed Gatekeeper: Normal Chat Mode
                else {
                    const reply = await getSmartReply(event.message.text, psid, lang);
                    await sendToMessenger(psid, reply);
                }
            }
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bangali Bot with Unified 4-Language Selector is Live!`));