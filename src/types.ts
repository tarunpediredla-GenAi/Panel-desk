export interface PageText {
  pageNumber: number;
  lines: string[];
  text: string;
}

export interface IndexedQuestion {
  id: string;
  normalizedId: string;
  question: string;
  answer: string;
  fullPassage: string;
  pageStart: number;
  pageEnd: number;
}

export interface PdfIndex {
  fileName: string;
  fileSize: number;
  pageCount: number;
  indexedAt: number;
  questions: IndexedQuestion[];
  pages: PageText[];
}

export interface Citation {
  questionId: string;
  pageStart: number;
  pageEnd: number;
  question: string;
  originalPassage: string;
}

export type InputMode = 'voice' | 'text';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  inputMode?: InputMode;
  citation?: Citation | null;
  isMissing?: boolean;
  isFollowUp?: boolean;
  isError?: boolean;
  timestamp: number;
}

export interface AnswerCandidatePayload {
  id: string;
  pageStart: number;
  pageEnd: number;
  question: string;
  answer: string;
}

export interface AnswerApiRequest {
  query: string;
  mode: 'simplify' | 'search' | 'followup';
  candidates: AnswerCandidatePayload[];
  activeQuestion?: AnswerCandidatePayload | null;
  recentTurns?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface AnswerApiResponse {
  found: boolean;
  matchedId: string | null;
  answer: string;
}
