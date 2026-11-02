import { tokenize } from "../domain/bm25";
import type { Question } from "../domain/contract";

/**
 * Topic-coherent batching: questions that share rare terms (e.g. "gross",
 * "reversed" and "net" questions about the same transfers) are answered in
 * the same model call, so derived figures stay consistent with the component
 * figures. Average-linkage agglomerative clustering on TF-IDF cosine
 * similarity, capped at `size` questions per batch; small clusters are then
 * packed together to keep the number of calls low. Deterministic.
 */
const QUESTION_STOPWORDS = new Set(
  "what which who whom whose how many much is was were are be been the of a an on in at for to did does do by with after before all any each current currently number date answer there that this these those from into as per".split(" "),
);

export function stem(term: string): string {
  if (/^\d/.test(term) || term.length <= 4) return term;
  return term
    .replace(/ies$/, "y")
    .replace(/(ss)$/, "$1")
    .replace(/([^s])s$/, "$1")
    .replace(/(ing|ed|al|ment|ion)$/, "")
    .replace(/e$/, "");
}

function questionTerms(question: Question): string[] {
  return tokenize(question.question)
    .filter((term) => !QUESTION_STOPWORDS.has(term) && term.length > 1)
    .map(stem);
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  let dot = 0;
  for (const [term, weight] of left) dot += weight * (right.get(term) ?? 0);
  const norm = (vector: Map<string, number>) => Math.sqrt([...vector.values()].reduce((sum, w) => sum + w * w, 0));
  const denominator = norm(left) * norm(right);
  return denominator === 0 ? 0 : dot / denominator;
}

export function batchQuestions(questions: Question[], size: number, minSimilarity = 0.08): Question[][] {
  const cap = Math.max(1, size);
  if (questions.length <= cap) return questions.length ? [questions] : [];

  const termLists = questions.map(questionTerms);
  const documentFrequency = new Map<string, number>();
  for (const terms of termLists) for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const vectors = termLists.map((terms) => {
    const vector = new Map<string, number>();
    for (const term of terms) {
      const idf = Math.log((questions.length + 1) / ((documentFrequency.get(term) ?? 0) + 0.5));
      vector.set(term, (vector.get(term) ?? 0) + Math.max(0, idf));
    }
    return vector;
  });
  const similarity = questions.map((_, i) => questions.map((__, j) => (i === j ? 1 : cosine(vectors[i], vectors[j]))));

  let clusters: number[][] = questions.map((_, index) => [index]);
  for (;;) {
    let best: { a: number; b: number; score: number } | null = null;
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        if (clusters[a].length + clusters[b].length > cap) continue;
        let total = 0;
        for (const i of clusters[a]) for (const j of clusters[b]) total += similarity[i][j];
        const score = total / (clusters[a].length * clusters[b].length);
        if (score >= minSimilarity && (!best || score > best.score + 1e-12)) best = { a, b, score };
      }
    }
    if (!best) break;
    const merged = [...clusters[best.a], ...clusters[best.b]].sort((x, y) => x - y);
    clusters = clusters.filter((_, index) => index !== best!.a && index !== best!.b);
    clusters.push(merged);
  }

  // First-fit decreasing packing of clusters into batches of at most `cap`.
  clusters.sort((x, y) => y.length - x.length || x[0] - y[0]);
  const batches: number[][] = [];
  for (const cluster of clusters) {
    const target = batches.find((batch) => batch.length + cluster.length <= cap);
    if (target) target.push(...cluster);
    else batches.push([...cluster]);
  }
  return batches
    .map((batch) => batch.sort((x, y) => x - y))
    .sort((x, y) => x[0] - y[0])
    .map((batch) => batch.map((index) => questions[index]));
}
