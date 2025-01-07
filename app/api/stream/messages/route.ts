import { NextRequest, NextResponse } from "next/server";
import { PassThrough } from "stream";
import { z } from "zod";

// =======================
// Zod でクエリパラメータをバリデーション
// =======================
const querySchema = z.object({
  messages: z.string().optional(), // "?messages=..."を想定
  userId: z.string().optional(), // "?userId=..."を想定
  style: z.string().optional(), // "?style=..." 深掘り/フレンドリー/等
  lang: z.string().optional(), // "?lang=..." 返答言語 (ja/en等)
});

// =======================
// 環境変数や定数
// =======================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const TTS_API_ENDPOINT = "https://api.openai.com/v1/audio/speech";

/**
 * SSE + Chat Completion + TTS を行う例
 */
export async function GET(req: NextRequest) {
  try {
    // クエリパラメータを取得し Zod でバリデーション
    const url = new URL(req.url);
    const messagesParam = url.searchParams.get("messages");
    const userIdParam = url.searchParams.get("userId");
    const styleParam = url.searchParams.get("style");
    const langParam = url.searchParams.get("lang");

    const parseResult = querySchema.safeParse({
      messages: messagesParam,
      userId: userIdParam,
      style: styleParam,
      lang: langParam,
    });
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          issues: parseResult.error.issues,
        },
        { status: 400 }
      );
    }

    // バリデーション済みの値を展開
    const { messages, userId, style, lang } = parseResult.data;
    // style, lang が指定されなかった場合のデフォルト
    const finalStyle = style || ""; // 例: "深掘り"をデフォルトとする
    const finalLang = lang || "en"; // 例: "ja"をデフォルトとする

    if (!messages) {
      return NextResponse.json(
        { error: "No messages provided." },
        { status: 400 }
      );
    }

    // SSE 用のストリームを生成
    const stream = new PassThrough();
    // SSE のレスポンスヘッダーを設定
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
    });
    const response = new NextResponse(stream as any, { headers });

    // messagesParam は URI エンコードされている可能性があるのでデコード＋JSON.parse
    let parsedMessages: any[]; // 実際には OpenAI Chat Completion の型が望ましい
    try {
      parsedMessages = JSON.parse(decodeURIComponent(messages));
    } catch (error) {
      console.error("Failed to decode and parse messages:", error);
      stream.write(
        `event: error\ndata: ${JSON.stringify({
          error: "Invalid messages format.",
        })}\n\n`
      );
      stream.end();
      return response;
    }

    // ------------------------------
    // ★ Systemメッセージを先頭に追加
    // ------------------------------
    // 「常に指定言語(finalLang)で返答して、深掘り(または styleParam に応じた)質問を投げる」
    const systemMessage = {
      role: "system",
      content: `
        You are a helpful language-learning assistant.
        The user is practicing ${finalLang}.

        1) ALWAYS respond in ${finalLang}.
        2) Please keep the conversation going by asking deeper questions or exploring the topic further.
           Since your style is "${finalStyle}", be sure to incorporate that style.
        3) At the end of every response, please ask a question back to the user 
           to encourage them to continue practicing and exploring deeper.
      `,
    };

    // Chat Completion の最終メッセージ配列
    const finalMessages = [systemMessage, ...parsedMessages];

    // ------------------------------
    // Chat Completion (stream: true) 実行
    // ------------------------------
    const openAIRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o", // 実際利用可能なモデルに変更 ("gpt-3.5-turbo" など)
          messages: finalMessages,
          stream: true, // ストリーミングモード
        }),
      }
    );

    // OpenAI API エラー時
    if (!openAIRes.ok || !openAIRes.body) {
      console.error("OpenAI API error:", await openAIRes.text());
      stream.write(
        `event: error\ndata: ${JSON.stringify({
          error: "OpenAI API error",
        })}\n\n`
      );
      stream.end();
      return response;
    }

    let buffer = "";
    const sentenceQueue: string[] = [];

    // SSE 読み取り (ReadableStream)
    const reader = openAIRes.body.getReader();

    // ストリーミング読み取りループ
    (async function readStream() {
      let inputTextCollected = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // chunk をテキストに変換
        const chunk = new TextDecoder().decode(value);
        // chunk は "data: {...}" の SSE が複数行含まれる可能性
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.replace(/^data:\s*/, "");

            // [DONE] で終了
            if (jsonStr === "[DONE]") {
              console.log("DONE IS CALLED");

              // 残った buffer があれば処理
              if (buffer.trim()) {
                sentenceQueue.push(buffer.trim());
                buffer = "";
                await processQueue(userId, sentenceQueue, stream, req);
              }
              // トークン計算 API (省略可)
              // ...
              // SSE 終了を通知
              const payload = { text: "DONE" };
              stream.write(`data: ${JSON.stringify(payload)}\n\n`);
              stream.end();
              return;
            }

            try {
              const data = JSON.parse(jsonStr);
              const delta = data?.choices?.[0]?.delta?.content;
              if (delta) {
                buffer += delta;
                inputTextCollected += delta;

                // 句読点で分割
                const sentences = buffer.split(/(?<=[。．！？!?])/);
                // 最後の未完了文は buffer に残す
                buffer = sentences.pop() ?? "";

                // 確定した文をキューへ
                sentenceQueue.push(
                  ...sentences.map((s) => s.trim()).filter((s) => s)
                );

                // 逐次キューを TTS 化 & SSE 送信
                await processQueue(userId, sentenceQueue, stream, req);
              }
            } catch (err) {
              console.error("JSON parse error:", err);
            }
          }
        }
      }

      // ここに来るのは stream が自然終了したケース
      if (buffer.trim()) {
        sentenceQueue.push(buffer.trim());
        buffer = "";
        await processQueue(userId, sentenceQueue, stream, req);
      }
      // 完了イベントを送信
      stream.write("event: end\n");
      stream.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      stream.end();
    })();

    return response;
  } catch (error: unknown) {
    console.error("Error in GET handler:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Server Error", details: errMsg },
      { status: 500 }
    );
  }
}

/**
 * sentenceQueue にある文を TTS 化して SSE 送信
 */
async function processQueue(
  userId: string | undefined,
  queue: string[],
  stream: PassThrough,
  req: NextRequest
) {
  while (queue.length > 0) {
    const sentence = queue.shift();
    if (!sentence) continue;

    // TTS API
    let audioBase64: string | undefined;
    try {
      const ttsRes = await fetch(TTS_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "alloy",
          input: sentence,
        }),
      });

      if (!ttsRes.ok) {
        console.error("TTS error:", await ttsRes.text());
        continue;
      }
      const arrayBuffer = await ttsRes.arrayBuffer();
      audioBase64 = Buffer.from(arrayBuffer).toString("base64");

      // もし必要ならTTSトークン計算APIを呼ぶ
      // ...
    } catch (err) {
      console.error("TTS API error:", err);
      continue;
    }

    // SSE 送信 (text + audio)
    const payload = { text: sentence, audio: audioBase64 };
    stream.write("event: message\n");
    stream.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}
