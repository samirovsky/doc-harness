import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createScheduler, createWorker, OEM, type Scheduler } from "tesseract.js";
import { Jimp } from "jimp";
import type { OcrEngine, OcrResult } from "./types";

const require = createRequire(import.meta.url);

/** Language data ships with the @tesseract.js-data/eng npm package: no CDN access at runtime. */
function bundledLangPath(): string {
  return path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
}

/**
 * Offline OCR with tesseract.js (WASM, Node side only). Each image is read as
 * is; when confidence is weak, a grayscale + inverted variant is also tried
 * (light-on-dark designs) and the better reading wins.
 */
export class TesseractOcr implements OcrEngine {
  private scheduler: Promise<Scheduler> | null = null;

  constructor(
    private readonly workers = Math.max(1, Math.min(3, os.cpus().length - 1)),
    private readonly retryBelowConfidence = 75,
  ) {}

  private start(): Promise<Scheduler> {
    this.scheduler ??= (async () => {
      const scheduler = createScheduler();
      const langPath = bundledLangPath();
      const workers = await Promise.all(
        Array.from({ length: this.workers }, () =>
          createWorker("eng", OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: "none" }),
        ),
      );
      workers.forEach((worker) => scheduler.addWorker(worker));
      return scheduler;
    })();
    return this.scheduler;
  }

  private async read(bytes: Uint8Array | Buffer): Promise<OcrResult> {
    const scheduler = await this.start();
    const { data } = await scheduler.addJob("recognize", Buffer.from(bytes));
    return { text: data.text, confidence: data.confidence, engine: "tesseract.js" };
  }

  async recognize(bytes: Uint8Array): Promise<OcrResult> {
    const first = await this.read(bytes);
    if (first.confidence >= this.retryBelowConfidence) return first;
    try {
      const image = await Jimp.read(Buffer.from(bytes));
      image.greyscale().invert().contrast(0.2);
      const second = await this.read(await image.getBuffer("image/png"));
      return second.confidence > first.confidence ? { ...second, engine: "tesseract.js (inverted)" } : first;
    } catch {
      return first;
    }
  }

  async close(): Promise<void> {
    if (!this.scheduler) return;
    const scheduler = await this.scheduler;
    await scheduler.terminate();
    this.scheduler = null;
  }
}
