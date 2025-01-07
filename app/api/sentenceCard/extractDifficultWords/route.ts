import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

// Expression
const ExpressionSchema = z.object({
  text: z.string(), // 難単語 or Chunk
  meaning: z.string(), // その意味（nativeLangで）
});

// Response: { expressions: Expression[] }
const ExpressionsResultSchema = z.object({
  expressions: z.array(ExpressionSchema),
});

const RequestSchema = z.object({
  sentenceText: z.string(), // SentenceCardのtext
  nativeLang: z.string(),
  foreignLang: z.string(),
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

export async function POST(req: NextRequest) {
  try {
    // 1) リクエストをバリデーション
    const body = await req.json();
    const parseResult = RequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const { sentenceText, nativeLang, foreignLang } = parseResult.data;

    // 2) systemメッセージ
    const systemContent = `
You are an assistant that extracts difficult or notable words/chunks from a sentence in ${foreignLang}.
For each extracted piece, provide a "text" (original chunk) and "meaning" (in ${nativeLang}).
Return JSON in the format:
{
  "expressions": [
    { "text": "...", "meaning": "..." },
    ...
  ]
}
`.trim();

    // 3) OpenAI structured output
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: sentenceText },
      ],
      response_format: zodResponseFormat(
        ExpressionsResultSchema,
        "difficultWordsSchema"
      ),
    });

    const parsed = completion.choices[0].message?.parsed;
    if (!parsed) {
      return NextResponse.json(
        { error: "No structured output returned" },
        { status: 500 }
      );
    }
    // => { expressions: [ { text, meaning }, ... ] }

    return NextResponse.json(parsed, { status: 200 });
  } catch (error: any) {
    console.error("Error in extractDifficultWords:", error);
    return NextResponse.json(
      { error: "Failed to extract difficult words" },
      { status: 500 }
    );
  }
}
