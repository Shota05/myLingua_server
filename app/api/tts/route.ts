import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";

// =======================
// OpenAI インスタンス初期化
// =======================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY as string, // ENVから取得
});

// =======================
// クエリパラメータのバリデーション
// =======================
const querySchema = z.object({
  // ?text=xxx の形式。省略可
  text: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    // URL からクエリパラメータ "text" を取得
    const url = new URL(req.url);
    const textParam = url.searchParams.get("text");

    // Zod でバリデーション
    const parseResult = querySchema.safeParse({ text: textParam });
    if (!parseResult.success) {
      return NextResponse.json(
        {
          message: "Invalid query params",
          issues: parseResult.error.issues,
        },
        { status: 400 }
      );
    }

    // text がない場合はデフォルト文言を設定
    const text = parseResult.data.text ?? "何か今日ありましたか？";

    // OpenAI TTS API 呼び出し
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: text,
    });

    // arrayBuffer() を Buffer に変換
    const arrayBuffer = await mp3.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // === ここで Base64 化 ===
    const base64 = buffer.toString("base64");

    // Base64文字列を返す。Content-Type: text/plain にしておく
    return new NextResponse(base64, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error: unknown) {
    console.error("Error generating TTS:", error);

    // エラーの詳細をメッセージ化
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { message: "Error generating TTS", error: errorMessage },
      { status: 500 }
    );
  }
}
