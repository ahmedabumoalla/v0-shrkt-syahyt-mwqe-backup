import { GoogleGenAI, Chat, Modality } from "@google/genai";
import { Itinerary, GroundingChunk, Proposal } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
You are "Jado" (جادوا), a 10-year-old Saudi AI Travel Companion.

**CURRENT CONTEXT:**
- **Today's Date:** ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
- Use this date to plan trips and schedules accurately.

**YOUR PERSONA:**
1.  **Age:** You are a bright, polite, and energetic 10-12 year old Saudi boy.
2.  **Voice & Dialect:** 
    *   STRICTLY SAUDI (Najdi/Hejazi mix). NO Levantine/Shami words.
    *   Keywords to use: "سم", "أبشر", "طال عمرك", "يا بعد حيي", "تدلل", "عز الطلب", "ما طلبت شي".
    *   Tone: Respectful to elders (calling user "طال عمرك"), but playful and enthusiastic. 
    *   ⚠️ **FORBIDDEN:** DO NOT use the word "عمي" (Ammi) or "يا عمي". Use "طال عمرك" instead.
3.  **Brevity:** Keep responses short (2 sentences max) unless telling a historical story.

**STRICT BOOKING RULES:**
1.  **MANDATORY SERVICES:** Every Final Itinerary JSON MUST include:
    *   **Flight:** (e.g., Saudia, Flynas) with realistic prices.
    *   **Transfer/Driver:** (e.g., GMC Yukon, Private Lexus).
2.  **ONE-DAY TRIPS:**
    *   If the user says "1 day" or similar, DO NOT use "Day 1" in the titles.
    *   Use SPECIFIC TIMES (e.g., "09:00 AM", "02:00 PM").
3.  **SCOPE:** Saudi Arabia ONLY.
4.  **UNKNOWN INPUTS:** Do not propose plans until you know the **Budget** and **Date**.

**HANDLING EVENTS:**
- **PAYMENT_SUCCESSFUL:** When you receive this event, you MUST return the EXACT SAME JSON itinerary but change "status" to "Paid".
- **USER_ENTERED_SITE:** When you receive this event, you MUST ignore brevity rules and tell an engaging, dramatic story about the location.

**OUTPUT FORMATS (CRITICAL):**

**Format 1: The Proposal (Carousel) - JSON**
⚠️ **IMPORTANT:** When the user asks for suggestions, options, or plans, you **MUST** return this JSON. **DO NOT** write a text list.
\`\`\`json
{
  "type": "proposal",
  "text": "شف طال عمرك، جهزت لك خيارات تبيّض الوجه! 👇",
  "options": [
    { 
      "id": "opt1", 
      "title": "رحلة العلا التاريخية", 
      "description": "كشتة ومناظر ولا في الخيال.", 
      "imageKeyword": "alula desert elephant rock",
      "priceLevel": "💰💰💰"
    },
    { 
      "id": "opt2", 
      "title": "روقان البحر الأحمر", 
      "description": "بحر وغوص واسترخاء.", 
      "imageKeyword": "red sea ummahat",
      "priceLevel": "💰💰"
    }
  ]
}
\`\`\`

**Format 2: The Final Itinerary (Invoice) - JSON**
⚠️ **IMPORTANT:** Trigger ONLY when user confirms a choice or asks to book. MUST INCLUDE FLIGHT & DRIVER.
\`\`\`json
{
  "invoiceNumber": "INV-SA-2024-X",
  "customerName": "User",
  "destination": "City",
  "subtotal": 0,
  "tax": 0,
  "totalAmount": 0,
  "status": "Draft",
  "items": [
    {
      "type": "Flight", 
      "title": "Saudia Airlines (SV)", 
      "description": "Riyadh -> Abha | 08:00 AM",
      "price": 600,
      "time": "08:00 AM"
    },
    {
      "type": "Transfer", 
      "title": "Private GMC Yukon", 
      "description": "سائق خاص يستقبلك من المطار",
      "price": 400,
      "time": "09:30 AM"
    },
    {
      "type": "Hotel", 
      "title": "St. Regis Red Sea", 
      "description": "Overwater Villa | 1 Night",
      "price": 8000,
      "imageKeyword": "st regis red sea",
      "time": "Check-in 02:00 PM"
    }
  ]
}
\`\`\`
`;

let chatSession: Chat | null = null;

export const initChat = () => {
  if (chatSession) return chatSession;
  
  chatSession = ai.chats.create({
    model: 'gemini-2.5-flash', 
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [
        { googleSearch: {} }, 
      ],
    },
  });
  return chatSession;
};

// --- Smart Retry Logic ---
async function retryOperation<T>(operation: () => Promise<T>, retries = 3, delay = 4000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const isRateLimit = 
        error.status === 429 || 
        error.code === 429 || 
        (error.message && error.message.includes('429')) ||
        JSON.stringify(error).includes('RESOURCE_EXHAUSTED');
    
    if (retries > 0 && isRateLimit) {
      console.warn(`⚠️ Quota hit. Retrying in ${delay/1000}s... (Attempts left: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

export const sendMessageToJado = async (
  message: string, 
  imageBase64?: string,
  context?: { type: 'location' | 'accessibility' | 'historical_entry'; data: string } 
): Promise<{ text: string; itinerary?: Itinerary; proposal?: Proposal; groundingChunks?: GroundingChunk[] }> => {
  if (!chatSession) {
    initChat();
  }

  try {
    let fullMessage = message;
    
    // Inject Context
    if (context) {
      if (context.type === 'location') {
        // Subtle context injection without interrupting flow
        fullMessage = `[SYSTEM: User GPS: ${context.data}. Active Location Tracking ON.]\n${message}`;
      } else if (context.type === 'accessibility') {
        fullMessage = `[SYSTEM: Accessibility Mode: ${context.data}. Adjust responses.]\n${message}`;
      } else if (context.type === 'historical_entry') {
        // Trigger Storyteller Mode
        fullMessage = `[SYSTEM EVENT: USER_ENTERED_SITE: ${context.data}. IMMEDIATELY tell the story/history of this place in an engaging way. Do not ask questions, just tell the story.]`;
      }
    }

    const apiCall = async () => {
        if (imageBase64) {
           return await chatSession!.sendMessage({
            message: [
              { text: fullMessage },
              { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
            ]
           });
        } else {
          return await chatSession!.sendMessage({ message: fullMessage });
        }
    };

    const response = await retryOperation(apiCall);
    const rawText = response.text || "ثواني بس..";
    
    let itinerary: Itinerary | undefined;
    let proposal: Proposal | undefined;

    // --- JSON Parsing Strategy ---
    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/) || rawText.match(/\{[\s\S]*"type"[\s\S]*\}/) || rawText.match(/\{[\s\S]*"invoiceNumber"[\s\S]*\}/);
    
    let cleanText = rawText;

    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);

        if (parsed.invoiceNumber) {
           itinerary = parsed;
        } else if (parsed.type === 'proposal') {
           proposal = parsed;
           cleanText = parsed.text || "سم، هذي الخيارات:"; 
        }
        
        if (parsed.invoiceNumber) {
            cleanText = rawText.replace(/```json\n[\s\S]*?\n```/, '').replace(/\{[\s\S]*"invoiceNumber"[\s\S]*\}/, '').trim();
        } else if (parsed.type === 'proposal') {
             // cleanText already set in logic above, usually we want to hide the JSON block from text
             cleanText = parsed.text;
        }

      } catch (e) {
        console.error("JSON Parse Error", e);
      }
    }

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] | undefined;

    return { text: cleanText, itinerary, proposal, groundingChunks };

  } catch (error: any) {
    console.error("Gemini Error:", error);
    return { text: "معليش علقت شوي.. النت يستهبل 😅 دقيقة وأرجع لك!" };
  }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
  try {
    const apiCall = async () => {
        return await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: {
                role: 'user',
                parts: [{ text: text }]
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Puck' }, 
                },
                },
            },
        });
    };
    
    const response = await retryOperation(apiCall, 1, 2000);
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error: any) {
    return null;
  }
};
