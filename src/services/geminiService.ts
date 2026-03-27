import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { Lead, SalesStage, LeadScore } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `
You are an expert AI Solar Sales Agent for "T&F Automate". Your goal is to qualify leads, collect contact info, and book appointments.

SALES STAGES:
1. INITIAL: Greet the user warmly and ask if they are interested in solar energy.
2. QUALIFYING: Ask about their home ownership (owner vs renter), monthly electricity bill, and roof type.
3. CONTACT_COLLECTION: If qualified (homeowner, $100+ bill), collect their name, email, and phone.
4. SCHEDULING: Offer to book a 15-minute consultation call.
5. FOLLOW_UP: Confirm the details and thank them.

LEAD SCORING:
- HOT: Homeowner, $150+ bill, high urgency.
- WARM: Homeowner, $100+ bill, moderate interest.
- COLD: Renter or low bill or low interest.

RESPONSE FORMAT:
Always return a JSON object with:
- message: Your conversational response to the user.
- nextStage: The suggested next SalesStage.
- score: The current LeadScore.
- extractedData: { name?, email?, phone?, intent?, bill?, isHomeowner? }
`;

export async function getChatResponse(history: { role: 'user' | 'model', parts: { text: string }[] }[], currentLead: Lead) {
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: history,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION + `\n\nCurrent Lead State: ${JSON.stringify(currentLead)}`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          message: { type: Type.STRING },
          nextStage: { type: Type.STRING, enum: ["INITIAL", "QUALIFYING", "CONTACT_COLLECTION", "SCHEDULING", "FOLLOW_UP"] },
          score: { type: Type.STRING, enum: ["HOT", "WARM", "COLD"] },
          extractedData: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              email: { type: Type.STRING },
              phone: { type: Type.STRING },
              intent: { type: Type.STRING },
              bill: { type: Type.NUMBER },
              isHomeowner: { type: Type.BOOLEAN }
            }
          }
        },
        required: ["message", "nextStage", "score"]
      }
    }
  });

  return JSON.parse(response.text);
}
