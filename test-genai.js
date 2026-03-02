const dotenv = require('dotenv');
dotenv.config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
    console.log("Testing initialized");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // First let's test what ai.models contains
    console.log("ai.models methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(ai.models)));

    // Test raw fetching
    try {
        const rawRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await rawRes.json();
        if (data.models) {
            console.log("Raw models:", data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")).map(m => m.name));
        } else {
            console.log("Raw output:", data);
        }
    } catch (e) {
        console.error("Raw fetch error:", e);
    }
}
test();
