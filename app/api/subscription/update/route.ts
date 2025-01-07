import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import clientPromise from "@/src/utils/mongodb";
export const runtime = "nodejs";
// =======================
// Apple verifyReceipt 用のURL (Sandbox or Production)
// =======================
const APPLE_VERIFY_RECEIPT_URL =
  process.env.NODE_ENV === "production"
    ? "https://buy.itunes.apple.com/verifyReceipt"
    : "https://sandbox.itunes.apple.com/verifyReceipt";

// Appleの Shared Secret
const sharedSecret = process.env.APPLE_SHARED_SECRET ?? "";

// =======================
// 環境変数から取得（MongoDB 関連）
// =======================
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME as string;
const MONGODB_COLLECTION_SUBSCRIPTION_NAMEE = process.env
  .MONGODB_COLLECTION_SUBSCRIPTION_NAME as string;

// =======================
// スキーマ: リクエストBody
// =======================
const UpdateSchema = z.object({
  userId: z.string(),
  newReceiptData: z.string(), // Base64 string
});

export async function POST(request: NextRequest) {
  try {
    // -----------------------
    // 1. リクエストBody 取得 & バリデーション
    // -----------------------
    const json = await request.json();
    const { userId, newReceiptData } = UpdateSchema.parse(json);

    // -----------------------
    // 2. AppleにverifyReceipt
    // -----------------------
    const body = {
      "receipt-data": newReceiptData,
      password: sharedSecret,
    };

    const appleRes = await fetch(APPLE_VERIFY_RECEIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!appleRes.ok) {
      throw new Error("Failed to verify receipt from Apple");
    }

    const appleData = await appleRes.json();

    // ステータス判定 (簡略化)
    let finalStatus = "expired";
    let expiresDate: number | null = null;

    if (appleData.status === 0) {
      finalStatus = "active";
      const latestInfo = appleData.latest_receipt_info?.[0];
      if (latestInfo) {
        expiresDate = parseInt(latestInfo.expires_date_ms, 10) || null;
      }
    }

    // -----------------------
    // 3. DB に最新情報を保存
    // -----------------------
    const client = await clientPromise;
    const db = client.db(MONGODB_DB_NAME);
    const subscriptions = db.collection(MONGODB_COLLECTION_SUBSCRIPTION_NAMEE);

    // userId で検索し、なければ新規作成、あれば更新
    await subscriptions.updateOne(
      { userId },
      {
        $set: {
          userId,
          latestReceiptData: newReceiptData,
          status: finalStatus,
          expiresDate,
        },
      },
      { upsert: true } // なければ作成
    );

    // -----------------------
    // 4. レスポンス
    // -----------------------
    return NextResponse.json({
      status: "success",
      message: "Subscription updated",
      subscriptionStatus: finalStatus,
      expiresDate,
      appleData, // 必要に応じて返す or 返さない
    });
  } catch (err) {
    console.error("POST /api/subscription/update error:", err);
    return NextResponse.json(
      { status: "error", message: "Failed to update subscription" },
      { status: 500 }
    );
  }
}
