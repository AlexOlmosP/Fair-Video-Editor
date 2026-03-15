import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { FFMPEG_CONFIG } from './config';

/**
 * Singleton wrapper around FFmpeg.wasm.
 * All heavy processing runs via this class to keep the main thread free.
 */
export class FFmpegWorker {
  private static instance: FFmpegWorker | null = null;
  private ffmpeg: FFmpeg;
  private loaded = false;
  private loading: Promise<void> | null = null;

  private constructor() {
    this.ffmpeg = new FFmpeg();
  }

  static getInstance(): FFmpegWorker {
    if (!FFmpegWorker.instance) {
      FFmpegWorker.instance = new FFmpegWorker();
    }
    return FFmpegWorker.instance;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      if (FFMPEG_CONFIG.log) {
        this.ffmpeg.on('log', ({ message }) => {
          console.log('[FFmpeg]', message);
        });
      }

      this.loaded = true;
    })();

    return this.loading;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  onProgress(callback: (progress: number) => void): void {
    this.ffmpeg.on('progress', ({ progress }) => {
      callback(Math.round(progress * 100));
    });
  }

  async writeFile(name: string, data: File | Blob | string): Promise<void> {
    await this.ensureLoaded();
    if (typeof data === 'string') {
      await this.ffmpeg.writeFile(name, data);
    } else {
      await this.ffmpeg.writeFile(name, await fetchFile(data));
    }
  }

  async readFile(name: string): Promise<Uint8Array> {
    await this.ensureLoaded();
    const data = await this.ffmpeg.readFile(name);
    return data as Uint8Array;
  }

  async exec(args: string[]): Promise<void> {
    await this.ensureLoaded();
    await this.ffmpeg.exec(args);
  }

  async deleteFile(name: string): Promise<void> {
    await this.ensureLoaded();
    await this.ffmpeg.deleteFile(name);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }
}
