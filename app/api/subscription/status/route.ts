import clientPromise from "@/src/utils/mongodb";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
// =======================
// 環境変数
// =======================
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME as string;
const MONGODB_COLLECTION_SUBSCRIPTION_NAME = process.env
  .MONGODB_COLLECTION_SUBSCRIPTION_NAME as string;

interface SubscriptionDoc {
  userId: string;
  originalTransactionId?: string;
  productId?: string;
  environment?: string;
  expiresDate?: Date;
  autoRenewStatus?: number; // 1=ON, 0=OFF
  isActive?: boolean;
  updatedAt?: Date;
  notificationHistory?: any[];
}

export async function GET(request: NextRequest) {
  try {
    // クエリパラメータから userId を取得
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Missing userId" },
        { status: 400 }
      );
    }

    // MongoDB 接続
    const client = await clientPromise;
    const db = client.db(MONGODB_DB_NAME);
    const subscriptions = db.collection<SubscriptionDoc>(
      MONGODB_COLLECTION_SUBSCRIPTION_NAME
    );

    // userId に紐づくサブスク情報を取得
    // ※ 複数存在しうる場合は、sort などで最新を取得するとよい
    const subscriptionData = await subscriptions.findOne({ userId });

    // 1) サブスクリプションが存在しない → Free会員
    if (!subscriptionData) {
      return NextResponse.json({
        success: true,
        subscriptionStatus: "free", // "none" の代わりに "free" と返す
        details: null,
      });
    }

    // 2) サブスクリプションが存在する → 期間内かどうかチェック
    const now = new Date();
    const expiresDate = subscriptionData.expiresDate ?? null;
    let subscriptionStatus: "active" | "expired" = "expired";

    if (expiresDate && expiresDate > now) {
      // 現在日時より先に期限がある → active
      subscriptionStatus = "active";
    } else {
      // 期限が切れている or expiresDateがnull → expired
      subscriptionStatus = "expired";
    }

    // autoRenewStatus などの値も必要に応じてレスポンスに含める
    return NextResponse.json({
      success: true,
      subscriptionStatus,
      productId: subscriptionData.productId,
      autoRenewStatus: subscriptionData.autoRenewStatus,
      expiresDate,
      environment: subscriptionData.environment,
    });
  } catch (error: any) {
    console.error("Error in GET /api/subscription/status:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
