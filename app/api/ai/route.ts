import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

export async function POST(req: Request) {
  try {
    // تحقق من وجود المفتاح
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "AI service not configured" },
        { status: 500 }
      )
    }

    // قراءة الطلب
    const body = await req.json().catch(() => null)

    if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
      return NextResponse.json(
        { error: "Invalid prompt" },
        { status: 400 }
      )
    }

    // تهيئة Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    // توليد المحتوى
    const result = await model.generateContent(body.prompt)
    const text = result.response.text()

    return NextResponse.json({ text })
  } catch (error) {
    console.error("AI API error:", error)
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    )
  }
}
