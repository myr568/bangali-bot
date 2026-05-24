const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SPREADSHEET_ID = '16kuhcidjptgfxqaB1y0ujeEb59zrewVkUw7o6bVWynw';
let sheetsClient;
let googleAuthToken;

const localLangCache = new Map();
const processedMids = new Map();

async function initializeGoogleAuth() {
  try {
    let credentials;
    if (process.env.GOOGLE_CREDS) {
      console.log("DEBUG: Parsing GOOGLE_CREDS from environment...");
      credentials = JSON.parse(process.env.GOOGLE_CREDS.trim());
    } else {
      console.log("DEBUG: Loading from local file...");
      const keyPath = path.join(__dirname, 'YOUR_KEY_FILENAME.json'); 
      credentials = JSON.parse(fs.readFileSync(keyPath));
    }

    const auth = google.auth.fromJSON(credentials);
    const scopedAuth = auth.createScoped(['https://www.googleapis.com/auth/spreadsheets']);
    await scopedAuth.authorize();
    googleAuthToken = scopedAuth;
    sheetsClient = google.sheets({ version: 'v4', auth: googleAuthToken });
    
    console.log('✅ Google Sheets Identity established successfully using fromJSON!');
  } catch (err) {
    console.error('❌ Authentication failed in initializeGoogleAuth:', err.message);
  }
}

initializeGoogleAuth();

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Helper: Save or update user language selection
async function saveUserLanguage(psid, languageCode) {
  const safePsid = String(psid).trim();
  localLangCache.set(safePsid, languageCode);
  console.log(`📍 Local memory cache set: ${safePsid} -> ${languageCode}`);

  if (!sheetsClient) return;
  try {
    const rangeName = 'UserPrefs!A:B';
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: rangeName,
    });
    
    const rows = response.data.values || [];
    let userRowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i][0] && String(rows[i][0]).trim() === safePsid) {
        userRowIndex = i + 1;
        break;
      }
    }

    if (userRowIndex !== -1) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `UserPrefs!B${userRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[languageCode]] }
      });
      console.log(`🔄 Google Sheet Updated Successfully: ${safePsid} -> ${languageCode}`);
    } else {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: rangeName,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[safePsid, languageCode]] }
      });
      console.log(`💾 Google Sheet Appended (New Entry): ${safePsid} -> ${languageCode}`);
    }
  } catch (err) {
    console.error('❌ Google Sheets UserPrefs WRITE failed:', err.message);
  }
}

// Helper: Read user language preference
async function getUserLanguage(psid) {
  const safePsid = String(psid).trim();

  if (localLangCache.has(safePsid)) {
    return localLangCache.get(safePsid);
  }

  if (!sheetsClient) return null;
  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'UserPrefs!A:B',
    });
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row && row[0] && String(row[0]).trim() === safePsid) {
        localLangCache.set(safePsid, row[1]); 
        return row[1];
      }
    }
  } catch (err) {
    console.error('❌ Google Sheets READ Engine failed:', err.message);
  }
  return null;
}

// Helper: Check FAQ sheet tab for dynamic keywords matching
async function checkFAQSheet(incomingText) {
  if (!sheetsClient) return null;
  const cleanInput = incomingText.toLowerCase().trim();
  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'FAQ!A:B',
    });
    const rows = response.data.values || [];
    for (const row of rows) {
      if (row && row[0] && row[1]) {
        const keyword = row[0].toLowerCase().trim();
        if (cleanInput.includes(keyword) || keyword.includes(cleanInput)) {
          console.log(`🎯 FAQ sheet keyword hit found: "${row[0]}"`);
          return row[1];
        }
      }
    }
  } catch (err) {
    console.error('⚠️ FAQ sheet tab parsing skipped or not found:', err.message);
  }
  return null;
}

// Helper: Count and log daily total API requests
async function logBotUsage() {
  if (!sheetsClient) return;
  const todayStr = new Date().toISOString().split('T')[0];
  const MAX_LIMIT = 1500;
  
  try {
    const rangeName = 'BotUsageLog!A:C';
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: rangeName,
    });
    
    const rows = response.data.values || [];
    let dateRowIndex = -1;
    let currentUsageCount = 0;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i][0] === todayStr) {
        dateRowIndex = i + 1;
        currentUsageCount = parseInt(rows[i][1], 10) || 0;
        break;
      }
    }

    const newUsageCount = currentUsageCount + 1;
    const remainingBalance = MAX_LIMIT - newUsageCount;

    if (dateRowIndex !== -1) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `BotUsageLog!B${dateRowIndex}:C${dateRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newUsageCount, remainingBalance]] }
      });
    } else {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: rangeName,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[todayStr, 1, MAX_LIMIT - 1]] }
      });
    }
  } catch (err) {
    console.error('⚠️ Failed writing metrics to BotUsageLog sheet:', err.message);
  }
}

// Helper: Log conversational history
async function logChatToSheet(psid, userText, botResponse) {
  if (!sheetsClient) return;
  try {
    const timestamp = new Date().toLocaleString();
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[timestamp, psid, userText, botResponse]] }
    });
    console.log(`📝 Chat logged to Sheet1: ${psid}`);
  } catch (err) {
    console.error('❌ Failed to log chat to Sheet1:', err.message);
  }
}

// GET: Webhook Verification
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

// POST: Primary Webhook Event Consumer
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      if (!entry.messaging || entry.messaging.length === 0) continue;

      const webhook_event = entry.messaging[0];
      if (webhook_event.delivery || webhook_event.read || webhook_event.message?.is_echo) continue;

      const sender_psid = webhook_event.sender?.id;
      const messageId = webhook_event.message?.mid || webhook_event.postback?.mid;

      if (messageId) {
        if (processedMids.has(messageId)) continue;
        processedMids.set(messageId, true);
        setTimeout(() => processedMids.delete(messageId), 120000);
      }

      const text = webhook_event.message?.text || "";
      const payload = webhook_event.message?.quick_reply?.payload || webhook_event.postback?.payload || "";
      if (text || payload) logBotUsage();

      // --- STRUCTURAL BUTTONS DEFINITIONS ---
      const quickRepliesBN = [
        { content_type: "text", title: "❤️ ডোনেট করুন", payload: "QUICK_DONATE" },
        { content_type: "text", title: "🤝 ভলান্টিয়ার হোন", payload: "QUICK_VOLUNTEER" },
        { content_type: "text", title: "🆘 সাহায্য প্রয়োজন", payload: "QUICK_HELP" }
      ];

      const quickRepliesEN = [
        { content_type: "text", title: "❤️ Donate", payload: "QUICK_DONATE" },
        { content_type: "text", title: "🤝 Volunteer", payload: "QUICK_VOLUNTEER" },
        { content_type: "text", title: "🆘 Need Help", payload: "QUICK_HELP" }
      ];

      const quickRepliesTR = [
        { content_type: "text", title: "❤️ Bağış Yap", payload: "QUICK_DONATE" },
        { content_type: "text", title: "🤝 Gönüllü Ol", payload: "QUICK_VOLUNTEER" },
        { content_type: "text", title: "🆘 Yardım Alın", payload: "QUICK_HELP" }
      ];

      const quickRepliesAR = [
        { content_type: "text", title: "❤️ التبرع والدعم", payload: "QUICK_DONATE" },
        { content_type: "text", title: "🤝 كن متطوعاً", payload: "QUICK_VOLUNTEER" },
        { content_type: "text", title: "🆘 طلب مساعدة", payload: "QUICK_HELP" }
      ];

      // --- STAGE 1: HANDLE FIRST-TIME LANGUAGE BUTTON CLICKS ---
      if (payload.startsWith("LANG_")) {
        const selectedLang = payload.split("_")[1]; 
        await saveUserLanguage(sender_psid, selectedLang);

        // FIXED: The structural choices default cleanly to Bangla options unless explicitly overridden
        let introText = "অনুগ্রহ করে নিচে দেওয়া আমাদের সেবাসমূহ থেকে যেকোনো একটি অপশন বেছে নিন 👇";
        let currentQuickReplies = quickRepliesBN;

        if (selectedLang === 'EN') {
          introText = "Please select an option from our structural services down below 👇";
          currentQuickReplies = quickRepliesEN;
        } else if (selectedLang === 'TR') {
          introText = "Lütfen devam etmek için aşağıdaki hizmetlerimizden bir seçenek belirleyin 👇";
          currentQuickReplies = quickRepliesTR;
        } else if (selectedLang === 'AR') {
          introText = "يرجى تحديد أحد خدماتنا أدناه للمتابعة 👇";
          currentQuickReplies = quickRepliesAR;
        }

        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: introText, quick_replies: currentQuickReplies }
        });
        continue;
      }

      // --- STAGE 2: HANDLE STRUCTURAL MAIN MENU ACTIONS ---
      if (payload.startsWith("QUICK_")) {
        let userLang = await getUserLanguage(sender_psid);
        
        // FIXED: Defaults cleanly to "BN" (Bengali) if language configuration isn't tracked or stored yet
        if (!userLang || userLang === "undefined" || userLang === "") {
          userLang = "BN"; 
        }

        let actionResponse = "";
        let currentQuickReplies = quickRepliesBN;

        if (userLang === 'TR') currentQuickReplies = quickRepliesTR;
        else if (userLang === 'AR') currentQuickReplies = quickRepliesAR;
        else if (userLang === 'EN') currentQuickReplies = quickRepliesEN;

        if (payload === "QUICK_DONATE") {
          if (userLang === 'BN') actionResponse = "❤️ আমাদের মানবিক কাজে ডোনেট করতে এবং আমাদের পাশে দাঁড়াতে নিচের লিংকে ভিジット করুন:\n➡️ https://bangalifoundation.org/support-us/";
          else if (userLang === 'TR') actionResponse = "❤️ İnsani yardım çalışmalarımıza bağışta bulunmak için lütfen destek sayfamızı ziyaret edin:\n➡️ https://bangalifoundation.org/support-us/";
          else if (userLang === 'AR') actionResponse = "❤️ لتقديم التبرعات ودعم مسيرتنا الإنسانية، يرجى زيارة صفحة الدعم:\n➡️ https://bangalifoundation.org/support-us/";
          else actionResponse = "❤️ To support our humanitarian mission and make a donation, please visit our support page:\n➡️ https://bangalifoundation.org/support-us/";
        } 
        else if (payload === "QUICK_VOLUNTEER") {
          if (userLang === 'BN') actionResponse = "🤝 আমাদের ভলান্টিয়ার টিমে যোগ দিয়ে মানুষের পাশে দাঁড়াতে নিচের লিংকে আবেদন করুন:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          else if (userLang === 'TR') actionResponse = "🤝 Gönüllü ekibimize katılmak ve sahada destek olmak için buradan başvuru yapabilirsiniz:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          else if (userLang === 'AR') actionResponse = "🤝 للانضمام إلى فريق المتطوعين لدينا ومساعدة المجتمعات، تقدم بطلبك عبر الرابط:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          else actionResponse = "🤝 To join our volunteer network and stand by those in need, please apply through our link:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
        } 
        else if (payload === "QUICK_HELP") {
          if (userLang === 'BN') actionResponse = "🆘 আপনি যদি কোনো সহযোগিতা পেতে চান বা বেনিফিশিয়ারি হতে চান, তবে নিচের লিংকে ফর্মটি পূরণ করুন:\n➡️ https://bangalifoundation.org/become-a-beneficiary/\n\nঅথবা আমাদের সরাসরি হোয়াটসঅ্যাপ নাম্বারে বিস্তারিত লিখে মেসেজ করুন:\n📲 https://wa.me/8801901641140";
          else if (userLang === 'TR') actionResponse = "🆘 Yardım almak veya yararlanıcı (beneficiary) olmak istiyorsanız lütfen aşağıdaki formu doldurun:\n➡️ https://bangalifoundation.org/become-a-beneficiary/\n\nYa da doğrudan WhatsApp hattımızdan bizimle iletişime geçin:\n📲 https://wa.me/8801901641140";
          else if (userLang === 'AR') actionResponse = "🆘 إذا كنت بحاجة إلى مساعدات أو ترغب في التسجيل في قائمة المستفيدين، يرجى تعبئة النموذج التالي:\n➡️ https://bangalifoundation.org/become-a-beneficiary/\n\nأو تواصل معنا مباشرة عبر الواتساب:\n📲 https://wa.me/8801901641140";
          else actionResponse = "🆘 If you need assistance or want to apply as a beneficiary, please complete the application form here:\n➡️ https://bangalifoundation.org/become-a-beneficiary/\n\nOr drop a detailed message to our official WhatsApp support channel:\n📲 https://wa.me/8801901641140";
        }

        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: actionResponse, quick_replies: currentQuickReplies }
        });
        continue;
      }

      // --- STAGE 3: PROCESS INCOMING USER TEXT MESSAGES ---
      if (text) {
        // FIXED: The target contextual option list structure now defaults directly to quickRepliesBN
        let conversationLang = "BN"; 
        let currentQuickReplies = quickRepliesBN;
        
        const hasArabic = /[\u0600-\u06FF]/.test(text);
        const hasTurkish = /[çğıöşüÇĞİÖŞÜ]/.test(text);

        if (hasArabic) {
          conversationLang = "AR";
          currentQuickReplies = quickRepliesAR; 
        } else if (hasTurkish) {
          conversationLang = "TR";
          currentQuickReplies = quickRepliesTR;
        } else if (/^(hello|hi|hey|good morning|dear|sir|english|info)/i.test(text.trim())) {
          conversationLang = "EN";
          currentQuickReplies = quickRepliesEN;
        } else {
          const savedLang = await getUserLanguage(sender_psid);
          if (savedLang === 'TR') currentQuickReplies = quickRepliesTR;
          else if (savedLang === 'AR') currentQuickReplies = quickRepliesAR;
          else if (savedLang === 'EN') currentQuickReplies = quickRepliesEN;
          // No else needed here anymore; fallback remains bound to quickRepliesBN natively
        }

        // STEP 1: Search FAQ Sheet First
        const matchedFAQAnswer = await checkFAQSheet(text);
        if (matchedFAQAnswer) {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: matchedFAQAnswer, quick_replies: currentQuickReplies }
          });
          await logChatToSheet(sender_psid, text, matchedFAQAnswer);
          continue;
        }

        // STEP 2: Intelligent Gemini Processing
        let targetLanguageName = "Bangla";
        if (conversationLang === "TR") targetLanguageName = "Turkish";
        if (conversationLang === "AR") targetLanguageName = "Arabic";
        if (conversationLang === "EN") targetLanguageName = "English";

        const systemInstructionText = `You are the official automated assistant for Bangali Foundation (https://bangalifoundation.org/).
        Our primary mission: establishing safe water wells, educational support, and running emergency relief campaigns for underserved communities.
        
        CRITICAL LINK ROUTING RULES:
        1. BENEFICIARY / HELP LINK: If the user asks for help, wants financial/medical aid, wants donation items, setup a water pump, or explicitly mentions becoming a beneficiary (keywords: সাহায্য, টাকা, সাহায্য প্রয়োজন, বেনিফিশিয়ারি, সাহায্য চাই, সাহায্য দরকার, help, aid, help me, problem), you MUST provide this exact URL: https://bangalifoundation.org/become-a-beneficiary/
        2. VOLUNTEER LINK: If the user wants to volunteer, join the foundation team, work with us, or participate in local field operations (keywords: ভলান্টিয়ার, স্বেচ্ছাসেবক, জয়েন করা, টিম, কাজ করতে চাই, volunteer, join), you MUST provide this exact URL: https://bangalifoundation.org/become-a-volunteer/
        3. DONATION LINK: If the user explicitly wants to make a donation, send money, support campaigns financially, or give zakat/charity (keywords: ডোনেট, টাকা দেওয়া, সাহায্য করা, যাকাত, অনুদান, ফান্ড, donate, donation, send money, charity, zakat), you MUST provide this exact URL: https://bangalifoundation.org/support-us/

        GENERAL CONSTRAINTS:
        - If the user writes in 'Banglish' (Bangla language using English letters like 'ami sahajjo chai' or 'kivabe help pabo'), understand it perfectly, but ALWAYS respond using proper Bangla script (বাংলা অক্ষর).
        - Answer clearly, accurately, and politely in ${targetLanguageName}.
        - If the user sends a repetitive, completely ambiguous message, or an unresolved demand that falls outside your standard rules, guide them smoothly to text our human support staff via WhatsApp here: https://wa.me/8801901641140`;

        let aiResponseText = "";
        try {
          const result = await ai.models.generateContent({
            model: 'models/gemini-2.5-flash',
            contents: text,
            config: { systemInstruction: systemInstructionText, temperature: 0.3 }
          });
          aiResponseText = result.text || "";
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          try {
            const retryResult = await ai.models.generateContent({
              model: 'models/gemini-2.5-flash',
              contents: text,
              config: { systemInstruction: systemInstructionText, temperature: 0.3 }
            });
            aiResponseText = retryResult.text || "";
          } catch (retryError) {
            aiResponseText = conversationLang === "BN" 
              ? "দুঃখিত, এই মুহূর্তে উত্তর দিতে সমস্যা হচ্ছে। অনুগ্রহ করে আমাদের হোয়াটসঅ্যাপে মেসেজ করুন: https://wa.me/8801901641140"
              : "I'm having trouble processing that right now. Please message our support on WhatsApp: https://wa.me/8801901641140";
          }
        }

        if (!aiResponseText || aiResponseText.length < 5) {
          aiResponseText = conversationLang === "BN"
            ? "আপনার প্রশ্নের সঠিক উত্তরটি পেতে আমাদের সরাসরি হোয়াটসঅ্যাপ নাম্বারে যোগাযোগ করুন: https://wa.me/8801901641140"
            : "To assist you better with this matter, please contact our helpline on WhatsApp directly: https://wa.me/8801901641140";
        }

        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: aiResponseText, quick_replies: currentQuickReplies }
        });
        await logChatToSheet(sender_psid, text, aiResponseText);
      }
    }
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