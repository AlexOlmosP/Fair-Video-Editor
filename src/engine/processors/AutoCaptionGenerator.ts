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

/**
 * Generate captions from a video element using the Web Speech API.
 * The video must be playing for audio to be captured.
 */
export function generateCaptions(
  videoElement: HTMLVideoElement,
  onProgress?: (entries: CaptionEntry[]) => void,
): Promise<CaptionEntry[]> {
  return new Promise((resolve, reject) => {
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
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    const entries: CaptionEntry[] = [];
    let lastEndTime = 0;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (!text) continue;

          // Approximate timing based on video currentTime
          const endTime = videoElement.currentTime;
          const estimatedDuration = Math.max(1, text.split(' ').length * 0.4);
          const startTime = Math.max(lastEndTime, endTime - estimatedDuration);

          const entry: CaptionEntry = {
            id: uuid(),
            startTime,
            endTime,
            text,
          };

          entries.push(entry);
          lastEndTime = endTime;
          onProgress?.(entries);
        }
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === 'no-speech') {
        // Not an error, just silence
        return;
      }
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
      resolve(entries);
    };

    // Start recognition — the audio comes from the video element
    // playing through the system speakers (Web Speech API listens to mic/system)
    recognition.start();

    // Auto-stop when video ends or after a timeout
    const checkEnd = () => {
      if (videoElement.paused || videoElement.ended) {
        recognition.stop();
      } else {
        setTimeout(checkEnd, 500);
      }
    };
    checkEnd();
  });
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
