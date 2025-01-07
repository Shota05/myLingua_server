// schemas/sentenceCard.ts
import { z } from "zod";

/**
 * 1つの SentenceCard: text + translation
 */
export const SingleSentenceCardSchema = z.object({
  text: z.string(),
  translation: z.string(),
});

/**
 * トップレベル: { sentenceCards: Array<SingleSentenceCardSchema> }
 */
export const SentenceCardListSchema = z.object({
  sentenceCards: z.array(SingleSentenceCardSchema),
});
