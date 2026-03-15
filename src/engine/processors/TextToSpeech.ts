/**
 * Text-to-Speech wrapper using the Web Speech Synthesis API.
 * Browser-native, no dependencies required.
 */

export function isTTSSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isTTSSupported()) return [];
  return window.speechSynthesis.getVoices();
}

export function getVoicesByLanguage(lang: string): SpeechSynthesisVoice[] {
  return getAvailableVoices().filter((v) => v.lang.startsWith(lang));
}

export function getAvailableLanguages(): string[] {
  const voices = getAvailableVoices();
  const langs = new Set(voices.map((v) => v.lang));
  return Array.from(langs).sort();
}

export interface TTSOptions {
  text: string;
  voice?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}

/** Preview TTS (plays through speakers) */
export function previewTTS(options: TTSOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isTTSSupported()) {
      reject(new Error('Text-to-Speech is not supported in this browser.'));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;

    if (options.voice) {
      const voice = getAvailableVoices().find((v) => v.name === options.voice);
      if (voice) utterance.voice = voice;
    }

    if (options.lang) {
      utterance.lang = options.lang;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(new Error(`TTS error: ${e.error}`));

    window.speechSynthesis.speak(utterance);
  });
}

/** Estimate TTS duration (approximate based on word count and rate) */
export function estimateDuration(text: string, rate: number = 1): number {
  const wordCount = text.trim().split(/\s+/).length;
  // Average speaking rate: ~150 words per minute
  const baseSeconds = (wordCount / 150) * 60;
  return baseSeconds / rate;
}

/** Stop any ongoing TTS playback */
export function stopTTS(): void {
  if (isTTSSupported()) {
    window.speechSynthesis.cancel();
  }
}
