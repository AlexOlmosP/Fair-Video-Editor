'use client';

import { useState, useCallback, useRef } from 'react';
import { FFmpegWorker } from '@/engine/ffmpeg/FFmpegWorker';

interface UseFFmpegReturn {
  isLoaded: boolean;
  isLoading: boolean;
  progress: number;
  error: string | null;
  load: () => Promise<void>;
  exec: (args: string[]) => Promise<void>;
  writeFile: (name: string, data: File | Blob | string) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array>;
}

export function useFFmpeg(): UseFFmpegReturn {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<FFmpegWorker | null>(null);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = FFmpegWorker.getInstance();
    }
    return workerRef.current;
  }, []);

  const load = useCallback(async () => {
    if (isLoaded || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const worker = getWorker();
      worker.onProgress(setProgress);
      await worker.load();
      setIsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load FFmpeg');
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, isLoading, getWorker]);

  const exec = useCallback(async (args: string[]) => {
    const worker = getWorker();
    setProgress(0);
    await worker.exec(args);
  }, [getWorker]);

  const writeFile = useCallback(async (name: string, data: File | Blob | string) => {
    const worker = getWorker();
    await worker.writeFile(name, data);
  }, [getWorker]);

  const readFile = useCallback(async (name: string) => {
    const worker = getWorker();
    return worker.readFile(name);
  }, [getWorker]);

  return { isLoaded, isLoading, progress, error, load, exec, writeFile, readFile };
}
