import { SentenceCardListSchema } from "@/src/SentenceCard";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ConversationEntry = {
  role: string;
  text: string;
};

type SentenceCardRequest = {
  conversationList: ConversationEntry[];
  nativeLanguage: string; // 母国語 (例: "ja")
  foreignLanguage: string; // 翻訳元 (例: "en")
};

export async function POST(request: Request) {
  try {
    const { conversationList, nativeLanguage, foreignLanguage } =
      (await request.json()) as SentenceCardRequest;

    // バリデーション
    if (!conversationList || !Array.isArray(conversationList)) {
      return NextResponse.json(
        { error: "Invalid conversationList" },
        { status: 400 }
      );
    }
    if (!nativeLanguage || !foreignLanguage) {
      return NextResponse.json(
        { error: "Missing nativeLanguage or foreignLanguage" },
        { status: 400 }
      );
    }

    // roleごとにテキストを連結
    const conversationText = conversationList
      .map((c) => `${c.role}: ${c.text}`)
      .join("\n");

    // structured output: zodResponseFormat(SentenceCardListSchema, "sentenceCardsSchema")
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini", // 仮モデル名
      messages: [
        {
          role: "system",
          content: `
You are an assistant that:
1) Reads a conversation in ${foreignLanguage}.
2) Extracts important sentences (in ${foreignLanguage}).
3) Translates each sentence into ${nativeLanguage}.
`,
        },
        {
          role: "user",
          content: conversationText,
        },
      ],
      response_format: zodResponseFormat(
        SentenceCardListSchema,
        "sentenceCardsSchema"
      ),
    });

    // パース済みオブジェクト
    const parsedObj = completion.choices[0]?.message?.parsed;
    //  => { sentenceCards: [ { text, translation }, ... ] }

    return NextResponse.json(parsedObj);
  } catch (error: any) {
    console.error("Error in SentenceCard API:", error);
    return NextResponse.json(
      { error: "Failed to create sentence cards" },
      { status: 500 }
    );
  }
}
