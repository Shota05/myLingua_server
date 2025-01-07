import { z } from "zod";

// 1つの Expression オブジェクト
export const ExpressionSchema = z.object({
  foreign: z.string(),
  native: z.string(),
});

// **トップレベルが配列**ではなく、オブジェクトで包む
// ここでは「expressions」キーに配列を格納する形
export const ExpressionListSchema = z.object({
  expressions: z.array(ExpressionSchema),
});
