/**
 * IndexedDB-based project persistence.
 * Stores project state (JSON) and media files (Blobs) so projects survive browser refresh.
 */

import type { MediaAsset, ProjectSettings, Track, Clip } from '@/store/types';

const DB_NAME = 'video-editor-projects';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_MEDIA = 'media';

export interface SavedProject {
  name: string;
  savedAt: number;
  settings: ProjectSettings;
  assets: Record<string, SavedAsset>;
  tracks: Record<string, Track>;
  clips: Record<string, Clip>;
  trackOrder: string[];
  safeAreaRatio: string | null;
  aspectRatioLocked: boolean;
}

export interface SavedAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  duration: number;
  width?: number;
  height?: number;
}

export interface ProjectListItem {
  name: string;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const req = key !== undefined ? s.put(value, key) : s.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const req = s.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const req = s.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const req = s.getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save the current project to IndexedDB.
 */
export async function saveProject(name: string): Promise<void> {
  const { useProjectStore } = await import('@/store/useProjectStore');
  const { useTimelineStore } = await import('@/store/useTimelineStore');

  const { settings, assets, safeAreaRatio, aspectRatioLocked } = useProjectStore.getState();
  const { tracks, clips, trackOrder } = useTimelineStore.getState();

  const db = await openDB();

  // Build serializable asset metadata (strip blob URLs)
  const savedAssets: Record<string, SavedAsset> = {};
  for (const [id, asset] of Object.entries(assets)) {
    savedAssets[id] = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
    };
  }

  // Save project JSON
  const project: SavedProject = {
    name,
    savedAt: Date.now(),
    settings,
    assets: savedAssets,
    tracks,
    clips,
    trackOrder,
    safeAreaRatio,
    aspectRatioLocked,
  };
  await idbPut(db, STORE_PROJECTS, project);

  // Save media blobs
  for (const [id, asset] of Object.entries(assets)) {
    if (!asset.src) continue;
    try {
      const response = await fetch(asset.src);
      const blob = await response.blob();
      await idbPut(db, STORE_MEDIA, blob, `${name}:${id}`);
    } catch {
      console.warn(`Failed to save media blob for asset ${id}`);
    }
  }

  db.close();
}

/**
 * Load a project from IndexedDB and hydrate all stores.
 */
export async function loadProject(name: string): Promise<void> {
  const { useProjectStore } = await import('@/store/useProjectStore');
  const { useTimelineStore } = await import('@/store/useTimelineStore');
  const { useMediaStore } = await import('@/store/useMediaStore');
  const { useHistoryStore } = await import('@/store/useHistoryStore');

  const db = await openDB();

  const project = await idbGet<SavedProject>(db, STORE_PROJECTS, name);
  if (!project) {
    db.close();
    throw new Error(`Project "${name}" not found`);
  }

  // Clear current state
  useTimelineStore.setState({
    tracks: {},
    clips: {},
    trackOrder: [],
    selectedClipIds: [],
    selectedTrackId: null,
    playheadTime: 0,
    isPlaying: false,
  });
  useMediaStore.setState({ elements: {} });
  useHistoryStore.setState({ past: [], future: [] });

  // Restore media blobs → create blob URLs → register DOM elements
  const restoredAssets: Record<string, MediaAsset> = {};

  for (const [id, savedAsset] of Object.entries(project.assets)) {
    const blob = await idbGet<Blob>(db, STORE_MEDIA, `${name}:${id}`);
    if (!blob) {
      console.warn(`Media blob missing for asset ${id}, skipping`);
      continue;
    }

    const blobUrl = URL.createObjectURL(blob);

    // Recreate DOM element
    if (savedAsset.type === 'video') {
      const video = document.createElement('video');
      video.src = blobUrl;
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => resolve(); // don't block on error
      });
      useMediaStore.getState().register(id, video);
    } else if (savedAsset.type === 'image') {
      const img = new Image();
      img.src = blobUrl;
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
      useMediaStore.getState().register(id, img);
    }
    // Audio assets don't need DOM elements

    restoredAssets[id] = {
      ...savedAsset,
      src: blobUrl,
      thumbnailUrl: savedAsset.type === 'image' ? blobUrl : undefined,
    };
  }

  // Hydrate project store
  useProjectStore.setState({
    settings: project.settings,
    assets: restoredAssets,
    safeAreaRatio: project.safeAreaRatio,
    aspectRatioLocked: project.aspectRatioLocked,
  });

  // Hydrate timeline store
  useTimelineStore.setState({
    tracks: project.tracks,
    clips: project.clips,
    trackOrder: project.trackOrder,
  });

  db.close();
}

/**
 * List all saved projects.
 */
export async function listProjects(): Promise<ProjectListItem[]> {
  const db = await openDB();

  const items: ProjectListItem[] = [];
  const keys = await idbGetAllKeys(db, STORE_PROJECTS);

  for (const key of keys) {
    const project = await idbGet<SavedProject>(db, STORE_PROJECTS, key);
    if (project) {
      items.push({ name: project.name, savedAt: project.savedAt });
    }
  }

  db.close();
  return items.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Delete a saved project and its media.
 */
export async function deleteProject(name: string): Promise<void> {
  const db = await openDB();

  // Delete project data
  await idbDelete(db, STORE_PROJECTS, name);

  // Delete all media blobs for this project
  const allKeys = await idbGetAllKeys(db, STORE_MEDIA);
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(`${name}:`)) {
      await idbDelete(db, STORE_MEDIA, key);
    }
  }

  db.close();
}
