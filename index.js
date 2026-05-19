const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SPREADSHEET_ID = '16kuhcidjptgfxqaB1y0ujeEb59zrewVkUw7o6bVWynw';
let sheetsClient;
let googleAuthToken;

const localLangCache = new Map();



const fs = require('fs');
const path = require('path');




async function initializeGoogleAuth() {
  try {
    let credentials;

    // --- LOAD CREDENTIALS ---
    if (process.env.GOOGLE_CREDS) {
      console.log("DEBUG: Parsing GOOGLE_CREDS from environment...");
      credentials = JSON.parse(process.env.GOOGLE_CREDS.trim());
    } else {
      console.log("DEBUG: Loading from local file...");
      const keyPath = path.join(__dirname, 'YOUR_KEY_FILENAME.json'); 
      credentials = JSON.parse(fs.readFileSync(keyPath));
    }

    // --- ROBUST AUTHENTICATION ---
    // Instead of manual JWT construction, we use 'fromJSON' which is the standard 
    // way to load a service account key object safely.
    const auth = google.auth.fromJSON(credentials);
    
    // Scopes are required for the Auth object to work with Sheets
    const scopedAuth = auth.createScoped(['https://www.googleapis.com/auth/spreadsheets']);

    await scopedAuth.authorize();
    googleAuthToken = scopedAuth;
    sheetsClient = google.sheets({ version: 'v4', auth: googleAuthToken });
    
    console.log('✅ Google Sheets Identity established successfully using fromJSON!');
  } catch (err) {
    console.error('❌ Authentication failed in initializeGoogleAuth:', err.message);
    console.error('Full Error Stack:', err.stack); // Added for deeper insight
  }
}





initializeGoogleAuth();

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

const processedMids = new Map();

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

  if (!sheetsClient) return 'EN'; 
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
  return 'EN'; 
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

// NEW Helper: Count and log daily total API requests out of 1500 limit
async function logBotUsage() {
  if (!sheetsClient) return;
  
  // Get current date string formatted as YYYY-MM-DD
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

    // Search if today's date row entry already exists
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
      // Update existing day stats row counter
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `BotUsageLog!B${dateRowIndex}:C${dateRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newUsageCount, remainingBalance]] }
      });
      console.log(`📈 Bot Usage Log Updated: ${todayStr} | Count: ${newUsageCount} | Remaining: ${remainingBalance}`);
    } else {
      // Append a fresh date row if it's the first execution of a brand new calendar day
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: rangeName,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[todayStr, 1, MAX_LIMIT - 1]] }
      });
      console.log(`📊 First execution for a new calendar date logged: ${todayStr}`);
    }
  } catch (err) {
    console.error('⚠️ Failed writing metrics to BotUsageLog sheet:', err.message);
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







//google sheet
async function logChatToSheet(psid, userText, botResponse) {
  if (!sheetsClient) return;
  try {
    const timestamp = new Date().toLocaleString();
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:D', // Adjust if your columns are different
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[timestamp, psid, userText, botResponse]] }
    });
    console.log(`📝 Chat logged to Sheet1: ${psid}`);
  } catch (err) {
    console.error('❌ Failed to log chat to Sheet1:', err.message);
  }
}







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

      // GATEKEEPER: Force Language Selection
const currentLang = await getUserLanguage(sender_psid);
console.log(`DEBUG: User ${sender_psid} current language is: ${currentLang}`); // Add this to see what's happening

// If currentLang is null, undefined, or empty, FORCE the menu
if (!currentLang || currentLang === "undefined" || currentLang === "") {
  // Only show menu if we haven't already processed a language selection in this specific message
  if (!payload.startsWith("LANG_")) {
    await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: sender_psid },
      message: {
        text: "Welcome! Please choose your preferred language:\n\nস্বাগতম! ভাষা নির্বাচন করুন:",
        quick_replies: [
          { content_type: "text", title: "English 🇬🇧", payload: "LANG_EN" },
          { content_type: "text", title: "বাংলা 🇧🇩", payload: "LANG_BN" },
          { content_type: "text", title: "Türkçe 🇹🇷", payload: "LANG_TR" },
          { content_type: "text", title: "العربية 🇸🇦", payload: "LANG_AR" }
        ]
      }
    });
    continue;
  }
}

      // STAGE 1: Process Language Selection
      if (payload.startsWith("LANG_")) {
        const selectedLang = payload.split("_")[1];
        await saveUserLanguage(sender_psid, selectedLang);
        let introText = "Please select an option from our structural services down below 👇";
        let options = ["❤️ Donate", "🤝 Be A Volunteer", "🆘 Need Help", "🏗️ Our Projects", "ℹ️ About Us"];
        if (selectedLang === 'TR') { introText = "Lütfen devam etmek için aşağıdaki hizmetlerimizden bir seçenek belirleyin 👇"; options = ["❤️ Bağış Yap", "🤝 Gönüllü Ol", "🆘 Yardım Alın", "🏗️ Projelerimiz", "ℹ️ Hakkımızda"]; }
        else if (selectedLang === 'AR') { introText = "يرجى تحديد أحد خدماتنا أدناه للمتابعة 👇"; options = ["❤️ التبرع والدعم", "🤝 كن متطوعاً", "🆘 طلب مساعدة", "🏗️ مشاريعنا", "ℹ️ من نحن"]; }
        else if (selectedLang === 'BN') { introText = "অনুগ্রহ করে নিচে দেওয়া আমাদের সেবাসমূহ থেকে যেকোনো একটি অপশন বেছে নিন 👇"; options = ["❤️ ডোনেট করুন", "🤝 ভলান্টিয়ার হোন", "🆘 সাহায্য প্রয়োজন", "🏗️ আমাদের প্রজেক্ট সমূহ", "ℹ️ আমাদের সম্পর্কে"]; }
        
        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: introText, quick_replies: options.map((opt, i) => ({ content_type: "text", title: opt, payload: `OPT_${selectedLang}_${i + 1}` })) }
        });
        continue;
      }

      // STAGE 2: Handle Selected Menu Choices
      if (payload.startsWith("OPT_")) {
        const [_, lang, optionNum] = payload.split("_");
        let response_text = "";
        if (lang === 'TR') {
          if (optionNum === '1') response_text = "❤️ Bizleri desteklemek için: https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 Gönüllü olmak için: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 Yardıma ihtiyacınız varsa sorunuzu buraya yazın.";
          if (optionNum === '4') response_text = "🏗️ Projelerimiz: https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ Hakkımızda: https://bangalifoundation.org/about-us/";
        } else if (lang === 'AR') {
          if (optionNum === '1') response_text = "❤️ للتبرع: https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 كن متطوعاً: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 إذا كنت بحاجة للمساعدة، اكتب تفاصيل طلبك هنا.";
          if (optionNum === '4') response_text = "🏗️ مشاريعنا: https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ من نحن: https://bangalifoundation.org/about-us/";
        } else if (lang === 'BN') {
          if (optionNum === '1') response_text = "❤️ ডোনেট করতে: https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 ভলান্টিয়ার হতে: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 আপনার সহযোগিতা প্রয়োজন হলে এখানে লিখুন।";
          if (optionNum === '4') response_text = "🏗️ প্রজেক্ট সমূহ: https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ আমাদের সম্পর্কে: https://bangalifoundation.org/about-us/";
        } else {
          if (optionNum === '1') response_text = "❤️ To donate: https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 To volunteer: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 If you need assistance, please type your message.";
          if (optionNum === '4') response_text = "🏗️ Our Projects: https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ About Us: https://bangalifoundation.org/about-us/";
        }
        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: response_text }
        });
        continue;
      }

      // STAGE 4: FAQ Sheet Lookup + Gemini Conversation
      if (text) {
        const userLang = await getUserLanguage(sender_psid);
        let targetLanguageName = userLang === 'TR' ? "Turkish" : userLang === 'BN' ? "Bangla" : userLang === 'AR' ? "Arabic" : "English";
        
        const matchedFAQAnswer = await checkFAQSheet(text);
        if (matchedFAQAnswer) {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: matchedFAQAnswer }
          });
          await logChatToSheet(sender_psid, text, matchedFAQAnswer);
          continue;
        }

        const systemInstructionText = `You are the official assistant for Bangali Foundation. Our mission: humanitarian relief, water wells, and education. Answer in ${targetLanguageName}.`;
        let aiResponseText = "";
        try {
          const result = await ai.models.generateContent({ model: 'models/gemini-2.5-flash', contents: text, config: { systemInstruction: systemInstructionText, temperature: 0.3 } });
          aiResponseText = result.text;
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          try {
            const retry = await ai.models.generateContent({ model: 'models/gemini-2.5-flash', contents: text, config: { systemInstruction: systemInstructionText, temperature: 0.3 } });
            aiResponseText = retry.text;
          } catch (e) { aiResponseText = "Servers busy, please try again."; }
        }
        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: sender_psid }, message: { text: aiResponseText } });
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