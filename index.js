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
      // Safety check to ensure messaging array exists
      if (!entry.messaging || entry.messaging.length === 0) continue;

      // FIX: Define webhook_event so it stops throwing undefined errors
      const webhook_event = entry.messaging[0];
      if (webhook_event.delivery || webhook_event.read || webhook_event.message?.is_echo) continue;

      // FIX: Define sender_psid and message ID tracking
      const sender_psid = webhook_event.sender?.id;
      const messageId = webhook_event.message?.mid || webhook_event.postback?.mid;

      // Deduplication check
      if (messageId) {
        if (processedMids.has(messageId)) continue;
        processedMids.set(messageId, true);
        setTimeout(() => processedMids.delete(messageId), 120000);
      }

      // Extract text content or fallback interactive payloads
      const text = webhook_event.message?.text || "";
      const payload = webhook_event.message?.quick_reply?.payload || webhook_event.postback?.payload || "";
      const message_text = text.toLowerCase().trim();

      // --- STAGE 1: Language Menu Selection ---
      if (payload.startsWith("LANG_")) {
        const selectedLang = payload.split("_")[1];
        let menuText = "Please select an option to proceed:";
        let options = ["About & Projects", "Become a Volunteer", "Donate & Support", "Leave Management", "Ask Gemini AI"];

        if (selectedLang === 'TR') {
          menuText = "Lütfen devam etmek için bir seçenek seçin:";
          options = ["Hakkımızda & Projeler", "Gönüllü Olun", "Bağış Yap / Destek", "İzin Yönetim Sistemi", "Gemini Yapay Zekaya Sor"];
        } else if (selectedLang === 'AR') {
          menuText = "الرجاء اختيار أحد الخيارات للمتابعة:";
          options = ["من نحن والمشاريع", "كن متطوعاً", "التبرع والدعم", "نظام إدارة الإجازات", "اسأل الذكاء الاصطناعي"];
        }

        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: {
              text: menuText,
              quick_replies: options.map((opt, i) => ({
                content_type: "text",
                title: opt.length > 20 ? opt.substring(0, 17) + "..." : opt,
                payload: `OPT_${selectedLang}_${i + 1}`
              }))
            }
          });
        } catch (error) { console.error('❌ Error sending options menu:', error.response?.data || error.message); }
        continue;
      }

      // --- STAGE 2: Handle 5 Menu Options Responses ---
      if (payload.startsWith("OPT_")) {
        const [_, lang, optionNum] = payload.split("_");
        let response_text = "";

        if (lang === 'TR') {
          if (optionNum === '1') response_text = "Bangali Foundation; su kuyuları, yetim sponsorlukları ve insani yardım sağlayan bir kuruluştur. Detaylar: https://bangalifoundation.org/about-us/";
          if (optionNum === '2') response_text = "Gönüllü ekibimize katılmak için başvuru yapın: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "Bağışlarınız ve destek seçenekleriniz için web sitemizi ziyaret edebilirsiniz.";
          if (optionNum === '4') response_text = "İzin Yönetim Sistemi modülü yetkili personel için aktiftir.";
          if (optionNum === '5') response_text = "Lütfen sorunuzu yazın, Gemini AI size vakıf web sitesine göre cevap verecektir:";
        } else if (lang === 'AR') {
          if (optionNum === '1') response_text = "مؤسسة بنغالي توفر آبار المياه، رعاية الأيتام، والإغاثة الإنسانية. للمزيد: https://bangalifoundation.org/about-us/";
          if (optionNum === '2') response_text = "انضم إلينا كمتطوع من خلال الرابط: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "تبرعاتكم تدعم مشاريعنا المستدامة للمحتاجين.";
          if (optionNum === '4') response_text = "نظام إدارة الإجازات متاح الآن للعمليات الإدارية.";
          if (optionNum === '5') response_text = "اكتب سؤالك الآن وسيجيبك الذكاء الاصطناعي بناءً على بيانات الموقع:";
        } else {
          if (optionNum === '1') response_text = "Bangali Foundation runs clean water wells, orphan sponsorships, and emergency relief. Learn more: https://bangalifoundation.org/about-us/";
          if (optionNum === '2') response_text = "Be the helping hand! Apply to volunteer: https://bangalifoundation.org/become-a-volunteer/";
          if (optionNum === '3') response_text = "Your support reaches families facing hunger and water scarcity.";
          if (optionNum === '4') response_text = "Staff Leave Management System portal is active for authorized operations.";
          if (optionNum === '5') response_text = "Go ahead and type your question! Gemini AI will answer based on our official website data:";
        }

        try {
          await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: sender_psid },
            message: { text: response_text }
          });
        } catch (error) { console.error('❌ Error sending choice reply:', error.response?.data || error.message); }
        continue;
      }

      // --- STAGE 3: Text Message Processing (Initial Greetings / Gemini AI Grounding) ---
      if (text) {
        // Simple Language Selection Invitation Logic
        if (message_text === "merhaba" || message_text === "selam" || message_text === "hello" || message_text === "hi" || message_text === "مرحبا" || message_text === "سلام") {
          try {
            await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
              recipient: { id: sender_psid },
              message: {
                text: "Welcome to Bangali Foundation! Please choose your language / Dilinizi seçin / اختر لغتك:",
                quick_replies: [
                  { content_type: "text", title: "English 🇬🇧", payload: "LANG_EN" },
                  { content_type: "text", title: "Türkçe 🇹🇷", payload: "LANG_TR" },
                  { content_type: "text", title: "العربية 🇸🇦", payload: "LANG_AR" }
                ]
              }
            });
            console.log('✅ Language selection prompt sent!');
          } catch (error) { console.error('❌ Error sending menu:', error.response?.data || error.message); }
        } 
        // Conversational Fallback - Pass questions straight to Gemini grounded on the main site
        else {
          try {
            const result = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: `You are the automated assistant for Bangali Foundation (Humanitarian NGO dealing with water wells, orphan care, and local aid. Website: https://bangalifoundation.org/). Answer this user query directly and concisely in their matching language: ${text}`,
            });

            await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
              recipient: { id: sender_psid },
              message: { text: result.text }
            });
            console.log('✅ Gemini processed fallback reply sent!');
          } catch (error) {
            console.error('❌ Gemini / Outbound Error:', error.response?.data || error.message);
          }
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