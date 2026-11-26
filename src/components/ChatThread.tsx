import { useEffect, useRef } from 'react';
import { BookOpen, FileText, Loader2, Mic, Square, Upload, Volume2 } from 'lucide-react';
import type { ChatMessage, Citation, IndexedQuestion, PdfIndex } from '../types';
import { formatCitationLabel } from '../utils/searchIndex';

interface ChatThreadProps {
  pdfIndex: PdfIndex | null;
  isIndexing: boolean;
  indexProgress: { current: number; total: number } | null;
  uploadError: string | null;
  messages: ChatMessage[];
  isThinking: boolean;
  speakingMessageId: string | null;
  ttsSupported: boolean;
  onTriggerUpload: () => void;
  onSelectSuggestion: (text: string) => void;
  onOpenCitation: (citation: Citation) => void;
  onReadAloud: (text: string, messageId: string) => void;
  onStopSpeaking: () => void;
}

function pickSamplePrompts(questions: IndexedQuestion[]): Array<{ label: string; query: string }> {
  if (questions.length === 0) return [];
  const samples: Array<{ label: string; query: string }> = [];

  // Prefer showing an early ID lookup and a real full question from their PDF
  const first = questions[0];
  if (first) {
    samples.push({
      label: `Look up ${first.id}`,
      query: first.id,
    });
  }

  const mid = questions[Math.min(Math.floor(questions.length / 2), questions.length - 1)];
  if (mid && mid.id !== first?.id && mid.question.length >= 12) {
    const truncated = mid.question.length > 72 ? mid.question.slice(0, 69) + '…' : mid.question;
    samples.push({
      label: truncated,
      query: mid.question,
    });
  } else if (first && first.question.length >= 12) {
    const truncated = first.question.length > 72 ? first.question.slice(0, 69) + '…' : first.question;
    samples.push({
      label: truncated,
      query: first.question,
    });
  }

  return samples;
}

export function ChatThread({
  pdfIndex,
  isIndexing,
  indexProgress,
  uploadError,
  messages,
  isThinking,
  speakingMessageId,
  ttsSupported,
  onTriggerUpload,
  onSelectSuggestion,
  onOpenCitation,
  onReadAloud,
  onStopSpeaking,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isThinking]);

  const progressPct =
    indexProgress && indexProgress.total > 0
      ? Math.round((indexProgress.current / indexProgress.total) * 100)
      : 0;

  return (
    <div
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
      role="log"
      aria-live="polite"
      aria-label="Interview Q&A transcript"
    >
      <div className="max-w-3xl mx-auto w-full space-y-6">
        {/* Upload error banner */}
        {uploadError && (
          <div
            role="alert"
            className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800"
          >
            {uploadError}
          </div>
        )}

        {/* Indexing progress view */}
        {isIndexing && (
          <section
            aria-label="Reading interview PDF"
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8"
          >
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-2.5 text-slate-900 font-medium text-sm sm:text-base">
                <Loader2 className="w-4 h-4 animate-spin text-blue-700" aria-hidden="true" />
                <span>Reading your interview PDF privately in this browser…</span>
              </div>
              <span className="font-mono tabular-nums text-xs sm:text-sm text-slate-600 shrink-0">
                {progressPct}%
              </span>
            </div>

            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-700 transition-all duration-150"
                style={{ width: `${Math.max(4, progressPct)}%` }}
              />
            </div>

            <p className="mt-3 text-xs sm:text-sm text-slate-500 font-mono tabular-nums">
              {indexProgress
                ? `Reading page ${indexProgress.current} of ${indexProgress.total}`
                : 'Opening document…'}
            </p>
          </section>
        )}

        {/* Empty State: No PDF uploaded yet */}
        {!pdfIndex && !isIndexing && (
          <section className="py-10 sm:py-16">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Ask your interview PDF by voice or text.
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
                Upload your interview question guide to get short, spoken-English answers in seconds—with clickable citations that jump straight to the exact PDF page.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={onTriggerUpload}
                  className="h-12 px-5 inline-flex items-center gap-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Upload interview PDF</span>
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm text-slate-600">
                <div>
                  <p className="font-semibold text-slate-900">Private to your browser</p>
                  <p className="mt-1 text-slate-500">
                    Your PDF is indexed locally and reused across every question.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Speak or type naturally</p>
                  <p className="mt-1 text-slate-500">
                    Ask by ID like B3 or I88, ask in your own words, or request an example.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Grounded with page citations</p>
                  <p className="mt-1 text-slate-500">
                    Tap any citation to inspect the original PDF page and full passage.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Ready State: PDF indexed, awaiting first question */}
        {pdfIndex && !isIndexing && messages.length === 0 && (
          <section
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8"
            data-testid="pdf-ready-card"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
                  {pdfIndex.questions.length > 0
                    ? `${pdfIndex.questions.length} ${pdfIndex.questions.length === 1 ? 'question' : 'questions'} ready from your PDF`
                    : 'PDF loaded'}
                </h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate max-w-full text-slate-700 font-medium">
                    {pdfIndex.fileName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {pdfIndex.pageCount} {pdfIndex.pageCount === 1 ? 'page' : 'pages'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Index ready</span>
                </p>
              </div>
            </div>

            {pdfIndex.questions.length === 0 ? (
              <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                No numbered question IDs (such as B3, I88, or A413) were detected in this PDF’s text layer. Make sure the PDF contains selectable text rather than scanned images.
              </p>
            ) : (
              <>
                <p className="mt-4 text-sm text-slate-600 leading-relaxed flex items-center gap-2">
                  <Mic className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                  <span>
                    Tap the microphone below to ask aloud, or type a question or ID.
                  </span>
                </p>

                {pickSamplePrompts(pdfIndex.questions).length > 0 && (
                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <p className="text-xs font-medium text-slate-500 mb-2.5">
                      Try from your PDF
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {pickSamplePrompts(pdfIndex.questions).map((sample) => (
                        <button
                          key={sample.query}
                          type="button"
                          onClick={() => onSelectSuggestion(sample.query)}
                          className="text-left px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs sm:text-sm text-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                        >
                          {sample.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Mobile PDF summary line when chatting */}
        {pdfIndex && !isIndexing && messages.length > 0 && (
          <div className="md:hidden flex items-center gap-2 text-xs text-slate-500 pb-1 border-b border-slate-200/70">
            <span className="truncate font-medium text-slate-700">{pdfIndex.fileName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
              {pdfIndex.questions.length} Qs
            </span>
          </div>
        )}

        {/* Chat Messages */}
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl bg-slate-900 text-white px-4 py-3">
                  <p className="text-sm sm:text-[15px] leading-relaxed">{msg.text}</p>
                  {msg.inputMode === 'voice' && (
                    <p className="mt-1 text-[11px] text-slate-300">Asked by voice</p>
                  )}
                </div>
              </div>
            );
          }

          const isThisSpeaking = speakingMessageId === msg.id;

          return (
            <article
              key={msg.id}
              className="bg-white border border-slate-200 rounded-2xl px-5 py-4 sm:px-6 sm:py-5"
              data-testid="assistant-message"
            >
              <p
                className={`text-[15px] sm:text-base leading-[1.65] ${
                  msg.isError
                    ? 'text-red-700'
                    : msg.isMissing
                      ? 'text-slate-600'
                      : 'text-slate-900'
                }`}
              >
                {msg.text}
              </p>

              {/* Action row: clickable citation + Read aloud / Stop */}
              {!msg.isError && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {msg.citation ? (
                      <button
                        type="button"
                        onClick={() => onOpenCitation(msg.citation!)}
                        aria-label={`Open ${msg.citation.questionId} on Page ${msg.citation.pageStart} in PDF viewer`}
                        className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 text-blue-800 text-xs sm:text-sm font-medium font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {formatCitationLabel(
                            msg.citation.questionId,
                            msg.citation.pageStart,
                            msg.citation.pageEnd
                          )}
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">No matching page in PDF</span>
                    )}
                  </div>

                  {ttsSupported && (
                    <div className="flex items-center gap-2 shrink-0">
                      {isThisSpeaking ? (
                        <button
                          type="button"
                          onClick={onStopSpeaking}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                        >
                          <Square className="w-3.5 h-3.5 fill-current shrink-0" aria-hidden="true" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onReadAloud(msg.text, msg.id)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                        >
                          <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Read aloud</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {/* Pending answer indicator */}
        {isThinking && (
          <div
            className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center gap-2.5 text-sm text-slate-600"
            aria-label="Finding answer in your PDF"
          >
            <Loader2 className="w-4 h-4 animate-spin text-blue-700 shrink-0" aria-hidden="true" />
            <span>Checking your PDF…</span>
          </div>
        )}

        <div ref={bottomRef} className="h-2" />
      </div>
    </div>
  );
}
