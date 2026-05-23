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

  if (!sheetsClient) return null; // CHANGE THIS FROM 'EN' TO null
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
  return null; // CHANGE THIS FROM 'EN' TO null
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

      // --- STRUCTURAL BUTTONS LIST (Quick Replies Setup) ---
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

      // --- HANDLE MAIN MENU BUTTON CLICKS DIRECTLY ---
      if (payload.startsWith("QUICK_")) {
        let actionResponse = "";
        if (payload === "QUICK_DONATE") {
          actionResponse = "❤️ আমাদের মানবিক কাজে ডোনেট করতে এবং সাহায্য পাঠাতে আমাদের অফিশিয়াল ওয়েবসাইট ভিジット করুন:\n➡️ https://bangalifoundation.org/\n\nTo support our mission, please visit our online portal:\n➡️ https://bangalifoundation.org/";
        } else if (payload === "QUICK_VOLUNTEER") {
          actionResponse = "🤝 আমাদের ভলান্টিয়ার টিমে যোগ দিয়ে মানুষের পাশে দাঁড়াতে এখানে আবেদন করুন:\n➡️ https://bangalifoundation.org/become-a-volunteer/\n\nTo join our team as a volunteer, fill out the form here:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
        } else if (payload === "QUICK_HELP") {
          actionResponse = "🆘 আপনার যদি কোনো সহযোগিতার প্রয়োজন থাকে, তবে আপনার সমস্যাটি এখানে লিখে জানান অথবা আমাদের হোয়াটসঅ্যাপে যোগাযোগ করুন:\n📲 https://wa.me/8801901641140";
        }

        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: sender_psid },
          message: { text: actionResponse }
        });
        continue;
      }

      // --- PROCESS TEXT MESSAGES ---
      if (text) {
        // Default to Bangla to catch standard Bangla script and Banglish (Latin alphabet Bangla)
        let conversationLang = "BN"; 
        let currentQuickReplies = quickRepliesBN;
        
        const hasArabic = /[\u0600-\u06FF]/.test(text);
        const hasTurkish = /[çğıöşüÇĞİÖŞÜ]/.test(text);

        if (hasArabic) {
          conversationLang = "AR";
          currentQuickReplies = quickRepliesEN; 
        } else if (hasTurkish) {
          conversationLang = "TR";
          currentQuickReplies = quickRepliesEN;
        } 
        // If it is regular English text, we only switch to formal English responses 
        // if they use explicit global keywords, otherwise Gemini treats Latin letters as Banglish.
        else if (/^(hello|hi|hey|good morning|dear|sir|english|info)/i.test(text.trim())) {
          conversationLang = "EN";
          currentQuickReplies = quickRepliesEN;
        }

        // STEP 1: Search FAQ Sheet First
        const matchedFAQAnswer = await checkFAQSheet(text);
        if (matchedFAQAnswer) {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { 
              text: matchedFAQAnswer,
              quick_replies: currentQuickReplies
            }
          });
          await logChatToSheet(sender_psid, text, matchedFAQAnswer);
          continue;
        }

        // STEP 2: Intelligent Gemini Processing
        let targetLanguageName = "Bangla";
        if (conversationLang === "TR") targetLanguageName = "Turkish";
        if (conversationLang === "AR") targetLanguageName = "Arabic";
        if (conversationLang === "EN") targetLanguageName = "English";

        // We add a specific rule telling Gemini to read Banglish and reply in pure Bangla script
        const systemInstructionText = `You are the official automated assistant for Bangali Foundation (https://bangalifoundation.org/).
        Our primary mission: establishing safe water wells, educational support, and running emergency relief campaigns for underserved communities.
        
        RULES:
        1. If the user writes in 'Banglish' (Bangla language using English/Latin alphabets like 'ami jante chai' or 'kivabe help korbo'), you must understand it perfectly, but ALWAYS reply using proper Bangla script (বাংলা অক্ষর).
        2. Answer clearly, accurately, and politely in ${targetLanguageName}.
        3. Always look to guide the user naturally to the main website pages (e.g., https://bangalifoundation.org/ or https://bangalifoundation.org/become-a-volunteer/) whenever they express interest in our programs, donations, or actions.
        4. If a user asks a convoluted, repetitive, or unresolvable question that doesn't match our mission, gently guide them to connect with our human staff via WhatsApp using this link: https://wa.me/8801901641140`;

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
          message: { 
            text: aiResponseText,
            quick_replies: currentQuickReplies
          }
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