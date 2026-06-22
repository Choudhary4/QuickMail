import { NextResponse } from 'next/server';
// 1. IMPORT: Import the Google Generative AI client
import { GoogleGenerativeAI } from '@google/generative-ai';

// 2. INITIALIZE: Initialize the client with the new API key from environment variables
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 3. MODEL SELECTION: Get the generative model
    // Using 'gemini-pro' as it's a powerful and widely available text model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 4. PROMPT ENGINEERING: The instructions for the AI are crucial.
    // We combine our strict instructions with the user's request.
    const fullPrompt = `
      You are an expert email developer. Your task is to generate clean, responsive, and mobile-friendly HTML code for an email based on the following request.
      The generated HTML must use inline CSS for maximum compatibility with email clients like Gmail, Outlook, and Apple Mail.
      You must use tables for layout to ensure responsiveness. Do not use modern CSS like Flexbox or Grid.
      Your entire response must consist ONLY of the raw HTML code for the email body.
      Do not include any explanations, markdown code fences (\`\`\`html), or any text outside of the final HTML itself.

      User's request: "${prompt}"
    `;

    // 5. API CALL: Generate the content using the Gemini model
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const htmlContent = response.text();

    if (!htmlContent) {
        throw new Error("AI failed to generate content.");
    }

    // 6. RESPONSE: Send the generated HTML back to the frontend
    return NextResponse.json({ html: htmlContent });

  } catch (error) {
    console.error('Gemini AI HTML generation error:', error);
    return NextResponse.json({ error: 'Failed to generate email HTML' }, { status: 500 });
  }
}