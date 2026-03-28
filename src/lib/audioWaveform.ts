/**
 * Audio waveform utilities: decode audio files, extract amplitude peaks,
 * and cache AudioBuffers for low-latency scrub preview.
 */

/** Number of peak samples stored per asset (high enough for any zoom level). */
const PEAK_RESOLUTION = 2000;

/** Cached decoded AudioBuffers keyed by assetId — used for scrub preview. */
const audioBufferCache = new Map<string, AudioBuffer>();

/** Singleton AudioContext for decoding (offline analysis, not playback). */
let decodeCtx: AudioContext | null = null;
function getDecodeContext(): AudioContext {
  if (!decodeCtx || decodeCtx.state === 'closed') {
    decodeCtx = new AudioContext();
  }
  return decodeCtx;
}

/**
 * Fetch, decode, and extract waveform peaks from an audio/video URL.
 * Also caches the full AudioBuffer for scrub preview.
 * Returns a Float32Array of `PEAK_RESOLUTION` amplitude values (0–1).
 */
export async function decodeAndExtractPeaks(
  assetId: string,
  url: string,
): Promise<Float32Array> {
  const ctx = getDecodeContext();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  audioBufferCache.set(assetId, audioBuffer);

  return extractPeaks(audioBuffer, PEAK_RESOLUTION);
}

/** Returns the cached AudioBuffer for an asset, if previously decoded. */
export function getCachedAudioBuffer(assetId: string): AudioBuffer | undefined {
  return audioBufferCache.get(assetId);
}

/** Evict a cached buffer (e.g., on asset removal). */
export function evictAudioBuffer(assetId: string): void {
  audioBufferCache.delete(assetId);
}

/** Extract peak amplitudes from an AudioBuffer downsampled to `count` bins. */
function extractPeaks(audioBuffer: AudioBuffer, count: number): Float32Array {
  const channel = audioBuffer.getChannelData(0);
  const samplesPerBin = Math.max(1, Math.floor(channel.length / count));
  const peaks = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    let max = 0;
    const start = i * samplesPerBin;
    const end = Math.min(start + samplesPerBin, channel.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channel[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  return peaks;
}
