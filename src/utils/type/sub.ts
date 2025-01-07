// 例: AppleTransactionPayload, AppleRenewalPayload はすでに定義済みとする
// （質問文には省略されていますが、ペイロードの構造に合わせて適宜定義してください）
export interface AppleTransactionPayload {
  originalTransactionId?: string;
  productId?: string;
  environment?: string;
  expiresDate?: number;
  purchaseDate?: number;
}

export interface AppleRenewalPayload {
  autoRenewProductId?: string;
  autoRenewStatus?: number;
  originalTransactionId?: string;
  environment?: string;
}

/**
 * notificationHistory に格納する要素の型
 */
export interface NotificationHistoryItem {
  notificationType?: string;
  subtype?: string;
  transactionPayload?: AppleTransactionPayload | null;
  renewalPayload?: AppleRenewalPayload | null;
  receivedAt: Date;
}

/**
 * サブスクリプションを表す MongoDB ドキュメントの型
 */
export interface SubscriptionDoc {
  originalTransactionId: string;
  productId?: string;
  environment?: string;
  expiresDate?: Date;
  autoRenewStatus?: number;
  isActive?: boolean;
  notificationType?: string;
  subtype?: string;
  updatedAt?: Date;
  // ここが「配列」であると定義
  notificationHistory?: NotificationHistoryItem[];
}
