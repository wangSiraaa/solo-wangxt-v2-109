import type { Project, ProjectSummary } from '../types';

const DB_NAME = 'spatial-audio-workbench';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'audioBlobs';

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_PROJECTS)) {
        d.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      // 原始音频按轨道 id 单独存放，避免大 ArrayBuffer 反复序列化
      if (!d.objectStoreNames.contains(STORE_BLOBS)) {
        d.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  async saveProject(p: Project): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.put(p));
  },

  async loadProject(id: string): Promise<Project | undefined> {
    return tx<Project | undefined>(STORE_PROJECTS, 'readonly', (s) =>
      s.get(id),
    );
  },

  async listProjects(): Promise<ProjectSummary[]> {
    const all = await tx<Project[]>(STORE_PROJECTS, 'readonly', (s) =>
      s.getAll(),
    );
    return all
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async deleteProject(id: string): Promise<void> {
    const p = await this.loadProject(id);
    if (p) {
      await Promise.all(
        p.tracks
          .filter((t) => t.kind === 'file')
          .map((t) => this.deleteAudioBlob(t.id)),
      );
    }
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
  },

  putAudioBlob(trackId: string, blob: Blob): Promise<IDBValidKey> {
    return tx(STORE_BLOBS, 'readwrite', (s) => s.put(blob, trackId));
  },

  getAudioBlob(trackId: string): Promise<Blob | undefined> {
    return tx<Blob | undefined>(STORE_BLOBS, 'readonly', (s) =>
      s.get(trackId),
    );
  },

  deleteAudioBlob(trackId: string): Promise<void> {
    return tx(STORE_BLOBS, 'readwrite', (s) => s.delete(trackId));
  },
};
