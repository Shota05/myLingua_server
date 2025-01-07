import { ExpressionListSchema } from "@/src/expression";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ExpressionsRequest = {
  text: string; // 単一の文章
  nativeLanguage?: string; // 例: "ja"
  foreignLanguage?: string; // 例: "en"
};

export async function POST(request: Request) {
  try {
    const {
      text,
      nativeLanguage = "ja",
      foreignLanguage = "en",
    } = (await request.json()) as ExpressionsRequest;

    if (!text) {
      return NextResponse.json(
        { error: "Missing 'text' field" },
        { status: 400 }
      );
    }

    // beta.chat.completions.parse を使用し、response_format に zodResponseFormat(ExpressionListSchema, "expressionsSchema")
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini", // 例: 仮モデル名
      messages: [
        {
          role: "system",
          content: `
You are an assistant that extracts key expressions from a single sentence.
Return them in the language pair:
 - foreign: ${foreignLanguage}
 - native: ${nativeLanguage}
`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: zodResponseFormat(
        ExpressionListSchema,
        "extractedExpressions"
      ),
    });

    // completion.choices[0].message.parsed に パース済みの Zodオブジェクトが入る
    const parsedObj = completion.choices[0]?.message?.parsed;
    // parsedObj は { expressions: [ { foreign, native }, ... ] }

    return NextResponse.json(parsedObj);
  } catch (error: any) {
    console.error("Error in Expressions API:", error);
    return NextResponse.json(
      { error: "Failed to extract expressions" },
      { status: 500 }
    );
  }
}
