import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MISSING_ANSWER_TEXT = "I couldn’t find that answer in your PDF.";

interface CandidateInput {
  id: string;
  pageStart: number;
  pageEnd: number;
  question: string;
  answer: string;
}

interface TurnInput {
  role: 'user' | 'assistant';
  text: string;
}

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeCandidate(raw: unknown): CandidateInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = sanitizeText(obj.id, 32);
  const question = sanitizeText(obj.question, 600);
  const answer = sanitizeText(obj.answer, 4000);
  const pageStart = Number(obj.pageStart);
  const pageEnd = Number(obj.pageEnd);
  if (!id || (!question && !answer) || !Number.isInteger(pageStart) || pageStart < 1) {
    return null;
  }
  return {
    id,
    pageStart,
    pageEnd: Number.isInteger(pageEnd) && pageEnd >= pageStart ? pageEnd : pageStart,
    question,
    answer,
  };
}

function buildSystemInstruction(mode: 'simplify' | 'search' | 'followup'): string {
  const baseRules = [
    'You are PanelDesk, a real-time interview preparation coach answering strictly from passages extracted from the user’s private interview PDF.',
    'Style rules:',
    '- Reply in 2 to 3 short, natural sentences in simple spoken English that the user can say verbatim in a live job interview.',
    '- Do NOT use markdown, bullet points, numbered lists, code blocks, or phrases like "According to the PDF" or "Based on passage I88". Just speak the interview answer directly and clearly.',
    '- Stay strictly grounded in the provided PDF passages. Never invent facts, dates, schedules, policies, or topics that are not supported by the provided passages.',
    `- If the provided PDF passages do NOT answer the user's question, you MUST set found=false, matchedId=null, and answer="${MISSING_ANSWER_TEXT}".`,
  ];

  if (mode === 'simplify') {
    baseRules.push(
      'Task: The user asked about a specific matched question from their PDF. Distill its PDF answer into 2 to 3 short, crystal-clear spoken-English sentences ready to say aloud in an interview, faithful to the PDF passage. Set found=true and matchedId to the candidate id.'
    );
  } else if (mode === 'followup') {
    baseRules.push(
      'Task: The user asked a follow-up (such as "Give me an example", "Explain that simply", or "Why?") about the active interview question from their PDF.',
      '- Answer in 2 to 3 short, natural spoken-English sentences grounded directly in the active PDF passage and its concepts.',
      '- If the user asks for an example of a concept explained in the active passage, give a brief concrete example illustrating that exact concept from the passage.',
      '- If the user actually changed the topic to something completely unrelated to the active passage and not covered by any provided candidate passage, set found=false, matchedId=null, and answer to the missing-answer message.'
    );
  } else {
    baseRules.push(
      'Task: Check whether any of the provided PDF candidate passages directly answers the user’s interview question (including paraphrases or slightly different wording).',
      '- If one candidate genuinely answers the question, set found=true, set matchedId to that exact candidate id, and write the answer in 2 to 3 short spoken-English sentences strictly grounded in that passage.',
      '- Be strict about relevance: if the user asks about something absent from the passages (such as a holiday calendar, unrelated company policy, or a topic none of the passages address), even if a single generic word overlaps, you MUST set found=false, matchedId=null, and answer to the exact missing-answer message.'
    );
  }

  return baseRules.join('\n');
}

function buildUserPrompt(
  query: string,
  mode: 'simplify' | 'search' | 'followup',
  candidates: CandidateInput[],
  activeQuestion: CandidateInput | null,
  recentTurns: TurnInput[]
): string {
  const sections: string[] = [];

  if (activeQuestion) {
    sections.push(
      [
        'ACTIVE PDF QUESTION IN DISCUSSION:',
        `ID: ${activeQuestion.id} (Page ${activeQuestion.pageStart}${activeQuestion.pageEnd > activeQuestion.pageStart ? `-${activeQuestion.pageEnd}` : ''})`,
        `Question: ${activeQuestion.question}`,
        `PDF Answer: ${activeQuestion.answer}`,
      ].join('\n')
    );
  }

  if (recentTurns.length > 0 && mode === 'followup') {
    sections.push(
      'RECENT CONVERSATION:\n' +
        recentTurns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n')
    );
  }

  if (candidates.length > 0) {
    const formattedCandidates = candidates
      .map((c) => {
        const pageLabel = c.pageEnd > c.pageStart ? `Pages ${c.pageStart}-${c.pageEnd}` : `Page ${c.pageStart}`;
        return `[ID: ${c.id} | ${pageLabel}]\nQuestion: ${c.question}\nPDF Answer: ${c.answer}`;
      })
      .join('\n\n---\n\n');
    sections.push(`PDF CANDIDATE PASSAGES:\n${formattedCandidates}`);
  }

  sections.push(`USER QUESTION:\n${query}`);
  return sections.join('\n\n');
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

async function generateGroundedAnswerWithRetry(
  ai: GoogleGenAI,
  systemInstruction: string,
  contents: string
): Promise<{ found: boolean; matchedId: string | null; answer: string }> {
  const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel; delayBeforeMs: number }> = [
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 0 },
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 900 },
  ];

  let lastError: unknown;

  for (const plan of attempts) {
    if (plan.delayBeforeMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, plan.delayBeforeMs));
    }

    try {
      const response = await ai.models.generateContent({
        model: plan.model,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: plan.thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              found: {
                type: Type.BOOLEAN,
                description: 'True only if the provided PDF passages actually answer the user question.',
              },
              matchedId: {
                type: Type.STRING,
                description: 'The exact ID of the matched PDF passage (e.g. I88 or B3), or empty string if not found.',
              },
              answer: {
                type: Type.STRING,
                description:
                  '2 to 3 short spoken-English sentences grounded in the matched PDF passage, or the exact missing-answer message when found is false.',
              },
            },
            required: ['found', 'matchedId', 'answer'],
          },
        },
      });

      const rawText = extractJsonText(response.text ?? '');
      const parsed = JSON.parse(rawText) as {
        found?: boolean;
        matchedId?: string | null;
        answer?: string;
      };

      const found = Boolean(parsed.found);
      if (!found) {
        return {
          found: false,
          matchedId: null,
          answer: MISSING_ANSWER_TEXT,
        };
      }

      const answer =
        typeof parsed.answer === 'string' && parsed.answer.trim()
          ? parsed.answer.trim()
          : MISSING_ANSWER_TEXT;
      const matchedId =
        typeof parsed.matchedId === 'string' && parsed.matchedId.trim()
          ? parsed.matchedId.trim()
          : null;

      return {
        found: answer !== MISSING_ANSWER_TEXT,
        matchedId: answer !== MISSING_ANSWER_TEXT ? matchedId : null,
        answer,
      };
    } catch (error) {
      lastError = error;
      const errObj = error as { status?: number; message?: string };
      const status = typeof errObj?.status === 'number' ? errObj.status : 0;
      // Do not retry auth or quota errors
      if (status === 400 || status === 401 || status === 403 || status === 429) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/answer', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid request body.' });
        return;
      }

      const query = sanitizeText(body.query, 600);
      const rawMode = body.mode;
      const mode: 'simplify' | 'search' | 'followup' =
        rawMode === 'simplify' || rawMode === 'followup' ? rawMode : 'search';

      if (!query) {
        res.status(400).json({ error: 'A question is required.' });
        return;
      }

      const rawCandidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 8) : [];
      const candidates = rawCandidates
        .map(sanitizeCandidate)
        .filter((c): c is CandidateInput => c !== null);

      const activeQuestion = sanitizeCandidate(body.activeQuestion);

      const rawTurns = Array.isArray(body.recentTurns) ? body.recentTurns.slice(-6) : [];
      const recentTurns: TurnInput[] = rawTurns
        .map((t): TurnInput | null => {
          if (!t || typeof t !== 'object') return null;
          const obj = t as Record<string, unknown>;
          const role = obj.role === 'user' || obj.role === 'assistant' ? obj.role : null;
          const text = sanitizeText(obj.text, 600);
          return role && text ? { role, text } : null;
        })
        .filter((t): t is TurnInput => t !== null);

      if (candidates.length === 0 && !activeQuestion) {
        res.json({
          found: false,
          matchedId: null,
          answer: MISSING_ANSWER_TEXT,
        });
        return;
      }

      const ai = getAiClient();
      const systemInstruction = buildSystemInstruction(mode);
      const userPrompt = buildUserPrompt(query, mode, candidates, activeQuestion, recentTurns);

      const result = await generateGroundedAnswerWithRetry(ai, systemInstruction, userPrompt);

      // Verify returned matchedId actually exists among the provided candidates or activeQuestion
      const validIds = new Map<string, string>();
      for (const c of candidates) {
        validIds.set(c.id.toUpperCase(), c.id);
      }
      if (activeQuestion) {
        validIds.set(activeQuestion.id.toUpperCase(), activeQuestion.id);
      }

      if (result.found) {
        const verifiedId = result.matchedId ? validIds.get(result.matchedId.toUpperCase()) ?? null : null;
        const fallbackId =
          mode === 'followup' && activeQuestion
            ? activeQuestion.id
            : mode === 'simplify' && candidates[0]
              ? candidates[0].id
              : null;
        const finalId = verifiedId ?? fallbackId;

        if (!finalId) {
          res.json({
            found: false,
            matchedId: null,
            answer: MISSING_ANSWER_TEXT,
          });
          return;
        }

        res.json({
          found: true,
          matchedId: finalId,
          answer: result.answer,
        });
        return;
      }

      res.json(result);
    } catch (error: unknown) {
      const errObj = error as { status?: number; message?: string };
      const status = typeof errObj?.status === 'number' ? errObj.status : 0;
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'GEMINI_API_KEY_MISSING') {
        res.status(503).json({
          error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }
      if (
        status === 403 ||
        message.includes('PERMISSION_DENIED') ||
        message.includes('API_KEY_INVALID')
      ) {
        res.status(502).json({
          error: 'Gemini API authentication failed. Please check GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }
      if (status === 429 || message.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'Gemini API rate limit reached. Please wait a moment and try again.',
        });
        return;
      }
      console.error('Error in /api/answer:', status || 'unknown', message.slice(0, 300));
      res.status(500).json({
        error: 'Unable to process the answer right now. Please try again.',
        code: status || 'SERVER_ERROR',
      });
    }
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PanelDesk server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PanelDesk server:', err);
  process.exit(1);
});
