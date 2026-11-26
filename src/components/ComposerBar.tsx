import { type FormEvent, type KeyboardEvent } from 'react';
import { Mic, MicOff, Send, Square, Volume2, X } from 'lucide-react';

interface ComposerBarProps {
  hasPdf: boolean;
  isIndexing: boolean;
  isThinking: boolean;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmitText: () => void;
  isListening: boolean;
  interimTranscript: string;
  micSupported: boolean;
  micError: string | null;
  onDismissMicError: () => void;
  onMicToggle: () => void;
  onCancelListening: () => void;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
}

export function ComposerBar({
  hasPdf,
  isIndexing,
  isThinking,
  inputValue,
  onInputChange,
  onSubmitText,
  isListening,
  interimTranscript,
  micSupported,
  micError,
  onDismissMicError,
  onMicToggle,
  onCancelListening,
  isSpeaking,
  onStopSpeaking,
}: ComposerBarProps) {
  const canAsk = hasPdf && !isIndexing;
  const canSend = canAsk && !isThinking && inputValue.trim().length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    onSubmitText();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSubmitText();
      }
    }
  };

  return (
    <div className="shrink-0 bg-white border-t border-slate-200 px-3 sm:px-6 pt-2.5 pb-3 sm:py-3.5">
      <div className="max-w-3xl mx-auto w-full space-y-2">
        {/* Live listening transcript strip */}
        {isListening && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-2 text-sm"
            role="status"
            aria-live="polite"
            data-testid="live-transcript-bar"
          >
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-blue-800 mr-2">Listening…</span>
              <span className="text-slate-900">
                {interimTranscript || 'Speak your interview question now'}
              </span>
            </div>
            <button
              type="button"
              onClick={onCancelListening}
              aria-label="Cancel voice capture"
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Active TTS reading bar with prominent Stop button & mic pause note */}
        {isSpeaking && !isListening && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl bg-slate-100 border border-slate-200 px-3.5 py-2 text-xs sm:text-sm"
            role="status"
            data-testid="speaking-status-bar"
          >
            <div className="flex items-center gap-2 text-slate-700 min-w-0">
              <Volume2 className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span className="truncate">
                Reading aloud · Microphone paused while speaking
              </span>
            </div>
            <button
              type="button"
              onClick={onStopSpeaking}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              <Square className="w-3 h-3 fill-current shrink-0" aria-hidden="true" />
              <span>Stop</span>
            </button>
          </div>
        )}

        {/* Short non-blocking explanation when microphone is unavailable */}
        {micError && (
          <div
            role="status"
            className="flex items-start justify-between gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2 text-xs sm:text-sm text-amber-900"
            data-testid="mic-fallback-notice"
          >
            <span>{micError}</span>
            <button
              type="button"
              onClick={onDismissMicError}
              aria-label="Dismiss microphone notice"
              className="p-1 -mr-1 text-amber-700 hover:text-amber-950 rounded-md shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Main input + easy-to-reach Microphone + Send controls */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 sm:gap-2.5">
          <label htmlFor="paneldesk-question-input" className="sr-only">
            Ask an interview question
          </label>
          <input
            id="paneldesk-question-input"
            type="text"
            value={isListening && interimTranscript ? interimTranscript : inputValue}
            onChange={(e) => {
              if (!isListening) onInputChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            readOnly={isListening}
            disabled={!canAsk}
            placeholder={
              !hasPdf
                ? 'Upload your interview PDF to start asking questions…'
                : isListening
                  ? 'Listening…'
                  : 'Ask a question, ID (like B3 or I88), or follow-up…'
            }
            className="flex-1 min-w-0 h-12 px-4 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-sm sm:text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/15 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          />

          {/* Prominent Microphone Button — >= 48x48px easy reach on mobile thumb zone & desktop */}
          <button
            type="button"
            onClick={onMicToggle}
            disabled={!canAsk || isThinking}
            aria-label={
              isListening
                ? 'Stop listening and submit question'
                : isSpeaking
                  ? 'Stop reading and ask by voice'
                  : micSupported
                    ? 'Ask by voice'
                    : 'Voice input unavailable'
            }
            aria-pressed={isListening}
            title={
              isListening
                ? 'Tap to finish speaking'
                : isSpeaking
                  ? 'Microphone paused while speaking — tap to interrupt and speak'
                  : 'Ask by voice'
            }
            className={`min-h-[48px] min-w-[48px] h-12 px-3.5 inline-flex items-center justify-center gap-2 rounded-xl font-medium text-sm transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45 disabled:cursor-not-allowed ${
              isListening
                ? 'bg-red-600 hover:bg-red-700 text-white focus-visible:outline-red-600'
                : !micSupported
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 focus-visible:outline-slate-600'
                  : 'bg-blue-700 hover:bg-blue-800 text-white focus-visible:outline-blue-700'
            }`}
          >
            {isListening ? (
              <>
                <Square className="w-4 h-4 fill-current shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Stop mic</span>
              </>
            ) : !micSupported ? (
              <MicOff className="w-5 h-5 shrink-0" aria-hidden="true" />
            ) : (
              <>
                <Mic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Speak</span>
              </>
            )}
          </button>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send question"
            className="min-h-[48px] h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
