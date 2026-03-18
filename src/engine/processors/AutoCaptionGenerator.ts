import { v4 as uuid } from 'uuid';
import type { CaptionEntry } from '@/store/types';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

const SILENCE_TIMEOUT_MS = 30000;

/**
 * Generate captions from a video element using the Web Speech API.
 * Returns a promise for the entries and a stop() function for cancellation.
 */
export function generateCaptions(
  videoElement: HTMLVideoElement,
  onProgress?: (entries: CaptionEntry[]) => void,
): { entries: Promise<CaptionEntry[]>; stop: () => void } {
  let recognitionRef: SpeechRecognition | null = null;

  const stop = () => {
    recognitionRef?.stop();
    videoElement.pause();
  };

  const entries = new Promise<CaptionEntry[]>((resolve, reject) => {
    if (!isSpeechRecognitionSupported()) {
      reject(new Error('Speech recognition is not supported in this browser. Please use Chrome or Edge.'));
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      reject(new Error('Speech recognition not available'));
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognitionRef = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    const captionEntries: CaptionEntry[] = [];
    let lastEndTime = 0;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        recognition.stop();
      }, SILENCE_TIMEOUT_MS);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      resetSilenceTimer();

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (!text) continue;

          const endTime = videoElement.currentTime;
          const estimatedDuration = Math.max(1, text.split(' ').length * 0.4);
          const startTime = Math.max(lastEndTime, endTime - estimatedDuration);

          const entry: CaptionEntry = {
            id: uuid(),
            startTime,
            endTime,
            text,
          };

          captionEntries.push(entry);
          lastEndTime = endTime;
          onProgress?.(captionEntries);
        }
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted') {
        resolve(captionEntries);
        return;
      }

      let message = `Speech recognition error: ${event.error}`;
      if (event.error === 'not-allowed') {
        message = 'Microphone access denied. Please allow microphone access in your browser settings and try again.';
      } else if (event.error === 'network') {
        message = 'Network error during speech recognition. Check your internet connection and try again.';
      } else if (event.error === 'audio-capture') {
        message = 'No microphone detected. Please connect a microphone and try again.';
      }
      reject(new Error(message));
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      resolve(captionEntries);
    };

    recognition.start();
    resetSilenceTimer();

    // Auto-stop when video ends
    const checkEnd = () => {
      if (videoElement.paused || videoElement.ended) {
        if (silenceTimer) clearTimeout(silenceTimer);
        recognition.stop();
      } else {
        setTimeout(checkEnd, 500);
      }
    };
    checkEnd();
  });

  return { entries, stop };
}

/** Convert CaptionEntry[] to SRT subtitle format */
export function captionsToSRT(entries: CaptionEntry[]): string {
  return entries
    .map((entry, i) => {
      const start = formatSRTTime(entry.startTime);
      const end = formatSRTTime(entry.endTime);
      return `${i + 1}\n${start} --> ${end}\n${entry.text}\n`;
    })
    .join('\n');
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}
