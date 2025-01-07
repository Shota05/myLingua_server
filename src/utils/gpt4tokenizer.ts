import { encode } from "gpt-tokenizer";

// 1M（100 万）トークンあたりのコスト
const COST_PER_1M_INPUT_TOKENS = 2.5;
const COST_PER_1M_OUTPUT_TOKENS = 10.0;

// 戻り値の型定義
export type UsageInfo = {
  inputTokens: number; // 入力側のトークン数
  outputTokens: number; // 出力側のトークン数
  inputCost: string; // 入力側のコスト（toFixed のため文字列）
  outputCost: string; // 出力側のコスト（toFixed のため文字列）
  totalCost: string; // 合計コスト（toFixed のため文字列）
};

/**
 * トークン数と料金を計算するユーティリティ関数
 * @param inputText  - 入力テキスト
 * @param outputText - 出力テキスト
 * @returns UsageInfo
 */
export function calculateTokensAndCost(
  inputText: string,
  outputText: string
): UsageInfo {
  const inputTokens = encode(inputText).length;
  const outputTokens = encode(outputText).length;

  const inputCost = (inputTokens / 1_000_000) * COST_PER_1M_INPUT_TOKENS;
  const outputCost = (outputTokens / 1_000_000) * COST_PER_1M_OUTPUT_TOKENS;
  const totalCost = inputCost + outputCost;

  // 小数点以下 4 桁で切り捨てた文字列を返却
  return {
    inputTokens,
    outputTokens,
    inputCost: inputCost.toFixed(4),
    outputCost: outputCost.toFixed(4),
    totalCost: totalCost.toFixed(4),
  };
}
