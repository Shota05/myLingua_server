import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/src/utils/mongodb";
export const runtime = "nodejs";
// Appleの共有シークレット
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET || "";

// サンドボックス/本番URL
const APPLE_VERIFY_RECEIPT_URL =
  process.env.NODE_ENV === "production"
    ? "https://buy.itunes.apple.com/verifyReceipt"
    : "https://sandbox.itunes.apple.com/verifyReceipt";

// ===============
// 環境変数 (MongoDB関連)
// ===============
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME as string;
const MONGODB_COLLECTION_SUBSCRIPTION_NAME = process.env
  .MONGODB_COLLECTION_SUBSCRIPTION_NAME as string;

export async function POST(request: NextRequest) {
  try {
    const { receipt, userId } = await request.json();

    if (!receipt || !userId) {
      return NextResponse.json(
        { success: false, message: "receipt or userId missing" },
        { status: 400 }
      );
    }

    // Apple の verifyReceipt 用のリクエスト
    const body = {
      "receipt-data": receipt,
      password: APPLE_SHARED_SECRET,
      "exclude-old-transactions": true,
    };

    // Apple サーバーへレシート検証
    const verifyResponse = await fetch(APPLE_VERIFY_RECEIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!verifyResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to reach Apple verification server.",
        },
        { status: 500 }
      );
    }

    const verifyData = await verifyResponse.json();
    if (verifyData.status !== 0) {
      // エラー対応（21007など）
      return NextResponse.json(
        {
          success: false,
          message: `Apple Verification Error. status=${verifyData.status}`,
          appleRawResponse: verifyData,
        },
        { status: 400 }
      );
    }

    // レシート検証が成功した場合(DBに保存)
    // clientPromise でキャッシュした接続を取得
    const dbClient = await clientPromise;
    const db = dbClient.db(MONGODB_DB_NAME);
    const subscriptions = db.collection(MONGODB_COLLECTION_SUBSCRIPTION_NAME);

    await subscriptions.insertOne({
      userId,
      environment: verifyData.environment, // Sandbox or Production
      originalReceipt: receipt,
      verifyData,
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: "Receipt verified and data saved successfully",
    });
  } catch (error: any) {
    console.error("Verify Receipt Error:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
