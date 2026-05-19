const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai'); // Make sure to npm install @google/genai

const app = express();
app.use(bodyParser.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// This MUST be first - it tells Ngrok to skip the warning page
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Cache map to prevent duplicate webhook retries from Meta
const processedMids = new Map();

// GET: For Facebook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === 'bangali_foundation_2026') {
    console.log('✅ Webhook Verified Successfully');
    return res.status(200).send(challenge);
  }
  res.status(200).send('Server is Up'); // Always send 200 to keep connection green
});








app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    // Return 200 OK immediately to stop Meta from timing out and re-sending loops
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      if (!entry.messaging || entry.messaging.length === 0) continue;

      const webhook_event = entry.messaging[0];
      if (webhook_event.delivery || webhook_event.read || webhook_event.message?.is_echo) continue;

      const sender_psid = webhook_event.sender?.id;
      const messageId = webhook_event.message?.mid || webhook_event.postback?.mid;

      // Deduplication check
      if (messageId) {
        if (processedMids.has(messageId)) continue;
        processedMids.set(messageId, true);
        setTimeout(() => processedMids.delete(messageId), 120000);
      }

      const text = webhook_event.message?.text || "";
      const payload = webhook_event.message?.quick_reply?.payload || webhook_event.postback?.payload || "";
      const message_text = text.toLowerCase().trim();

      // --- STAGE 1: Handle Language Selection & Show Vertical Menu ---
      if (
        payload.startsWith("LANG_") || 
        ["merhaba", "selam", "hello", "hi", "مرحبا", "سلام", "হ্যালো", "হাই"].some(g => message_text.includes(g))
      ) {
        
        // 1. Default Fallback String Declarations (English)
        let introText = "Here is how you can engage with Bangali Foundation. Choose an option below 👇";
        let subText = "More options:";
        let btnDonate = "❤️ Donate";
        let btnVolunteer = "🤝 Be A Volunteer";
        let btnHelp = "🆘 Need Help";
        let btnProjects = "🏗️ Our Projects";
        let btnAbout = "ℹ️ About Bangali Foundation";

        // 2. Turkish Language Translation Mapping
        if (payload === "LANG_TR" || message_text.includes("merhaba") || message_text.includes("selam")) {
          introText = "Bangali Foundation'a hoş geldiniz. Devam etmek için lütfen aşağıdaki seçenekleri kullanın 👇";
          subText = "Diğer seçenekler:";
          btnDonate = "❤️ Bağış Yap";
          btnVolunteer = "🤝 Gönüllü Ol";
          btnHelp = "🆘 Yardım Alın";
          btnProjects = "🏗️ Projelerimiz";
          btnAbout = "ℹ️ Vakıf Hakkında";
        } 
        // 3. Arabic Language Translation Mapping
        else if (payload === "LANG_AR" || message_text.includes("مرحبا") || message_text.includes("سلام")) {
          introText = "مرحباً بكم في مؤسسة بنغالي. يرجى اختيار أحد الخيارات أدناه للمتابعة 👇";
          subText = "خيارات إضافية:";
          btnDonate = "❤️ التبرع والدعم";
          btnVolunteer = "🤝 كن متطوعاً";
          btnHelp = "🆘 طلب مساعدة";
          btnProjects = "🏗️ مشاريعنا";
          btnAbout = "ℹ️ عن المؤسسة";
        }
        // 4. Bangla Language Translation Mapping
        else if (payload === "LANG_BN" || message_text.includes("হ্যালো") || message_text.includes("হাই")) {
          introText = "বাঙালি ফাউন্ডেশনে আপনাকে স্বাগতম। অনুগ্রহ করে নিচের যেকোনো একটি অপশন বেছে নিন 👇";
          subText = "অন্যান্য অপশন সমূহ:";
          btnDonate = "❤️ ডোনেট করুন";
          btnVolunteer = "🤝 ভলান্টিয়ার হোন";
          btnHelp = "🆘 সাহায্য প্রয়োজন";
          btnProjects = "🏗️ আমাদের প্রজেক্ট সমূহ";
          btnAbout = "ℹ️ ফাউন্ডেশন সম্পর্কে";
        }

        try {
          // Block 1: First 3 Buttons (Vertical Stack)
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: {
              attachment: {
                type: "template",
                payload: {
                  template_type: "button",
                  text: introText,
                  buttons: [
                    { type: "web_url", url: "https://bangalifoundation.org/", title: btnDonate },
                    { type: "web_url", url: "https://bangalifoundation.org/become-a-volunteer/", title: btnVolunteer },
                    { type: "postback", title: btnHelp, payload: "MENU_NEED_HELP" }
                  ]
                }
              }
            }
          });

          // Block 2: Remaining 2 Buttons (Vertical Stack sent instantly right after)
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: {
              attachment: {
                type: "template",
                payload: {
                  template_type: "button",
                  text: subText,
                  buttons: [
                    { type: "web_url", url: "https://bangalifoundation.org/", title: btnProjects },
                    { type: "web_url", url: "https://bangalifoundation.org/about-us/", title: btnAbout }
                  ]
                }
              }
            }
          });
          
          console.log('✅ Vertical stacked 4-language navigation templates successfully sent.');
        } catch (error) { 
          console.error('❌ Error sending vertical template menus:', error.response?.data || error.message); 
        }
        continue;
      }

      // --- STAGE 2: Handle Interactive Clicks (Like 'Need Help') ---
      if (payload === "MENU_NEED_HELP") {
        const helpResponse = "Please describe your request or ask your question directly! Our AI assistant will answer right away. \n\nঅনুগ্রহ করে আপনার প্রশ্নটি লিখুন, আমাদের এআই অ্যাসিস্ট্যান্ট এখনই উত্তর দেবে।";
        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: helpResponse }
          });
        } catch (error) { console.error('❌ Error handling Help postback:', error.response?.data || error.message); }
        continue;
      }

      // --- STAGE 3: Gemini Grounding Fallback ---
      if (text) {
        // Simple initial greeting catch to force the Language Selector Menu
        if (["start", "menu", "language", "ভাষা", "dil", "اللغة"].some(keyword => message_text === keyword)) {
          try {
            await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
              recipient: { id: sender_psid },
              message: {
                text: "Choose Language / ভাষা বেছে নিন / Dil Seçiniz / اختر اللغة:",
                quick_replies: [
                  { content_type: "text", title: "English 🇬🇧", payload: "LANG_EN" },
                  { content_type: "text", title: "বাংলা 🇧🇩", payload: "LANG_BN" },
                  { content_type: "text", title: "Türkçe 🇹🇷", payload: "LANG_TR" },
                  { content_type: "text", title: "العربية 🇸🇦", payload: "LANG_AR" }
                ]
              }
            });
          } catch (error) { console.error('❌ Error rendering language root menu:', error.message); }
          continue;
        }

        // Direct AI Fallback Integration
        try {
          const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `You are the official automated conversational web agent for Bangali Foundation (a humanitarian NGO deploying sustainable clean water wells, orphan education sponsorships, medical setups, and local crisis relief. Main portal: https://bangalifoundation.org/). Analyze this prompt carefully and reply back clearly, concisely, and beautifully in the corresponding native language used by the user: ${text}`,
          });

          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: result.text }
          });
          console.log('✅ Gemini processed multi-language fallback successfully.');
        } catch (error) {
          console.error('❌ Gemini execution or transmission error:', error.response?.data || error.message);
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