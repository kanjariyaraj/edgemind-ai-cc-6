// Edge runtime: local embedding + hybrid retrieval primitives.
// Dense side uses a deterministic hashing-trick embedding (stand-in for
// FastEmbed on-device models); sparse side is BM25 over token terms —
// mirroring Qdrant Edge dense + BM25 hybrid search.

const DIM = 256;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "is", "was",
  "were", "be", "been", "it", "its", "this", "that", "with", "for", "by",
  "as", "from", "are", "not", "but", "we", "i", "you", "they", "he", "she",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_.]/g, " ")
    .split(/[\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic dense embedding: each token (plus char-trigram subwords for
// robustness) votes into a fixed-dimensional vector; l2 normalized.
export function embed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const features = [tok];
    if (tok.length > 4) {
      for (let i = 0; i + 3 <= tok.length; i++) features.push("~" + tok.slice(i, i + 3));
    }
    for (const f of features) {
      const h = fnv1a(f);
      const idx = h % DIM;
      const sign = (h & 0x8000) === 0 ? 1 : -1;
      vec[idx] += sign * (f.startsWith("~") ? 0.35 : 1);
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// BM25 (sparse / exact-term retrieval)
export interface Bm25Doc {
  id: number;
  terms: string[];
}

export function bm25Scores(
  queryTerms: string[],
  docs: Bm25Doc[],
  k1 = 1.5,
  b = 0.75,
): Map<number, number> {
  const scores = new Map<number, number>();
  if (docs.length === 0 || queryTerms.length === 0) return scores;
  const avgLen = docs.reduce((s, d) => s + d.terms.length, 0) / docs.length || 1;
  // document frequency
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of queryTerms) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const n = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + (b * d.terms.length) / avgLen);
      score += idf * ((f * (k1 + 1)) / denom);
    }
    if (score > 0) scores.set(d.id, score);
  }
  return scores;
}

export function hashContent(text: string): string {
  return fnv1a(text).toString(16).padStart(8, "0") + fnv1a(text + "::salt").toString(16).padStart(8, "0");
}
