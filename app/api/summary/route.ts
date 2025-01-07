import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * OpenAIクライアント
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ConversationEntry = {
  role: string;
  text: string;
};

type SummaryRequest = {
  conversationList: ConversationEntry[];
};

export async function POST(request: Request) {
  try {
    const { conversationList } = (await request.json()) as SummaryRequest;
    if (!conversationList || !Array.isArray(conversationList)) {
      return NextResponse.json(
        { error: "Invalid conversationList" },
        { status: 400 }
      );
    }

    // 会話を文字列にしてGPTへ投げる例
    // 実運用では  role: user|assistant それぞれを messages[] に詰めてもOK
    const conversationText = conversationList
      .map((c) => `${c.role}: ${c.text}`)
      .join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 仮のモデル
      messages: [
        {
          role: "system",
          content: `You are an assistant that summarizes the given conversation in a concise manner.`,
        },
        {
          role: "user",
          content: conversationText,
        },
      ],
    });

    const summary = completion.choices[0]?.message?.content || "";

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Error in Summary API:", error);
    return NextResponse.json(
      { error: "Failed to create summary" },
      { status: 500 }
    );
  }
}
