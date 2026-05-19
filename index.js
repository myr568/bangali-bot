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

    // Use environment variable on Render, otherwise look for the local file
    if (process.env.GOOGLE_CREDS) {
      console.log('☁️ Detected Render environment: Loading GOOGLE_CREDS...');
      let credsEnv = process.env.GOOGLE_CREDS.trim();
      // Remove surrounding quotes if they exist
      if (credsEnv.startsWith("'") && credsEnv.endsWith("'")) credsEnv = credsEnv.slice(1, -1);
      if (credsEnv.startsWith('"') && credsEnv.endsWith('"')) credsEnv = credsEnv.slice(1, -1);
      credentials = JSON.parse(credsEnv);
    } else {
      // Local development: Point this to your local key filename
      // Make sure your key filename matches exactly
      const keyPath = path.join(__dirname, 'YOUR_KEY_FILENAME.json'); 
      console.log('🔍 Detected local environment: Loading from file...');
      const rawData = fs.readFileSync(keyPath);
      credentials = JSON.parse(rawData);
    }

    const formattedPrivateKey = credentials.private_key.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      formattedPrivateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    await auth.authorize();
    googleAuthToken = auth;
    sheetsClient = google.sheets({ version: 'v4', auth: googleAuthToken });
    console.log('✅ Google Sheets Identity established successfully!');
  } catch (err) {
    console.error('❌ Authentication failed:', err.message);
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

// POST: Main Webhook Engine
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
      const message_text = text.toLowerCase().trim();

      // Trigger metric counter tracking safely on incoming inputs
      if (text || payload) {
        logBotUsage(); 
      }

      // --- STAGE 1: Handle Core Initial Greetings / Show Initial Language Grid ---
      if (["merhaba", "selam", "hello", "hi", "مرحبا", "سلام", "হ্যালো", "হাই", "start", "menu"].includes(message_text)) {
        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: {
              text: "Welcome to Bangali Foundation! Please choose your preferred language:\n\nবাঙালি ফাউন্ডেশনে আপনাকে স্বাগতম! অনুগ্রহ করে ভাষা নির্বাচন করুন:",
              quick_replies: [
                { content_type: "text", title: "English 🇬🇧", payload: "LANG_EN" },
                { content_type: "text", title: "বাংলা 🇧🇩", payload: "LANG_BN" },
                { content_type: "text", title: "Türkçe 🇹🇷", payload: "LANG_TR" },
                { content_type: "text", title: "العربية 🇸🇦", payload: "LANG_AR" }
              ]
            }
          });
        } catch (error) { console.error('❌ Error triggering main interface:', error.message); }
        continue;
      }

      // --- STAGE 2: Catch Language Click & Commit ---
      if (payload.startsWith("LANG_")) {
        const selectedLang = payload.split("_")[1];
        
        await saveUserLanguage(sender_psid, selectedLang);
        
        let introText = "Please select an option from our structural services down below 👇";
        let options = ["❤️ Donate", "🤝 Be A Volunteer", "🆘 Need Help", "🏗️ Our Projects", "ℹ️ About Us"];

        if (selectedLang === 'TR') {
          introText = "Lütfen devam etmek için aşağıdaki hizmetlerimizden bir seçenek belirleyin 👇";
          options = ["❤️ Bağış Yap", "🤝 Gönüllü Ol", "🆘 Yardım Alın", "🏗️ Projelerimiz", "ℹ️ Hakkımızda"];
        } else if (selectedLang === 'AR') {
          introText = "يرجى تحديد أحد خدماتنا أدناه للمتابعة 👇";
          options = ["❤️ التبرع والدعم", "🤝 كن متطوعاً", "🆘 طلب مساعدة", "🏗️ مشاريعنا", "ℹ️ من نحن"];
        } else if (selectedLang === 'BN') {
          introText = "অনুগ্রহ করে নিচে দেওয়া আমাদের সেবাসমূহ থেকে যেকোনো একটি অপশন বেছে নিন 👇";
          options = ["❤️ ডোনেট করুন", "🤝 ভলান্টিয়ার হোন", "🆘 সাহায্য প্রয়োজন", "🏗️ আমাদের প্রজেক্ট সমূহ", "ℹ️ আমাদের সম্পর্কে"];
        }

        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: {
              text: introText,
              quick_replies: options.map((opt, i) => ({
                content_type: "text",
                title: opt,
                payload: `OPT_${selectedLang}_${i + 1}`
              }))
            }
          });
        } catch (error) { console.error('❌ Error presenting custom options array:', error.message); }
        continue;
      }

      // --- STAGE 3: Handle Selected Menu Choices Inside Chat ---
      if (payload.startsWith("OPT_")) {
        const [_, lang, optionNum] = payload.split("_");
        let response_text = "";

        if (lang === 'TR') {
          if (optionNum === '1') response_text = "❤️ Bizleri desteklemek ve doğrudan bağışta bulunmak için resmi sitemizi ziyaret edin:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 Gönüllü ekibimizin bir parçası olmak için bu adresten formu doldurun:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 Yardıma ihtiyacınız varsa veya bir talebiniz varsa lütfen sorunuzu buraya yazın. Yapay zekamız yardımcı olacaktır.";
          if (optionNum === '4') response_text = "🏗️ Hayata geçirdiğimiz su kuyuları ve eğitim projelerini inceleyin:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ Kuruluş amacımız ve faaliyetlerimiz hakkında bilgi edinin:\n➡️ https://bangalifoundation.org/about-us/";
        } else if (lang === 'AR') {
          if (optionNum === '1') response_text = "❤️ لدعمنا وتقديم التبرعات المباشرة، يرجى زيارة موقعنا الرسمي:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 لتصبح متطوعاً معنا وتشارك في أعمالنا الإنسانية، يرجى التسجيل هنا:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 إذا كنت بحاجة للمساعدة، يرجى كتابة تفاصيل طلبك هنا وسيقوم مساعدنا الذكي بإجابتك فوراً.";
          if (optionNum === '4') response_text = "🏗️ لمتابعة مشاريعنا الميدانية وحملات حفر الآبار، تفضل بزيارة:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ لمعرفة المزيد عن رؤية وأهداف مؤسسة بنغالي:\n➡️ https://bangalifoundation.org/about-us/";
        } else if (lang === 'BN') {
          if (optionNum === '1') response_text = "❤️ আমাদের বিভিন্ন মানবিক কাজে ডোনেট করতে এবং সাহায্য পাঠাতে আমাদের অফিশিয়াল ওয়েবসাইট ভিজিট করুন:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 আমাদের ভলান্টিয়ার টিমে যোগ দিয়ে মানুষের পাশে দাঁড়াতে এখানে আবেদন করুন:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 আপনার যদি কোনো সহযোগিতার প্রয়োজন থাকে, তবে আপনার সমস্যাটি এখানে লিখে জানান। আমাদের টিম এবং এআই আপনাকে গাইড করবে।";
          if (optionNum === '4') response_text = "🏗️ আমাদের রানিং প্রজেক্ট ও পানির পাম্প স্থাপন কার্যক্রম সমূহ দেখতে ভিজিট করুন:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ বাঙালি ফাউন্ডেশনের উদ্দেশ্য ও আমাদের কার্যক্রম সম্পর্কে বিস্তারিত জানতে ভিজিট করুন:\n➡️ https://bangalifoundation.org/about-us/";
        } else {
          if (optionNum === '1') response_text = "❤️ To support our mission and securely donate, please visit our online portal:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '2') response_text = "🤝 To join our team and make an impact as a volunteer, fill out the form here:\n➡️ https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "🆘 If you need assistance, please type your message right here, and our smart engine will guide you.";
          if (optionNum === '4') response_text = "🏗️ Track our active field projects, safe water wells, and operations at:\n➡️ https://bangalifoundation.org/";
          if (optionNum === '5') response_text = "ℹ️ Learn more about the core vision and history of Bangali Foundation:\n➡️ https://bangalifoundation.org/about-us/";
        }

        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: response_text }
          });
        } catch (error) { console.error('❌ Error transmitting layout confirmation text:', error.message); }
        continue;
      }

      // --- STAGE 4: FAQ Sheet Lookup + Gemini Conversation Fallback ---
      // --- STAGE 4: FAQ Sheet Lookup + Gemini Conversation Fallback ---
      if (text) {
        const userLang = await getUserLanguage(sender_psid);
        
        let targetLanguageName = "English";
        if (userLang === 'TR') targetLanguageName = "Turkish";
        if (userLang === 'BN') targetLanguageName = "Bangla";
        if (userLang === 'AR') targetLanguageName = "Arabic";

        const matchedFAQAnswer = await checkFAQSheet(text);
        
        if (matchedFAQAnswer) {
          try {
            await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
              recipient: { id: sender_psid },
              message: { text: matchedFAQAnswer }
            });
            console.log(`✅ FAQ match found for: ${targetLanguageName}`);
          } catch (error) { console.error('❌ Error sending FAQ answer:', error.message); }
          continue; 
        }

        let systemInstructionText = `You are the automated assistant for Bangali Foundation. Answer accurately in ${targetLanguageName}. Do not include any other languages.`;
        let aiResponseText = "";


        // Add this line temporarily to your code before the try block
        const models = await ai.models.list();
        console.log("🔍 Available models:", models);


        try {
         const result = await ai.models.generateContent({
  model: 'gemini-1.5-flash', 
  contents: text,
  config: {
    systemInstruction: systemInstructionText,
    temperature: 0.3
  }
});




          aiResponseText = result.text;
        } catch (error) {
          console.error('❌ Gemini API Error:', error.message);
          // Friendly fallback message instead of crashing
          if (userLang === 'TR') aiResponseText = "Şu anda yoğunluk yaşıyoruz, lütfen bir dakika içinde tekrar deneyin.";
          else if (userLang === 'AR') aiResponseText = "نواجه ضغطاً حالياً، يرجى المحاولة بعد دقيقة.";
          else if (userLang === 'BN') aiResponseText = "দুঃখিত, এই মুহূর্তে সার্ভারে অতিরিক্ত চাপ রয়েছে, অনুগ্রহ করে এক মিনিট পরে আবার চেষ্টা করুন।";
          else aiResponseText = "Our servers are busy, please try again in a minute.";
        }

        if (aiResponseText) {
          try {
            await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
              recipient: { id: sender_psid },
              message: { text: aiResponseText }
            });
          } catch (error) { console.error('❌ Error sending AI response:', error.message); }
        }
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