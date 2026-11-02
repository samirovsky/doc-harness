import type { Corpus, CorpusDocument } from "../domain/document";
import type { LlmGateway, Logger } from "./ports";
import { VISION_PROMPT } from "./prompts";

/**
 * Vision fallback: images whose local OCR was too weak to trust (the ingester
 * kept their bytes) are transcribed by the model. Successful transcriptions
 * replace the OCR text; failures keep the OCR text.
 */
export async function transcribeWeakImages(
  corpus: Corpus,
  gateway: LlmGateway,
  options: { logger: Logger; signal?: AbortSignal; limit: <T>(task: () => Promise<T>) => Promise<T> },
): Promise<{ corpus: Corpus; transcribed: string[] }> {
  const weak = corpus.documents.filter((document) => document.image);
  if (weak.length === 0) return { corpus, transcribed: [] };
  const transcribed: string[] = [];
  const replaced = new Map<string, CorpusDocument>();
  await Promise.all(
    weak.map((document) =>
      options.limit(async () => {
        try {
          const response = await gateway.complete(
            {
              purpose: "vision",
              reasoning: "off",
              temperature: 0,
              maxTokens: 2_000,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: VISION_PROMPT },
                    { type: "image_url", image_url: { url: `data:${document.image!.mimeType};base64,${document.image!.base64}` } },
                  ],
                },
              ],
              meta: { fileId: document.fileId },
            },
            options.signal,
          );
          const text = response.content.trim();
          if (text.length < 10) return;
          replaced.set(document.fileId, {
            ...document,
            image: undefined,
            blocks: [
              { kind: "text", locator: "image text (vision transcription)", text },
              ...document.blocks.map((block) => ({ ...block, locator: `${block.locator} — low-confidence OCR` })),
            ],
          });
          transcribed.push(document.fileId);
        } catch (error) {
          options.logger.warn(`vision transcription failed for ${document.fileId}: ${(error as Error).message}`);
        }
      }),
    ),
  );
  return {
    corpus: { documents: corpus.documents.map((document) => replaced.get(document.fileId) ?? document) },
    transcribed,
  };
}
