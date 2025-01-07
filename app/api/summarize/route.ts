import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z, type infer as ZodInfer } from "zod";

// ---------------------
// 1. Zodスキーマを定義 (Structured Outputs用)
// ---------------------
const PromptEvaluationWithLanguage = z.object({
  language: z.string().optional(),
  summarize: z.string(),
});

type TPromptEvaluationWithLanguage = ZodInfer<
  typeof PromptEvaluationWithLanguage
>;

// ---------------------
// 2. OpenAIの設定
// ---------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

// ---------------------
// 3. Request Bodyの型定義
// ---------------------
type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

interface SummarizeChatMidRequestBody {
  style: string; // サマリースタイル
  prompts: string; // プロンプト（文字列 or JSON文字列など、実際の構造にあわせて修正）
  chats: ChatMessage[]; // チャット履歴
  previousSummary?: string; // 前回のサマリー(任意)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // (A) リクエストボディを取得
    const body: SummarizeChatMidRequestBody = await req.json();

    // --- 詳細ログ: 受け取った body を全てダンプ ---
    console.log("==== [summarizeChatMid] BODY DUMP ====");
    console.log(JSON.stringify(body, null, 2));

    const { chats, previousSummary } = body;

    // --- 詳細ログ: 主要プロパティを個別表示 ---
    console.log("== chats:", JSON.stringify(chats, null, 2));
    console.log("== previousSummary:", previousSummary);

    if (!chats) {
      console.log("Missing required fields in request body");
      return NextResponse.json(
        {
          error: "Missing 'style', 'prompts', or 'chats' in request body.",
        },
        { status: 400 }
      );
    }

    // (D) chatsをOpenAI API形式に変換
    const messages = chats.map((chat) => ({
      role: chat.role,
      content: chat.content,
    }));

    // --- 詳細ログ: OpenAIに渡す messages をダンプ ---
    console.log("==== [summarizeChatMid] MESSAGES for OpenAI ====");
    console.log(JSON.stringify(messages, null, 2));

    // (E) 要約用のプロンプト
    const summarizePrompt = `
      You are an assistant summarizing conversation.

      **Previous Summary:**
      ${previousSummary || ""}

      **New Conversation Messages:**
      ${messages.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}

      **Task:**
      Summarize the updated context, combining the previous summary and new conversation insights. Include language detection.

      **Output Format (JSON):**
      {
        "language": "ja",
        "summarize": "Updated summary combining the previous and new conversation."
      }

      **Example Output:**
      {
        "language": "ja",
        "summarize": "The conversation explored the user's focus on productivity and the importance of staying motivated."
      }
    `;

    // --- 詳細ログ: summarizePrompt 全体を確認 ---
    console.log("==== [summarizeChatMid] Summarize Prompt ====");
    console.log(summarizePrompt);

    // (F) OpenAIに送信
    console.log("==== [summarizeChatMid] Sending request to OpenAI... ====");
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini", // 実際利用可能なモデル名に修正
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that evaluates whether user prompts have been answered based on conversation history. Please provide a JSON response as instructed.",
        },
        {
          role: "user",
          content: summarizePrompt,
        },
      ],
      response_format: zodResponseFormat(PromptEvaluationWithLanguage, "event"),
    });

    // --- 詳細ログ: OpenAI からの応答全体をダンプ (completion) ---
    console.log("==== [summarizeChatMid] OpenAI COMPLETION RESULT ====");
    console.dir(completion, { depth: null });

    const eventMessage = completion.choices[0].message;

    // (I) Refusal
    if (eventMessage.refusal) {
      console.error("OpenAI refused to answer:", eventMessage.refusal);
      return NextResponse.json(
        {
          error: "OpenAI refused to answer: " + eventMessage.refusal,
        },
        { status: 403 }
      );
    }

    // (J) 構造化出力
    const structuredOutput = eventMessage.parsed;
    console.log("==== [summarizeChatMid] structuredOutput ====");
    console.log(JSON.stringify(structuredOutput, null, 2));

    if (!structuredOutput) {
      return NextResponse.json(
        {
          error: "No structured output returned.",
        },
        { status: 500 }
      );
    }

    const { language, summarize } = structuredOutput;

    // (L) systemメッセージ生成
    const systemMessage = {
      role: "system",
      content: `here's the updated summary:\n\n${summarize}\n\nLet me know if there's anything else you'd like to explore.`,
    };

    // (M) 最終ログ & レスポンス
    console.log("==== [summarizeChatMid] Response ====");
    console.log(
      JSON.stringify({ systemMessage, summarize, language }, null, 2)
    );

    return NextResponse.json(
      { systemMessage, summarize, language },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in summarizeChatMid POST:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
