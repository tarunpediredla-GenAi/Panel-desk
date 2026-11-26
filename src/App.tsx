import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { TopBar } from './components/TopBar';
import { ChatThread } from './components/ChatThread';
import { ComposerBar } from './components/ComposerBar';
import { PdfViewerDrawer } from './components/PdfViewerDrawer';
import { useVoiceController } from './hooks/useVoiceController';
import type {
  AnswerApiRequest,
  AnswerApiResponse,
  AnswerCandidatePayload,
  ChatMessage,
  Citation,
  IndexedQuestion,
  InputMode,
  PdfIndex,
} from './types';
import {
  clearPrivatePdfCache,
  loadPdfDocumentFromBuffer,
  loadPrivatePdfCache,
  parseAndIndexPdfFile,
  savePrivatePdfCache,
} from './utils/pdfClient';
import {
  buildSearchEngine,
  extractDirectSpokenAnswer,
  isFollowUpQuery,
  MISSING_ANSWER_TEXT,
  searchPdfIndex,
} from './utils/searchIndex';

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toCandidatePayload(q: IndexedQuestion): AnswerCandidatePayload {
  return {
    id: q.id,
    pageStart: q.pageStart,
    pageEnd: q.pageEnd,
    question: q.question,
    answer: q.answer,
  };
}

function toCitation(q: IndexedQuestion): Citation {
  return {
    questionId: q.id,
    pageStart: q.pageStart,
    pageEnd: q.pageEnd,
    question: q.question,
    originalPassage: q.fullPassage,
  };
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pdfIndex, setPdfIndex] = useState<PdfIndex | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<IndexedQuestion | null>(null);

  // PDF viewer remains closed until the user clicks a citation
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerCitation, setViewerCitation] = useState<Citation | null>(null);
  const [viewerPage, setViewerPage] = useState(1);

  const searchEngine = useMemo(
    () => (pdfIndex ? buildSearchEngine(pdfIndex) : null),
    [pdfIndex]
  );

  // Refs for latest state inside voice callback
  const searchEngineRef = useRef(searchEngine);
  searchEngineRef.current = searchEngine;
  const activeQuestionRef = useRef(activeQuestion);
  activeQuestionRef.current = activeQuestion;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const isThinkingRef = useRef(isThinking);
  isThinkingRef.current = isThinking;

  // Restore privately cached PDF index from browser IndexedDB on mount
  useEffect(() => {
    let active = true;
    loadPrivatePdfCache()
      .then(async (cached) => {
        if (!active || !cached) return;
        const doc = await loadPdfDocumentFromBuffer(cached.buffer);
        if (!active) {
          void doc.cleanup();
          return;
        }
        setPdfIndex(cached.index);
        setPdfDoc(doc);
      })
      .catch(() => {
        // Ignore cache restore failure; user can upload normally
      });

    return () => {
      active = false;
    };
  }, []);

  // Cleanup PDFDocumentProxy when replaced or unmounted
  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.cleanup();
      }
    };
  }, [pdfDoc]);

  const askQuestionRef = useRef<(rawQuery: string, inputMode: InputMode) => Promise<void>>(
    async () => {}
  );

  const handleVoiceTranscript = useCallback((transcript: string) => {
    const cleaned = transcript.trim();
    if (!cleaned) return;
    void askQuestionRef.current(cleaned, 'voice');
  }, []);

  const voice = useVoiceController(handleVoiceTranscript);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const callAnswerApi = useCallback(async (payload: AnswerApiRequest): Promise<AnswerApiResponse> => {
    const response = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as Partial<AnswerApiResponse> & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || 'Unable to generate an answer right now.');
    }

    return {
      found: Boolean(data.found),
      matchedId: typeof data.matchedId === 'string' ? data.matchedId : null,
      answer: typeof data.answer === 'string' && data.answer.trim() ? data.answer.trim() : MISSING_ANSWER_TEXT,
    };
  }, []);

  const askQuestion = useCallback(
    async (rawQuery: string, inputMode: InputMode) => {
      const query = rawQuery.trim();
      const engine = searchEngineRef.current;
      if (!query || !engine || isThinkingRef.current) return;

      // Stop any ongoing speech before answering a new question
      voiceRef.current.stopSpeaking();

      const userMsg: ChatMessage = {
        id: createMessageId(),
        role: 'user',
        text: query,
        inputMode,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsThinking(true);

      const deliverAssistantMessage = (
        text: string,
        citation: Citation | null,
        options?: { isMissing?: boolean; isFollowUp?: boolean; isError?: boolean }
      ) => {
        const assistantId = createMessageId();
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          text,
          citation,
          isMissing: options?.isMissing,
          isFollowUp: options?.isFollowUp,
          isError: options?.isError,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setIsThinking(false);

        // Spoken questions read the answer aloud by default (mic capture is paused while speaking)
        if (inputMode === 'voice' && !options?.isError) {
          voiceRef.current.speakText(text, assistantId);
        }
      };

      try {
        const currentActive = activeQuestionRef.current;
        const searchResult = searchPdfIndex(engine, query, 6);

        // 1. Follow-up question anchored to the active PDF question in discussion
        if (
          searchResult.matchType !== 'exact_id' &&
          isFollowUpQuery(query, Boolean(currentActive)) &&
          currentActive
        ) {
          const recentTurns = messagesRef.current.slice(-4).map((m) => ({
            role: m.role,
            text: m.text,
          }));

          const apiRes = await callAnswerApi({
            query,
            mode: 'followup',
            candidates: [toCandidatePayload(currentActive)],
            activeQuestion: toCandidatePayload(currentActive),
            recentTurns,
          });

          if (!apiRes.found) {
            deliverAssistantMessage(MISSING_ANSWER_TEXT, null, { isMissing: true });
            return;
          }

          const matched =
            (apiRes.matchedId ? engine.idMap.get(apiRes.matchedId.toUpperCase()) : null) ??
            currentActive;

          setActiveQuestion(matched);
          deliverAssistantMessage(apiRes.answer, toCitation(matched), { isFollowUp: true });
          return;
        }

        // 2. Exact ID lookup ("B3", "I88", "A413") or strong direct question match
        if (
          (searchResult.matchType === 'exact_id' || searchResult.matchType === 'strong_match') &&
          searchResult.exactMatch
        ) {
          const matched = searchResult.exactMatch;
          setActiveQuestion(matched);

          // Fast path: return 2-3 clean spoken sentences directly from the index when passage is plain prose
          const directSpoken = extractDirectSpokenAnswer(matched.answer);
          if (directSpoken) {
            deliverAssistantMessage(directSpoken, toCitation(matched));
            return;
          }

          // Otherwise simplify verbose or code-heavy PDF passages via Gemini into 2-3 short interview sentences
          const apiRes = await callAnswerApi({
            query:
              searchResult.matchType === 'exact_id'
                ? matched.question || query
                : query,
            mode: 'simplify',
            candidates: [toCandidatePayload(matched)],
            activeQuestion: null,
          });

          if (!apiRes.found) {
            deliverAssistantMessage(MISSING_ANSWER_TEXT, null, { isMissing: true });
            return;
          }

          deliverAssistantMessage(apiRes.answer, toCitation(matched));
          return;
        }

        // 3. No lexical overlap anywhere in the PDF -> fast missing-answer response
        if (searchResult.matchType === 'none' || searchResult.candidates.length === 0) {
          deliverAssistantMessage(MISSING_ANSWER_TEXT, null, { isMissing: true });
          return;
        }

        // 4. Candidate shortlist -> use Gemini to handle paraphrases while enforcing strict PDF grounding
        const candidatePayloads = searchResult.candidates.map((c) => toCandidatePayload(c.item));
        const apiRes = await callAnswerApi({
          query,
          mode: 'search',
          candidates: candidatePayloads,
          activeQuestion: currentActive ? toCandidatePayload(currentActive) : null,
        });

        if (!apiRes.found || !apiRes.matchedId) {
          deliverAssistantMessage(MISSING_ANSWER_TEXT, null, { isMissing: true });
          return;
        }

        const matched = engine.idMap.get(apiRes.matchedId.toUpperCase());
        if (!matched) {
          deliverAssistantMessage(MISSING_ANSWER_TEXT, null, { isMissing: true });
          return;
        }

        setActiveQuestion(matched);
        deliverAssistantMessage(apiRes.answer, toCitation(matched));
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Something went wrong while answering your question.';
        deliverAssistantMessage(message, null, { isError: true });
      }
    },
    [callAnswerApi]
  );

  askQuestionRef.current = askQuestion;

  const handleTriggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so selecting the same file again still triggers onChange
    e.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Please choose a valid PDF file.');
      return;
    }

    voiceRef.current.stopSpeaking();
    voiceRef.current.cancelListening();
    setUploadError(null);
    setIsIndexing(true);
    setIndexProgress({ current: 0, total: 0 });
    setViewerOpen(false);
    setViewerCitation(null);

    try {
      const { index, pdfDoc: newDoc, buffer } = await parseAndIndexPdfFile(
        file,
        (current, total) => {
          setIndexProgress({ current, total });
        }
      );

      setPdfIndex(index);
      setPdfDoc(newDoc);
      setMessages([]);
      setActiveQuestion(null);
      setInputValue('');
      setIndexProgress(null);
      setIsIndexing(false);

      // Save privately in browser-local IndexedDB for reuse across reloads
      void savePrivatePdfCache(index, buffer);
    } catch (err: unknown) {
      const reason =
        err instanceof Error && err.message
          ? `Could not read this PDF (${err.message}).`
          : 'Could not read this PDF file. Please make sure it is an unlocked PDF.';
      setUploadError(reason);
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, []);

  const handleClearPdf = useCallback(() => {
    voiceRef.current.stopSpeaking();
    voiceRef.current.cancelListening();
    setPdfIndex(null);
    setPdfDoc(null);
    setMessages([]);
    setActiveQuestion(null);
    setInputValue('');
    setViewerOpen(false);
    setViewerCitation(null);
    setUploadError(null);
    void clearPrivatePdfCache();
  }, []);

  const handleSubmitText = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    setInputValue('');
    void askQuestion(text, 'text');
  }, [askQuestion, inputValue]);

  const handleSelectSuggestion = useCallback(
    (text: string) => {
      void askQuestion(text, 'text');
    },
    [askQuestion]
  );

  const handleMicToggle = useCallback(() => {
    if (voice.isListening) {
      voice.stopListening();
    } else {
      voice.startListening();
    }
  }, [voice]);

  const handleOpenCitation = useCallback((citation: Citation) => {
    setViewerCitation(citation);
    setViewerPage(citation.pageStart);
    setViewerOpen(true);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerOpen(false);
  }, []);

  return (
    <div className="h-dvh w-full flex flex-col bg-[#F8F9FA] text-[#0F172A] overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload interview PDF file"
        onChange={handleFileChange}
        className="sr-only"
      />

      <TopBar
        pdfIndex={pdfIndex}
        isIndexing={isIndexing}
        onTriggerUpload={handleTriggerUpload}
        onClearPdf={handleClearPdf}
      />

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Primary ask-and-answer column */}
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <ChatThread
            pdfIndex={pdfIndex}
            isIndexing={isIndexing}
            indexProgress={indexProgress}
            uploadError={uploadError}
            messages={messages}
            isThinking={isThinking}
            speakingMessageId={voice.speakingMessageId}
            ttsSupported={voice.ttsSupported}
            onTriggerUpload={handleTriggerUpload}
            onSelectSuggestion={handleSelectSuggestion}
            onOpenCitation={handleOpenCitation}
            onReadAloud={voice.speakText}
            onStopSpeaking={voice.stopSpeaking}
          />

          <ComposerBar
            hasPdf={Boolean(pdfIndex)}
            isIndexing={isIndexing}
            isThinking={isThinking}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onSubmitText={handleSubmitText}
            isListening={voice.isListening}
            interimTranscript={voice.interimTranscript}
            micSupported={voice.micSupported}
            micError={voice.micError}
            onDismissMicError={voice.dismissMicError}
            onMicToggle={handleMicToggle}
            onCancelListening={voice.cancelListening}
            isSpeaking={voice.isSpeaking}
            onStopSpeaking={voice.stopSpeaking}
          />
        </section>

        {/* Source PDF viewer — closed until the user clicks a citation */}
        <PdfViewerDrawer
          isOpen={viewerOpen && Boolean(pdfDoc)}
          pdfDoc={pdfDoc}
          totalPages={pdfIndex?.pageCount ?? 0}
          citation={viewerCitation}
          currentPage={viewerPage}
          onChangePage={setViewerPage}
          onClose={handleCloseViewer}
        />
      </main>
    </div>
  );
}
