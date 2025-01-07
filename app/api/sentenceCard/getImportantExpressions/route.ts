import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

// --------------------
// 1) Zodスキーマ
// --------------------
// SentenceCard 的な要素, ただし expressions は後続APIで埋めるので今は空配列想定
const SentenceCardSchema = z.object({
  text: z.string(), // 例: "英語学習を頑張る"
  translation: z.string(), // 例: "I'm studying English hard."
});

const SentenceCardListSchema = z.object({
  sentenceCards: z.array(SentenceCardSchema),
});

// 入力
const RequestSchema = z.object({
  conversation: z.array(z.string()), // 会話の配列
  nativeLang: z.string(),
  foreignLang: z.string(),
});

// --------------------
// 2) OpenAI初期化
// --------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

// --------------------
// 3) POST Handler
// --------------------
export async function POST(req: NextRequest) {
  try {
    // (A) リクエスト
    const body = await req.json();
    const parseResult = RequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const { conversation, nativeLang, foreignLang } = parseResult.data;

    // (B) 会話をOpenAIに渡すためにjoin
    const conversationText = conversation.join("\n");

    // (C) systemメッセージ
    const systemContent = `
You are an assistant that extracts important sentences from a conversation in ${foreignLang}.
For each important sentence, also provide a translation into ${nativeLang}.
Return JSON in the format:
{
  "sentenceCards": [
    {
      "text": "<original sentence>",
      "translation": "<translation>",
    },
    ...
  ]
}
`.trim();

    // (D) Structured output
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: conversationText },
      ],
      response_format: zodResponseFormat(
        SentenceCardListSchema,
        "importantSentenceCards"
      ),
    });

    const parsedObj = completion.choices[0].message?.parsed;
    if (!parsedObj) {
      return NextResponse.json(
        { error: "No structured output returned" },
        { status: 500 }
      );
    }
    // => { sentenceCards: [ { text, translation, expressions:[] }, ... ] }

    return NextResponse.json(parsedObj, { status: 200 });
  } catch (error: any) {
    console.error("Error in getImportantExpressions:", error);
    return NextResponse.json(
      { error: "Failed to extract important expressions" },
      { status: 500 }
    );
  }
}
