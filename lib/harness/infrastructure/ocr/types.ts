export interface OcrResult {
  text: string;
  /** 0–100 mean confidence. */
  confidence: number;
  engine: string;
}

export interface OcrEngine {
  recognize(bytes: Uint8Array): Promise<OcrResult>;
  close(): Promise<void>;
}
