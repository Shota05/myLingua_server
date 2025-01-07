import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ServerApiVersion } from "mongodb";
import { z } from "zod";
import clientPromise from "@/src/utils/mongodb";

// =======================
// MongoDB の接続設定（環境変数に変更）
// =======================
const MONGODB_URI = process.env.MONGODB_URI as string;
// DB 名とコレクション名を環境変数化
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME as string;
const MONGODB_COLLECTION_NAME = process.env.MONGODB_COLLECTION_NAME as string;

// =======================
// DBに保存される UsageRecord の型定義 (例)
// =======================
type UsageRecord = {
  userId: string;
  recordedMonth: string; // "YYYY-MM" 形式
  totalCost?: number;
  minutes?: number;
  // その他必要なフィールドがあれば追加
};

// =======================
// クエリパラメータの Zod スキーマ
// =======================
const querySchema = z.object({
  userId: z.string(), // 必須
  month: z.string().optional(), // 任意 (指定がなければ今月)
});

// =======================
// GET ハンドラ
// =======================
export async function GET(req: NextRequest) {
  const client = await clientPromise;
  try {
    // 1) クエリパラメータの取得
    const url = new URL(req.url);
    const userIdParam = url.searchParams.get("userId");
    const monthParam = url.searchParams.get("month");
    console.log(userIdParam);
    console.log(monthParam);

    // 2) Zodでバリデーション
    const parseResult = querySchema.safeParse({
      userId: userIdParam,
      month: monthParam,
    });
    if (!parseResult.success) {
      return NextResponse.json(
        {
          message: "Invalid query parameters",
          issues: parseResult.error.issues,
        },
        { status: 400 }
      );
    }

    // バリデーション済みデータ
    const { userId, month } = parseResult.data;

    // 3) 今月をデフォルトに設定
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;
    const targetMonth = month || currentMonth;

    // 4) MongoDB 接続

    const db = client.db(MONGODB_DB_NAME);
    // UsageRecordの型を指定
    const collection = db.collection<UsageRecord>(MONGODB_COLLECTION_NAME);

    // 5) 指定された userId と month のデータを取得
    const records = await collection
      .find({ userId, recordedMonth: targetMonth })
      .toArray();
    console.log(records);
    console.log("Record is here Get Cost");

    if (records.length === 0) {
      return NextResponse.json({
        userId,
        month: targetMonth,
        totalCost: 0, // 小数点以下4桁
        totalMinutes: 0, // 小数点以下2桁
        records, // 取得したドキュメントそのものを含める
      });
    }

    // 6) 集計処理
    const totalCost = records.reduce((sum, record) => {
      // record.totalCost が文字列 or 数値 どちらでも
      // String(...) で文字列化 → parseFloat で数値化
      const costValue = parseFloat(String(record.totalCost ?? 0)) || 0;
      return sum + costValue;
    }, 0);
    const totalMinutes = records.reduce(
      (sum, record) => sum + (record.minutes ?? 0),
      0
    );

    console.log(records);
    console.log(totalCost);
    console.log("Total Cost is here");

    // 7) 結果オブジェクト作成
    const result = {
      userId,
      month: targetMonth,
      totalCost: (4 * Math.round(totalCost * 10000)) / 10000, // 小数点以下4桁
      totalMinutes: Math.round(totalMinutes * 100) / 100, // 小数点以下2桁
      records, // 取得したドキュメントそのものを含める
    };

    // 8) MongoDB の接続を閉じる

    // 9) JSONレスポンスを返却
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Error retrieving cost data:", error);

    // 例外発生時でも必ず接続を閉じる

    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        message: "Error retrieving cost data.",
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
