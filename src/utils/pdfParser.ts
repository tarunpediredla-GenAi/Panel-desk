import type { IndexedQuestion, PageText } from '../types';

export interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

const KNOWN_ACRONYM_IDS = new Set([
  'S3',
  'EC2',
  'ES5',
  'ES6',
  'ES7',
  'ES8',
  'UTF8',
  'MD5',
  'SHA1',
  'SHA2',
  'HTTP2',
  'HTTP3',
  'IPV4',
  'IPV6',
  'V8',
  'K8',
  'B2B',
  'B2C',
  'H2O',
  'O2',
  'CO2',
  'L1',
  'L2',
  'L3',
  'G1',
  'C1',
  'C2',
  'X86',
  'HTML5',
  'CSS3',
  'TLS1',
  'O1',
  'N1',
  'P2P',
  'A11Y',
]);

// Matches e.g.:
//   "B3. What is..."
//   "I88: When does Django..."
//   "A413) Explain..."
//   "I88 - When does..."
//   "[B3] What is..."
//   "Q. I88 When does..."
//   "Question B3: What is..."
//   "I88 When does Django..."
//   "I88" (standalone line)
const ALPHA_NUM_ID_LINE_RE =
  /^(?:[•\-–—*]\s*)?(?:(?:Question|Ques|Q)\.?\s*)?\[?\s*([A-Z]{1,3}\d{1,4})\s*\]?(?:(?:\s*[:.\)\-–—·|]\s*)|\s+|$)(.*)$/;

const NUMERIC_Q_LINE_RE =
  /^(?:[•\-–—*]\s*)?(?:(?:Question|Ques|Q)\.?\s*)?(\d{1,4})(?:\s*[:.\)\-–—]\s+)(.+)$/;

const EXPLICIT_ANSWER_MARKER_RE =
  /^(?:Answer|Ans|A|Short\s+Answer|Explanation|Solution)\s*[:.\-–—]\s*(.*)$/i;

const PAGE_NUMBER_ONLY_RE =
  /^(?:page\s*)?\d{1,4}(?:\s*(?:\/|of)\s*\d{1,4})?$/i;

const TOC_LINE_RE =
  /(?:\.{3,}|…{2,}|(?:\.\s){3,})\s*\d{1,4}\s*$/;

/**
 * Reconstructs ordered visual text lines from pdf.js text items.
 */
export function extractLinesFromTextItems(items: RawTextItem[]): string[] {
  const cleaned = items
    .filter((item) => typeof item.str === 'string' && item.str.length > 0)
    .map((item) => ({
      str: item.str,
      x: Number.isFinite(item.x) ? item.x : 0,
      y: Number.isFinite(item.y) ? item.y : 0,
      width: Number.isFinite(item.width) ? item.width! : 0,
      hasEOL: Boolean(item.hasEOL),
    }));

  if (cleaned.length === 0) return [];

  // Sort top-to-bottom (higher Y first in PDF coordinate space), then left-to-right.
  cleaned.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 2.5) return dy;
    return a.x - b.x;
  });

  const rows: Array<{ y: number; items: typeof cleaned }> = [];
  for (const item of cleaned) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow.y - item.y) <= 2.5) {
      lastRow.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let prevRight: number | null = null;
    for (const part of row.items) {
      const piece = part.str;
      if (line.length > 0 && prevRight !== null) {
        const gap = part.x - prevRight;
        const needsSpace =
          gap > 1.5 && !line.endsWith(' ') && !piece.startsWith(' ');
        if (needsSpace) {
          line += ' ';
        }
      }
      line += piece;
      prevRight = part.x + (part.width || piece.length * 4);
    }
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (normalized.length > 0) {
      lines.push(normalized);
    }
  }

  return lines;
}

/**
 * Strips repeated header/footer chrome (e.g., "Page 71", repeated doc title)
 * while preserving lines that look like question IDs.
 */
export function stripRepeatedHeadersFooters(pages: PageText[]): PageText[] {
  if (pages.length < 3) return pages;

  const topCounts = new Map<string, number>();
  const bottomCounts = new Map<string, number>();

  for (const page of pages) {
    const first = page.lines[0];
    const last = page.lines[page.lines.length - 1];
    if (first && first.length <= 100 && !ALPHA_NUM_ID_LINE_RE.test(first)) {
      const key = first.replace(/\d+/g, '#').trim().toLowerCase();
      topCounts.set(key, (topCounts.get(key) ?? 0) + 1);
    }
    if (last && last.length <= 100 && !ALPHA_NUM_ID_LINE_RE.test(last)) {
      const key = last.replace(/\d+/g, '#').trim().toLowerCase();
      bottomCounts.set(key, (bottomCounts.get(key) ?? 0) + 1);
    }
  }

  const repeatThreshold = Math.max(3, Math.floor(pages.length * 0.35));

  return pages.map((page) => {
    const filtered = page.lines.filter((line, idx) => {
      const isEdge = idx === 0 || idx === page.lines.length - 1;
      if (!isEdge) return true;
      if (PAGE_NUMBER_ONLY_RE.test(line)) return false;

      const key = line.replace(/\d+/g, '#').trim().toLowerCase();
      if (idx === 0 && (topCounts.get(key) ?? 0) >= repeatThreshold) return false;
      if (idx === page.lines.length - 1 && (bottomCounts.get(key) ?? 0) >= repeatThreshold) {
        return false;
      }
      return true;
    });

    return {
      pageNumber: page.pageNumber,
      lines: filtered,
      text: filtered.join('\n'),
    };
  });
}

interface CandidateMatch {
  id: string;
  prefix: string;
  num: number;
  rest: string;
  hasExplicitDelimiter: boolean;
}

function matchAlphaNumHeader(line: string): CandidateMatch | null {
  if (line.length > 260) return null;
  if (TOC_LINE_RE.test(line)) return null;

  const match = line.match(ALPHA_NUM_ID_LINE_RE);
  if (!match) return null;

  const rawId = match[1].toUpperCase();
  const rest = (match[2] ?? '').trim();

  // Reject pure years or overly long numeric parts if somehow matched
  const prefixMatch = rawId.match(/^([A-Z]{1,3})(\d{1,4})$/);
  if (!prefixMatch) return null;

  const prefix = prefixMatch[1];
  const num = Number(prefixMatch[2]);
  if (!Number.isFinite(num) || num <= 0) return null;

  // Reject lines that look like a TOC entry ending with spaces + page number when rest has no question punctuation and is super short with trailing number
  // e.g. "B3 What is Python 3" -> only treat as TOC if there's an explicit multi-dot leader (already handled by TOC_LINE_RE) or handled during deduplication.

  // Determine whether there was an explicit delimiter (., :, ), -, —, [, Question, Q.) or standalone ID
  const hasExplicitDelimiter =
    rest.length === 0 ||
    /^(?:[•\-–—*]\s*)?(?:(?:Question|Ques|Q)\.?\s*)?\[?[A-Z]{1,3}\d{1,4}\]?\s*[:.\)\-–—·|]/.test(
      line
    ) ||
    /^(?:[•\-–—*]\s*)?(?:Question|Ques|Q)\.?\s+/i.test(line);

  // If no explicit delimiter and rest starts with lowercase word (e.g., "S3 buckets are used to..."), it's prose, not a question header!
  if (!hasExplicitDelimiter && rest.length > 0 && /^[a-z]/.test(rest)) {
    return null;
  }

  return {
    id: rawId,
    prefix,
    num,
    rest,
    hasExplicitDelimiter,
  };
}

function splitQuestionAndAnswer(
  firstLineRest: string,
  bodyLines: string[]
): { question: string; answer: string } {
  const allLines = firstLineRest ? [firstLineRest, ...bodyLines] : [...bodyLines];
  if (allLines.length === 0) {
    return { question: '', answer: '' };
  }

  // 1. Look for explicit Answer: / Ans: / A: marker in the first 6 lines
  const maxMarkerSearch = Math.min(allLines.length, 6);
  for (let i = 0; i < maxMarkerSearch; i++) {
    const line = allLines[i];
    const markerMatch = line.match(EXPLICIT_ANSWER_MARKER_RE);
    if (markerMatch && i > 0) {
      const question = allLines.slice(0, i).join(' ').replace(/\s+/g, ' ').trim();
      const firstAnswerPart = markerMatch[1].trim();
      const remainingAnswer = allLines.slice(i + 1);
      const answerParts = firstAnswerPart ? [firstAnswerPart, ...remainingAnswer] : remainingAnswer;
      return {
        question,
        answer: joinParagraphLines(answerParts),
      };
    }

    // Also handle inline "What is X? Answer: Y" on the same line
    const inlineIdx = line.search(/\b(?:Answer|Ans)\s*:\s*/i);
    if (inlineIdx > 5) {
      const before = line.slice(0, inlineIdx).trim();
      const after = line.slice(inlineIdx).replace(/^(?:Answer|Ans)\s*:\s*/i, '').trim();
      const qLines = [...allLines.slice(0, i), before].filter(Boolean);
      const aLines = [after, ...allLines.slice(i + 1)].filter(Boolean);
      return {
        question: qLines.join(' ').replace(/\s+/g, ' ').trim(),
        answer: joinParagraphLines(aLines),
      };
    }
  }

  // 2. Look for a question mark within the first 4 lines
  const maxQMarkSearch = Math.min(allLines.length, 4);
  for (let i = 0; i < maxQMarkSearch; i++) {
    const line = allLines[i];
    const qIdx = line.lastIndexOf('?');
    if (qIdx !== -1) {
      const beforeMark = line.slice(0, qIdx + 1).trim();
      const afterMark = line.slice(qIdx + 1).replace(/^[:.\-–—\s]+/, '').trim();
      const qLines = [...allLines.slice(0, i), beforeMark].filter(Boolean);
      const aLines = [afterMark, ...allLines.slice(i + 1)].filter(Boolean);
      return {
        question: qLines.join(' ').replace(/\s+/g, ' ').trim(),
        answer: joinParagraphLines(aLines),
      };
    }
  }

  // 3. Fallback: first line is the question/topic, remaining lines are the answer
  return {
    question: allLines[0].trim(),
    answer: joinParagraphLines(allLines.slice(1)),
  };
}

function joinParagraphLines(lines: string[]): string {
  if (lines.length === 0) return '';
  let result = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!result) {
      result = line;
    } else if (result.endsWith('-') && /^[a-z]/.test(line)) {
      // Rejoin hyphenated line wrap
      result = result.slice(0, -1) + line;
    } else {
      result += ' ' + line;
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

function buildFullPassage(id: string, question: string, answer: string): string {
  const parts: string[] = [];
  if (question) {
    parts.push(`${id}. ${question}`);
  } else {
    parts.push(id);
  }
  if (answer) {
    parts.push(answer);
  }
  return parts.join('\n\n');
}

/**
 * Parses structured interview questions (e.g. B3, I88, A413) with full answers
 * and original start/end page numbers, including answers continuing onto subsequent pages.
 */
export function parseQuestionsFromPages(rawPages: PageText[]): IndexedQuestion[] {
  const pages = stripRepeatedHeadersFooters(rawPages);

  // Pass 1: discover prefix frequencies to separate genuine question series from tech acronyms
  const prefixNumbers = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines) {
      const candidate = matchAlphaNumHeader(line);
      if (!candidate) continue;
      const set = prefixNumbers.get(candidate.prefix) ?? new Set<number>();
      set.add(candidate.num);
      prefixNumbers.set(candidate.prefix, set);
    }
  }

  const totalUniqueAlphaIds = Array.from(prefixNumbers.values()).reduce(
    (sum, s) => sum + s.size,
    0
  );

  const isAcceptedAlphaCandidate = (c: CandidateMatch): boolean => {
    const prefixCount = prefixNumbers.get(c.prefix)?.size ?? 0;

    // Protect known tech acronyms unless that prefix is clearly a real series in this PDF
    if (KNOWN_ACRONYM_IDS.has(c.id) && prefixCount < 4) {
      return false;
    }

    // If the document has a strong alphanumeric series (>= 8 IDs), require either
    // a prefix seen >= 2 times OR an explicit delimiter with a non-empty question/standalone line
    if (totalUniqueAlphaIds >= 8) {
      if (prefixCount >= 2) return true;
      return c.hasExplicitDelimiter && (c.rest.endsWith('?') || c.rest.length === 0);
    }

    return true;
  };

  interface WorkingEntry {
    id: string;
    firstLineRest: string;
    bodyLines: string[];
    pageStart: number;
    pageEnd: number;
  }

  const entries: WorkingEntry[] = [];
  let current: WorkingEntry | null = null;

  const useNumericFallback = totalUniqueAlphaIds < 2;

  for (const page of pages) {
    for (const line of page.lines) {
      if (!useNumericFallback) {
        const candidate = matchAlphaNumHeader(line);
        if (candidate && isAcceptedAlphaCandidate(candidate)) {
          if (current) {
            entries.push(current);
          }
          current = {
            id: candidate.id,
            firstLineRest: candidate.rest,
            bodyLines: [],
            pageStart: page.pageNumber,
            pageEnd: page.pageNumber,
          };
          continue;
        }
      } else {
        const numMatch = !TOC_LINE_RE.test(line) ? line.match(NUMERIC_Q_LINE_RE) : null;
        if (numMatch) {
          if (current) {
            entries.push(current);
          }
          current = {
            id: `Q${numMatch[1]}`,
            firstLineRest: numMatch[2].trim(),
            bodyLines: [],
            pageStart: page.pageNumber,
            pageEnd: page.pageNumber,
          };
          continue;
        }
      }

      if (current) {
        current.bodyLines.push(line);
        current.pageEnd = page.pageNumber;
      }
    }
  }

  if (current) {
    entries.push(current);
  }

  // Convert working entries into IndexedQuestion objects and deduplicate (preferring real Q&A over TOC stubs)
  const deduped = new Map<string, IndexedQuestion>();
  const orderedIds: string[] = [];

  for (const entry of entries) {
    const { question, answer } = splitQuestionAndAnswer(entry.firstLineRest, entry.bodyLines);
    if (!question && !answer) continue;

    const normalizedId = entry.id.toUpperCase();
    const candidateItem: IndexedQuestion = {
      id: entry.id,
      normalizedId,
      question: question || `Question ${entry.id}`,
      answer,
      fullPassage: buildFullPassage(entry.id, question, answer),
      pageStart: entry.pageStart,
      pageEnd: entry.pageEnd,
    };

    const existing = deduped.get(normalizedId);
    if (!existing) {
      deduped.set(normalizedId, candidateItem);
      orderedIds.push(normalizedId);
    } else {
      // Replace earlier stub (e.g. from a Table of Contents) if the new occurrence has a richer answer
      const existingRichness = existing.answer.length + (existing.question.includes('?') ? 20 : 0);
      const newRichness = candidateItem.answer.length + (candidateItem.question.includes('?') ? 20 : 0);
      if (newRichness > existingRichness) {
        deduped.set(normalizedId, candidateItem);
      }
    }
  }

  return orderedIds
    .map((key, idx) => ({ item: deduped.get(key)!, idx }))
    .filter(({ item }) => item.question.length > 0 || item.answer.length > 0)
    .sort((a, b) => (a.item.pageStart !== b.item.pageStart ? a.item.pageStart - b.item.pageStart : a.idx - b.idx))
    .map(({ item }) => item);
}
