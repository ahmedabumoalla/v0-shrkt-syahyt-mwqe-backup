import { NextResponse } from "next/server";
import { sendMessageToJado } from "@/services/gemini";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      message,
      imageBase64,
      context,
    }: {
      message: string;
      imageBase64?: string;
      context?: {
        type: "location" | "accessibility" | "historical_entry";
        data: string;
      };
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const result = await sendMessageToJado(
      message,
      imageBase64,
      context
    );

    return NextResponse.json({
      success: true,
      text: result.text,
      itinerary: result.itinerary ?? null,
      proposal: result.proposal ?? null,
      groundingChunks: result.groundingChunks ?? null,
    });
  } catch (error) {
    console.error("AI Route Error:", error);
    return NextResponse.json(
      { success: false, error: "AI processing failed" },
      { status: 500 }
    );
  }
}
