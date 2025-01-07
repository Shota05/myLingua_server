import { NextRequest, NextResponse } from "next/server";
import { decodeProtectedHeader, importJWK, jwtVerify, JWTPayload } from "jose";
import clientPromise from "@/src/utils/mongodb"; // MongoDB 接続は clientPromise を利用
export const runtime = "nodejs";
// --- 以下は TypeScript での型定義の例 ---
interface AppleTransactionPayload extends JWTPayload {
  originalTransactionId?: string;
  productId?: string;
  environment?: string;
  expiresDate?: number; // ミリ秒
  purchaseDate?: number; // ミリ秒
}

interface AppleRenewalPayload extends JWTPayload {
  autoRenewProductId?: string;
  autoRenewStatus?: number; // 1=ON, 0=OFF
  originalTransactionId?: string;
  environment?: string;
}

/**
 * NotificationHistoryItem の型
 */
interface NotificationHistoryItem {
  notificationType?: string;
  subtype?: string;
  transactionPayload?: AppleTransactionPayload | null;
  renewalPayload?: AppleRenewalPayload | null;
  receivedAt: Date;
}

/**
 * MongoDB の subscriptions コレクション用ドキュメント型 (例)
 */
interface SubscriptionDoc {
  originalTransactionId: string;
  productId?: string;
  environment?: string;
  expiresDate?: Date;
  autoRenewStatus?: number; // 1=ON, 0=OFF
  isActive?: boolean;
  notificationType?: string;
  subtype?: string;
  updatedAt?: Date;
  notificationHistory?: NotificationHistoryItem[];
}

// =======================
// 環境変数から読み込む
// =======================
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME as string; // 例: "echois"
const MONGODB_COLLECTION_SUBSCRIPTION_NAME = process.env
  .MONGODB_COLLECTION_SUBSCRIPTION_NAME as string;
// 例: "subscriptions"

// ここからWebhook実装
export async function POST(request: NextRequest) {
  try {
    const fullBody = await request.json();

    const { notificationType, subtype, data } = fullBody;
    const { signedTransactionInfo, signedRenewalInfo } = data;

    // 1. JWSをデコード＆検証
    let transactionPayload: AppleTransactionPayload | null = null;
    let renewalPayload: AppleRenewalPayload | null = null;

    if (signedTransactionInfo) {
      transactionPayload = (await verifyAppleJWS(
        signedTransactionInfo
      )) as AppleTransactionPayload;
    }
    if (signedRenewalInfo) {
      renewalPayload = (await verifyAppleJWS(
        signedRenewalInfo
      )) as AppleRenewalPayload;
    }

    // 2. expiresDate / autoRenewStatus を取得
    const expiresDate = transactionPayload?.expiresDate
      ? new Date(transactionPayload.expiresDate)
      : null;
    const autoRenewStatus = renewalPayload?.autoRenewStatus; // 1=ON, 0=OFF

    // originalTransactionId をキーにしてユーザー特定
    const originalTransactionId =
      transactionPayload?.originalTransactionId ||
      renewalPayload?.originalTransactionId;

    if (!originalTransactionId) {
      return NextResponse.json(
        { success: false, message: "No originalTransactionId found." },
        { status: 400 }
      );
    }

    // 3. 有効/無効のシンプル判定
    const isActive = (() => {
      if (!expiresDate) return false;
      return expiresDate.getTime() > Date.now();
    })();

    // 4. MongoDB 更新
    // clientPromise でクライアントを取得
    const client = await clientPromise;
    // 環境変数から取得した DB 名
    const db = client.db(MONGODB_DB_NAME);
    // 環境変数から取得したコレクション名
    const subscriptions = db.collection<SubscriptionDoc>(
      MONGODB_COLLECTION_SUBSCRIPTION_NAME
    );

    await subscriptions.updateOne(
      { originalTransactionId },
      {
        $set: {
          productId: transactionPayload?.productId,
          environment:
            transactionPayload?.environment || renewalPayload?.environment,
          //@ts-ignore
          expiresDate,
          autoRenewStatus,
          isActive,
          notificationType,
          subtype,
          updatedAt: new Date(),
        },
        $push: {
          notificationHistory: {
            notificationType,
            subtype,
            transactionPayload,
            renewalPayload,
            receivedAt: new Date(),
          },
        },
      },
      { upsert: true }
    );

    // Apple には 200 OK を返す
    return NextResponse.json({
      success: true,
      message: "Subscription info updated.",
    });
  } catch (error: any) {
    console.error("Webhook Error:", error);
    // Appleから再送される可能性を考慮し、500を返すか200を返すかは設計次第
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// ----------------
// ここから下は JWS 検証と公開鍵キャッシュ関連

// シンプルなキャッシュ実装 (メモリ)
const appleKeyCache: Record<string, { jwk: any; fetchedAt: number }> = {};
// キャッシュ有効期限(例: 12時間)
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * AppleのJWS文字列を検証し、ペイロードを返す。
 * もし検証に失敗 (鍵のローテーションで古い可能性) したらキャッシュを消して1回だけリトライ。
 */
async function verifyAppleJWS(jws: string): Promise<JWTPayload> {
  const { kid, alg } = decodeProtectedHeader(jws);
  if (!kid) {
    throw new Error('No "kid" in JWS header');
  }

  try {
    const appleJWK = await getApplePublicKey(kid);
    const { payload } = await jwtVerify(jws, await importJWK(appleJWK, alg), {
      issuer: "appstoreconnect.apple.com",
    });
    return payload;
  } catch (err) {
    console.warn(
      "First verification attempt failed. Trying re-fetch key...",
      err
    );

    // 1回だけ再取得してリトライ
    // → もしAppleが鍵をローテーションしており、キャッシュが古い場合を想定
    removeKidFromCache(kid);
    try {
      const appleJWK = await getApplePublicKey(kid);
      const { payload } = await jwtVerify(jws, await importJWK(appleJWK, alg), {
        issuer: "appstoreconnect.apple.com",
      });
      return payload;
    } catch (err2) {
      console.error("Second verification attempt also failed.", err2);
      throw err2; // 最終的に失敗
    }
  }
}

/**
 * kid → Apple 公開鍵(JWK) を返す。キャッシュがあれば使い、なければfetch。
 */
async function getApplePublicKey(kid: string) {
  const now = Date.now();
  // キャッシュチェック
  const cacheEntry = appleKeyCache[kid];
  if (cacheEntry && now - cacheEntry.fetchedAt < CACHE_TTL_MS) {
    return cacheEntry.jwk;
  }

  // キャッシュにない or 期限切れ → Appleへfetch
  const url = `https://api.storekit.itunes.apple.com/inApps/v1/keys/${kid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Apple JWK: kid=${kid}, status=${res.status}`
    );
  }
  const data = await res.json();
  if (!data.keys || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error(`No keys found in Apple JWK response: kid=${kid}`);
  }

  const foundKey = data.keys.find((k: any) => k.kid === kid);
  if (!foundKey) {
    throw new Error(`No matching key found for kid=${kid}`);
  }

  // キャッシュに保存
  appleKeyCache[kid] = {
    jwk: foundKey,
    fetchedAt: now,
  };

  return foundKey;
}

/**
 * kid をキャッシュから削除
 */
function removeKidFromCache(kid: string) {
  delete appleKeyCache[kid];
}
