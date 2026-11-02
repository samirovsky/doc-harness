import { blockText, type CorpusDocument } from "./document";
import { estimateTokens } from "./tokens";

/**
 * Lexical retrieval (Okapi BM25) over document chunks. Used when the
 * non-archive corpus exceeds the prompt budget, and by the agent's
 * `search_corpus` tool. Lexical matching suits this domain: questions share
 * exact identifiers, field labels and numbers with the evidence.
 */
export interface Chunk {
  id: string;
  fileId: string;
  locator: string;
  text: string;
  tokens: number;
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

const STOPWORDS = new Set(
  "a an and are as at be by did do does for from had has have how in is it its many much of on or the this to was were what when which who whom will with".split(" "),
);

export function tokenize(text: string): string[] {
  const lower = text.normalize("NFKC").toLowerCase();
  const terms: string[] = [];
  for (const raw of lower.match(/[a-z0-9][a-z0-9.,\-/]*[a-z0-9]|[a-z0-9]/g) ?? []) {
    const compact = raw.replace(/,(?=\d{3}\b)/g, "");
    if (!STOPWORDS.has(compact)) terms.push(compact);
    if (/[-./]/.test(compact)) {
      for (const part of compact.split(/[-./]/)) if (part && !STOPWORDS.has(part)) terms.push(part);
    }
  }
  return terms;
}

/** Splits documents into chunks of at most ~maxTokens; table chunks repeat their header. */
export function chunkDocuments(documents: CorpusDocument[], maxTokens: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (const document of documents) {
    let counter = 0;
    const push = (locator: string, text: string) => {
      chunks.push({
        id: `${document.fileId}#${counter++}`,
        fileId: document.fileId,
        locator,
        text,
        tokens: estimateTokens(text),
      });
    };
    for (const block of document.blocks) {
      const lines =
        block.kind === "table" ? block.rows.map((row) => row.join(" | ")) : blockText(block).split("\n");
      const header = block.kind === "table" ? block.header.join(" | ") : "";
      let buffer: string[] = [];
      let bufferTokens = estimateTokens(header);
      const flush = () => {
        if (buffer.length === 0) return;
        push(block.locator, [header, ...buffer].filter(Boolean).join("\n"));
        buffer = [];
        bufferTokens = estimateTokens(header);
      };
      for (const line of lines) {
        const lineTokens = estimateTokens(line) + 1;
        if (buffer.length > 0 && bufferTokens + lineTokens > maxTokens) flush();
        buffer.push(line);
        bufferTokens += lineTokens;
      }
      flush();
      // A header-only table (e.g. a one-line CSV) still carries searchable content.
      if (lines.length === 0 && header) push(block.locator, header);
    }
  }
  return chunks;
}

export class Bm25Index {
  private readonly termFrequencies: Map<string, number>[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly lengths: number[];
  private readonly averageLength: number;

  constructor(
    readonly chunks: Chunk[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.termFrequencies = chunks.map((chunk) => {
      const frequencies = new Map<string, number>();
      for (const term of tokenize(chunk.text)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      for (const term of frequencies.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      return frequencies;
    });
    this.lengths = this.termFrequencies.map((frequencies) =>
      [...frequencies.values()].reduce((total, count) => total + count, 0),
    );
    this.averageLength = this.lengths.reduce((total, length) => total + length, 0) / Math.max(1, chunks.length);
  }

  search(query: string, limit: number, filter?: (chunk: Chunk) => boolean): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    const total = this.chunks.length;
    const hits: SearchHit[] = [];
    this.chunks.forEach((chunk, index) => {
      if (filter && !filter(chunk)) return;
      let score = 0;
      for (const term of terms) {
        const frequency = this.termFrequencies[index].get(term);
        if (!frequency) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        const norm = frequency + this.k1 * (1 - this.b + (this.b * this.lengths[index]) / (this.averageLength || 1));
        score += idf * ((frequency * (this.k1 + 1)) / norm);
      }
      if (score > 0) hits.push({ chunk, score });
    });
    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }
}
