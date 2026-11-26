import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstanceLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export interface VoiceController {
  isListening: boolean;
  interimTranscript: string;
  micSupported: boolean;
  micError: string | null;
  dismissMicError: () => void;
  startListening: () => void;
  stopListening: () => void;
  cancelListening: () => void;
  isSpeaking: boolean;
  speakingMessageId: string | null;
  ttsSupported: boolean;
  speakText: (text: string, messageId: string) => void;
  stopSpeaking: () => void;
}

export function useVoiceController(
  onFinalTranscript: (transcript: string) => void
): VoiceController {
  const [micSupported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null);
  const [ttsSupported] = useState<boolean>(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window
  );

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const onFinalTranscriptRef = useRef(onFinalTranscript);
  onFinalTranscriptRef.current = onFinalTranscript;

  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const latestTranscriptRef = useRef('');
  const submittedRef = useRef(false);
  const cancelledRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const utteranceTokenRef = useRef(0);
  const pendingListenTimerRef = useRef<number | null>(null);

  const stopRecognitionImmediately = useCallback(() => {
    cancelledRef.current = true;
    latestTranscriptRef.current = '';
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore abort errors on already-stopped recognition instances
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const stopSpeaking = useCallback(() => {
    utteranceTokenRef.current += 1;
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setSpeakingMessageId(null);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore synthesis cancel errors
      }
    }
  }, []);

  const speakText = useCallback(
    (text: string, messageId: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      // Always pause/stop microphone capture before speaking so the app never captures its own voice
      if (pendingListenTimerRef.current !== null) {
        window.clearTimeout(pendingListenTimerRef.current);
        pendingListenTimerRef.current = null;
      }
      stopRecognitionImmediately();

      utteranceTokenRef.current += 1;
      const myToken = utteranceTokenRef.current;

      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = 'en-US';
      utterance.rate = 1.02;
      utterance.pitch = 1.0;

      // Prefer a clear local English voice when available
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((v) => v.lang.startsWith('en') && /natural|google|samantha|daniel/i.test(v.name)) ??
        voices.find((v) => v.lang.startsWith('en-US')) ??
        voices.find((v) => v.lang.startsWith('en'));
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      isSpeakingRef.current = true;
      setIsSpeaking(true);
      setSpeakingMessageId(messageId);

      const finish = () => {
        if (utteranceTokenRef.current !== myToken) return;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.speak(utterance);
    },
    [stopRecognitionImmediately]
  );

  const launchRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setMicError(
        'Voice input isn’t supported in this browser preview. You can still type questions below and use Read aloud on any answer.'
      );
      return;
    }

    // Never open microphone while TTS is actively speaking
    if (isSpeakingRef.current) {
      return;
    }

    setMicError(null);
    submittedRef.current = false;
    cancelledRef.current = false;
    latestTranscriptRef.current = '';
    setInterimTranscript('');

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return;
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (recognitionRef.current !== recognition || cancelledRef.current) return;

      let finalPart = '';
      let interimPart = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalPart += transcript + ' ';
        } else {
          interimPart += transcript + ' ';
        }
      }

      const combined = `${finalPart}${interimPart}`.replace(/\s+/g, ' ').trim();
      latestTranscriptRef.current = combined;
      setInterimTranscript(combined);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (recognitionRef.current !== recognition) return;

      const code = event.error;
      if (code === 'aborted') {
        setIsListening(false);
        setInterimTranscript('');
        return;
      }

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        cancelledRef.current = true;
        setMicError(
          'Microphone access is blocked or unavailable in this preview. Allow mic access in your browser, or type your question below.'
        );
      } else if (code === 'audio-capture') {
        cancelledRef.current = true;
        setMicError(
          'No microphone was detected on this device. You can keep asking typed questions below.'
        );
      } else if (code === 'no-speech') {
        cancelledRef.current = true;
        setMicError('No speech detected. Tap the microphone again or type your question.');
      } else if (code === 'network') {
        cancelledRef.current = true;
        setMicError(
          'Speech recognition is unavailable offline or blocked by the preview. Typed questions continue to work.'
        );
      } else {
        cancelledRef.current = true;
        setMicError('Voice capture could not start in this preview. Typed questions remain ready.');
      }

      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setIsListening(false);

      const finalUtterance = latestTranscriptRef.current.trim();
      setInterimTranscript('');

      // Submit strictly once per finished spoken question, never if cancelled or speaking
      if (!cancelledRef.current && !submittedRef.current && !isSpeakingRef.current && finalUtterance) {
        submittedRef.current = true;
        onFinalTranscriptRef.current(finalUtterance);
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setMicError(
        'Microphone access isn’t available in this preview environment. You can still type questions below.'
      );
    }
  }, []);

  const startListening = useCallback(() => {
    if (!micSupported) {
      setMicError(
        'Voice input isn’t supported in this browser preview. You can still type questions below and use Read aloud on any answer.'
      );
      return;
    }

    // If app is currently reading aloud, stop TTS first and wait briefly so echo doesn't trigger capture
    if (isSpeakingRef.current) {
      stopSpeaking();
      if (pendingListenTimerRef.current !== null) {
        window.clearTimeout(pendingListenTimerRef.current);
      }
      pendingListenTimerRef.current = window.setTimeout(() => {
        pendingListenTimerRef.current = null;
        launchRecognition();
      }, 150);
      return;
    }

    launchRecognition();
  }, [launchRecognition, micSupported, stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        setIsListening(false);
      }
    }
  }, []);

  const cancelListening = useCallback(() => {
    stopRecognitionImmediately();
  }, [stopRecognitionImmediately]);

  const dismissMicError = useCallback(() => {
    setMicError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingListenTimerRef.current !== null) {
        window.clearTimeout(pendingListenTimerRef.current);
      }
      stopRecognitionImmediately();
      stopSpeaking();
    };
  }, [stopRecognitionImmediately, stopSpeaking]);

  return {
    isListening,
    interimTranscript,
    micSupported,
    micError,
    dismissMicError,
    startListening,
    stopListening,
    cancelListening,
    isSpeaking,
    speakingMessageId,
    ttsSupported,
    speakText,
    stopSpeaking,
  };
}
