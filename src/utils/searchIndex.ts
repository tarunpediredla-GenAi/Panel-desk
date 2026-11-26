import type { IndexedQuestion, PdfIndex } from '../types';

export const MISSING_ANSWER_TEXT = "I couldn’t find that answer in your PDF.";

const STOP_WORDS = new Set([
  'a',
  'about',
  'actually',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'for',
  'from',
  'get',
  'give',
  'had',
  'has',
  'have',
  'having',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'please',
  'question',
  'say',
  'should',
  'show',
  'so',
  'tell',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

const FOLLOW_UP_PATTERNS: RegExp[] = [
  /^(?:can\s+you\s+)?(?:give|show|share|provide)\s+(?:me\s+)?(?:an?\s+)?(?:example|sample|code\s+example|illustration|use\s+case)\b/i,
  /^(?:example|another\s+example|one\s+more\s+example|for\s+example)\??$/i,
  /^(?:can\s+you\s+)?(?:simplify|shorten|rephrase|summarize|explain)\s+(?:that|this|it)\b/i,
  /^(?:in\s+)?(?:simpler|simple|plain|easier|shorter)\s+(?:words|terms|english)\b/i,
  /^(?:shorter|simpler|elaborate|go\s+on|continue|tell\s+me\s+more|explain\s+more|more\s+details?|why|how\s+so|how\s+does\s+that\s+work)\??$/i,
  /^(?:what\s+does\s+that\s+mean|can\s+you\s+say\s+that\s+(?:again|simpler|shorter)|how\s+would\s+i\s+say\s+that)\b/i,
  /^(?:and\s+)?what\s+about\s+(?:the\s+)?(?:example|edge\s+case|performance|caveat|difference)\b/i,
];

export function normalizeToken(raw: string): string {
  const lower = raw.toLowerCase().replace(/[^a-z0-9_+#]/g, '');
  if (lower.length <= 2) return lower;
  // Light plural/verb folding so "querysets"/"queryset", "runs"/"run", "filters"/"filter" align
  if (lower.endsWith('ies') && lower.length > 4) {
    return lower.slice(0, -3) + 'y';
  }
  if (lower.endsWith('ing') && lower.length > 5) {
    return lower.slice(0, -3);
  }
  if (lower.endsWith('ed') && lower.length > 4 && !lower.endsWith('eed')) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith('es') && lower.length > 4 && /(?:ch|sh|x|z|s)es$/.test(lower)) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith('s') && lower.length > 3 && !lower.endsWith('ss') && !lower.endsWith('us')) {
    return lower.slice(0, -1);
  }
  return lower;
}

export function tokenizeContent(text: string): string[] {
  const rawTokens = text
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9_+#]+/)
    .filter(Boolean);

  const tokens: string[] = [];
  for (const raw of rawTokens) {
    if (STOP_WORDS.has(raw)) continue;
    const norm = normalizeToken(raw);
    if (!norm || STOP_WORDS.has(norm)) continue;
    tokens.push(norm);
  }
  return tokens;
}

function buildBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}

interface IndexedDoc {
  item: IndexedQuestion;
  qTokens: Map<string, number>;
  aTokens: Map<string, number>;
  qBigrams: Set<string>;
  qLength: number;
  aLength: number;
  normalizedQuestion: string;
}

export interface SearchEngine {
  fileName: string;
  idMap: Map<string, IndexedQuestion>;
  docs: IndexedDoc[];
  idf: Map<string, number>;
  avgQLen: number;
  avgALen: number;
  allCorpusTokens: Set<string>;
}

export interface ScoredCandidate {
  item: IndexedQuestion;
  score: number;
  questionCoverage: number;
  matchedTerms: string[];
}

export interface SearchResult {
  matchType: 'exact_id' | 'strong_match' | 'candidates' | 'none';
  exactMatch: IndexedQuestion | null;
  candidates: ScoredCandidate[];
  queryTokens: string[];
  corpusMatchedTokens: string[];
}

export function buildSearchEngine(index: PdfIndex): SearchEngine {
  const idMap = new Map<string, IndexedQuestion>();
  const docs: IndexedDoc[] = [];
  const docFreq = new Map<string, number>();
  const allCorpusTokens = new Set<string>();

  let totalQLen = 0;
  let totalALen = 0;

  for (const item of index.questions) {
    idMap.set(item.normalizedId, item);

    const qList = tokenizeContent(item.question);
    const aList = tokenizeContent(item.answer);

    const qTokens = new Map<string, number>();
    const aTokens = new Map<string, number>();
    const uniqueInDoc = new Set<string>();

    for (const t of qList) {
      qTokens.set(t, (qTokens.get(t) ?? 0) + 1);
      uniqueInDoc.add(t);
      allCorpusTokens.add(t);
    }
    for (const t of aList) {
      aTokens.set(t, (aTokens.get(t) ?? 0) + 1);
      uniqueInDoc.add(t);
      allCorpusTokens.add(t);
    }

    for (const t of uniqueInDoc) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }

    totalQLen += qList.length;
    totalALen += aList.length;

    docs.push({
      item,
      qTokens,
      aTokens,
      qBigrams: new Set(buildBigrams(qList)),
      qLength: Math.max(1, qList.length),
      aLength: Math.max(1, aList.length),
      normalizedQuestion: item.question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  }

  // Also add tokens from raw pages so corpus presence checks cover unparsed text if any
  for (const page of index.pages) {
    for (const t of tokenizeContent(page.text)) {
      allCorpusTokens.add(t);
    }
  }

  const N = Math.max(1, docs.length);
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq.entries()) {
    idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }

  return {
    fileName: index.fileName,
    idMap,
    docs,
    idf,
    avgQLen: docs.length > 0 ? Math.max(1, totalQLen / docs.length) : 1,
    avgALen: docs.length > 0 ? Math.max(1, totalALen / docs.length) : 1,
    allCorpusTokens,
  };
}

/**
 * Checks if the user asked directly for a specific question ID (e.g. "B3", "question I88", "show me A413").
 */
export function extractExactQuestionId(
  query: string,
  idMap: Map<string, IndexedQuestion>
): IndexedQuestion | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Direct bare ID like "B3" or "I88?" or "#A413"
  const bare = trimmed.replace(/^[#\s]+|[?!.\s]+$/g, '').toUpperCase();
  if (idMap.has(bare)) {
    return idMap.get(bare)!;
  }

  // Short ID-focused query like "question B3", "show me I88", "explain A413", "what is B3?"
  const words = trimmed.split(/\s+/);
  if (words.length <= 6) {
    const matches = trimmed.match(/\b([A-Za-z]{1,3}\d{1,4})\b/g);
    if (matches) {
      for (const m of matches) {
        const key = m.toUpperCase();
        if (idMap.has(key)) {
          return idMap.get(key)!;
        }
      }
    }
  }

  return null;
}

/**
 * Determines whether the user's message is a conversational follow-up
 * referring to the active interview question in context.
 */
export function isFollowUpQuery(query: string, hasActiveQuestion: boolean): boolean {
  if (!hasActiveQuestion) return false;
  const trimmed = query.trim();
  if (!trimmed) return false;

  for (const pattern of FOLLOW_UP_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Short deictic follow-ups referring to "that", "it", "this"
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 8 && /\b(that|it|this|them)\b/i.test(trimmed) && /\b(example|simpler|shorter|explain|why|how|mean|elaborate|more|clarify)\b/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Runs fast client-side exact ID lookup and BM25 + phrase ranking over the indexed PDF questions.
 */
export function searchPdfIndex(engine: SearchEngine, query: string, limit = 6): SearchResult {
  const exact = extractExactQuestionId(query, engine.idMap);
  if (exact) {
    return {
      matchType: 'exact_id',
      exactMatch: exact,
      candidates: [{ item: exact, score: 100, questionCoverage: 1, matchedTerms: [exact.normalizedId] }],
      queryTokens: [exact.normalizedId.toLowerCase()],
      corpusMatchedTokens: [exact.normalizedId.toLowerCase()],
    };
  }

  const queryTokens = tokenizeContent(query);
  const uniqueQueryTokens = Array.from(new Set(queryTokens));
  const queryBigrams = buildBigrams(queryTokens);
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const corpusMatchedTokens = uniqueQueryTokens.filter((t) => engine.allCorpusTokens.has(t));

  if (uniqueQueryTokens.length === 0 || corpusMatchedTokens.length === 0) {
    return {
      matchType: 'none',
      exactMatch: null,
      candidates: [],
      queryTokens: uniqueQueryTokens,
      corpusMatchedTokens: [],
    };
  }

  const k1 = 1.4;
  const b = 0.7;

  const scored: ScoredCandidate[] = [];

  for (const doc of engine.docs) {
    let score = 0;
    const matchedTerms: string[] = [];
    let qMatchedCount = 0;

    for (const term of uniqueQueryTokens) {
      const termIdf = engine.idf.get(term) ?? 0;
      const qTf = doc.qTokens.get(term) ?? 0;
      const aTf = doc.aTokens.get(term) ?? 0;

      if (qTf > 0 || aTf > 0) {
        matchedTerms.push(term);
      }

      if (qTf > 0) {
        qMatchedCount++;
        const bm25Q = (qTf * (k1 + 1)) / (qTf + k1 * (1 - b + (b * doc.qLength) / engine.avgQLen));
        score += termIdf * bm25Q * 3.2;
      }

      if (aTf > 0) {
        const bm25A = (aTf * (k1 + 1)) / (aTf + k1 * (1 - b + (b * doc.aLength) / engine.avgALen));
        score += termIdf * bm25A * 1.1;
      }
    }

    if (score <= 0) continue;

    // Bigram boost for phrase fidelity
    for (const bg of queryBigrams) {
      if (doc.qBigrams.has(bg)) {
        score += 2.2;
      }
    }

    // Direct question substring match boost
    if (
      normalizedQuery.length >= 10 &&
      (doc.normalizedQuestion.includes(normalizedQuery) || normalizedQuery.includes(doc.normalizedQuestion))
    ) {
      score += 8.0;
    }

    const questionCoverage = uniqueQueryTokens.length > 0 ? qMatchedCount / uniqueQueryTokens.length : 0;
    scored.push({
      item: doc.item,
      score,
      questionCoverage,
      matchedTerms,
    });
  }

  scored.sort((aDoc, bDoc) => bDoc.score - aDoc.score);
  const topCandidates = scored.slice(0, limit);

  if (topCandidates.length === 0) {
    return {
      matchType: 'none',
      exactMatch: null,
      candidates: [],
      queryTokens: uniqueQueryTokens,
      corpusMatchedTokens,
    };
  }

  const best = topCandidates[0];
  const second = topCandidates[1];
  const scoreMargin = second ? best.score / Math.max(0.01, second.score) : 2.5;

  const isStrongDirectMatch =
    (best.questionCoverage >= 0.75 && best.matchedTerms.length >= 2 && scoreMargin >= 1.35) ||
    (best.questionCoverage === 1 && best.matchedTerms.length >= 2);

  return {
    matchType: isStrongDirectMatch ? 'strong_match' : 'candidates',
    exactMatch: isStrongDirectMatch ? best.item : null,
    candidates: topCandidates,
    queryTokens: uniqueQueryTokens,
    corpusMatchedTokens,
  };
}

/**
 * Checks whether a PDF answer is already short, plain, spoken-English prose (2-3 sentences max)
 * so exact/strong index hits can return instantaneously without waiting on an LLM call.
 */
export function isAlreadyConciseSpokenAnswer(answer: string): boolean {
  const cleaned = answer.trim();
  if (!cleaned || cleaned.length < 25 || cleaned.length > 420) return false;
  // Avoid returning code-heavy, bullet-heavy, or symbol-heavy raw excerpts directly
  if (/[`{}[\];<>]|(?:^|\s)[-•*]\s/.test(cleaned)) return false;

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.length >= 1 && sentences.length <= 3;
}

/**
 * Extracts a fast, 2-3 sentence spoken-English answer directly from a clean prose PDF passage
 * for exact ID or strong direct question matches. Returns null if the passage contains code/lists
 * or needs Gemini simplification.
 */
export function extractDirectSpokenAnswer(answer: string): string | null {
  const cleaned = answer.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 25) return null;
  // Defer code-heavy, bullet-heavy, or very long multi-paragraph passages to Gemini for simplification
  if (/[`{}[\];<>]|(?:^|\s)[-•*]\s/.test(cleaned) || cleaned.length > 650) {
    return null;
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return null;

  // Pick up to 3 concise sentences that read cleanly aloud in an interview
  const chosen: string[] = [];
  let charCount = 0;
  for (const s of sentences) {
    if (chosen.length >= 3) break;
    if (chosen.length >= 2 && charCount + s.length > 340) break;
    chosen.push(s);
    charCount += s.length + 1;
  }

  return chosen.length > 0 ? chosen.join(' ') : null;
}

/**
 * Formats a clean citation label such as "I88 · Page 71" or "I88 · Pages 71–72".
 */
export function formatCitationLabel(questionId: string, pageStart: number, pageEnd: number): string {
  if (pageEnd > pageStart) {
    return `${questionId} · Page ${pageStart}`;
  }
  return `${questionId} · Page ${pageStart}`;
}

export function formatPageRange(pageStart: number, pageEnd: number): string {
  if (pageEnd > pageStart) {
    return `Pages ${pageStart}–${pageEnd}`;
  }
  return `Page ${pageStart}`;
}
