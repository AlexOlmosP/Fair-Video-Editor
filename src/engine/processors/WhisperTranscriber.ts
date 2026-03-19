/**
 * Client-side speech-to-text using Whisper via @huggingface/transformers.
 * Processes the video's actual audio data — no microphone needed.
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// Allow loading models from HuggingFace CDN
env.allowLocalModels = false;

export interface TranscriptionSegment {
  text: string;
  startTime: number;
  endTime: number;
}

export type TranscriptionStatus =
  | { phase: 'loading-model'; progress: number }
  | { phase: 'extracting-audio' }
  | { phase: 'transcribing'; progress: number }
  | { phase: 'done'; segments: TranscriptionSegment[] }
  | { phase: 'error'; message: string };

// Singleton transcriber instance (model is cached after first load)
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let modelLoading: Promise<void> | null = null;

async function loadModel(
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (transcriber) return;

  if (modelLoading) {
    await modelLoading;
    return;
  }

  modelLoading = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transcriber = await (pipeline as any)(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      {
        dtype: 'q4',
        device: 'wasm',
        progress_callback: (info: { status: string; progress?: number }) => {
          if (info.status === 'progress' && info.progress != null && onProgress) {
            onProgress(info.progress);
          }
        },
      },
    );
  })();

  await modelLoading;
  modelLoading = null;
}

/**
 * Extract audio from a video element as mono Float32Array at 16kHz.
 * Uses Web Audio API — no FFmpeg needed.
 */
async function extractAudio(videoElement: HTMLVideoElement): Promise<Float32Array> {
  const src = videoElement.src;
  if (!src) throw new Error('Video element has no src');

  const response = await fetch(src);
  const arrayBuffer = await response.arrayBuffer();

  // Decode audio at native sample rate first
  const tempCtx = new OfflineAudioContext(1, 1, 16000);
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);

  // Resample to 16kHz mono
  const targetSampleRate = 16000;
  const totalSamples = Math.ceil(audioBuffer.duration * targetSampleRate);
  const offlineCtx = new OfflineAudioContext(1, totalSamples, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Transcribe a video element's audio using Whisper.
 * Returns timestamped segments suitable for creating caption clips.
 */
export async function transcribeVideo(
  videoElement: HTMLVideoElement,
  onStatus: (status: TranscriptionStatus) => void,
): Promise<TranscriptionSegment[]> {
  try {
    // Phase 1: Load model (cached after first use)
    onStatus({ phase: 'loading-model', progress: 0 });
    await loadModel((progress) => {
      onStatus({ phase: 'loading-model', progress });
    });

    if (!transcriber) {
      throw new Error('Failed to load Whisper model');
    }

    // Phase 2: Extract audio from video
    onStatus({ phase: 'extracting-audio' });
    const audioData = await extractAudio(videoElement);

    // Phase 3: Run transcription
    onStatus({ phase: 'transcribing', progress: 0 });

    const result = await transcriber(audioData, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'en',
    });

    // Parse results into segments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks = (result as any).chunks || [];
    const segments: TranscriptionSegment[] = chunks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((chunk: any) => chunk.text?.trim())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((chunk: any) => ({
        text: chunk.text.trim(),
        startTime: chunk.timestamp?.[0] ?? 0,
        endTime: chunk.timestamp?.[1] ?? chunk.timestamp?.[0] + 2,
      }));

    onStatus({ phase: 'done', segments });
    return segments;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed';
    onStatus({ phase: 'error', message });
    throw error;
  }
}

/**
 * Check if the browser supports the required APIs for Whisper transcription.
 */
export function isWhisperSupported(): boolean {
  return typeof OfflineAudioContext !== 'undefined';
}
