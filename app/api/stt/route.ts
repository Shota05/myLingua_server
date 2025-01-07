// app/api/transcribe/route.ts

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
// @ts-ignore
import { parseFile } from "music-metadata";

// --------------------------
// 1. OpenAI の初期化
// --------------------------
const openai = new OpenAI({
  // 環境変数が存在しない場合は空文字列を入れておく
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

// --------------------------
// 2. Whisper Transcription
// --------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // (A) formDataを取得
    const formData = await req.formData();
    const file = formData.get("file");
    const userId = formData.get("userId");

    // (B) ファイル・ユーザーIDチェック
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { message: "No file uploaded" },
        { status: 400 }
      );
    }

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { message: "User ID is required" },
        { status: 400 }
      );
    }

    // (C) 一時ファイルとして /tmp に保存
    //     Vercel などサーバーレス環境では一時的に書き込み可能ですが、
    //     長期保存はできないので注意してください
    const tempFilePath = path.join("/tmp", file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.promises.writeFile(tempFilePath, buffer);

    let durationInSeconds = 0;

    // (D) 音声ファイルの長さを取得
    try {
      const metadata = await parseFile(tempFilePath);
      durationInSeconds = Math.round(metadata.format.duration || 0);
    } catch (parseError) {
      console.error("Error parsing audio file:", parseError);
      return NextResponse.json(
        { message: "Error parsing audio file" },
        { status: 500 }
      );
    }

    // (E) Whisper API 呼び出し
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
    });

    // (F) 一時ファイル削除
    await fs.promises.unlink(tempFilePath);

    // (G) トークン＆コスト計算APIの呼び出し（非同期で走らせる）
    void calculateTokensAndCost(userId, durationInSeconds);

    // (H) 結果をレスポンス
    return NextResponse.json({
      transcription: transcription.text,
      durationInSeconds,
    });
  } catch (error: unknown) {
    // (I) エラー処理
    // error は型がunknownなので any へダウンキャストして message を取得
    const err = error as Error;
    console.error("Error processing request:", err);
    return NextResponse.json(
      { message: "Internal Server Error", error: err.message },
      { status: 500 }
    );
  }
}

// --------------------------
// 3. トークン・コスト計算API 呼び出し用関数
// --------------------------
async function calculateTokensAndCost(userId: string, seconds: number) {
  try {
    const response = await fetch("http://localhost:3000/api/tokenCal/whisper", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        seconds,
      }),
    });

    if (!response.ok) {
      console.error(
        "Error calling token calculation API:",
        await response.text()
      );
      return;
    }

    const result = await response.json();
    console.log("Token and cost calculation result:", result);
  } catch (err) {
    console.error("Error calling token calculation API:", err);
  }
}
