import type { NamedProject, ProjectDoc } from '../types';

/**
 * 所有数据仅保存在浏览器本地 IndexedDB，音频文件绝不上传。
 * 三个对象仓：
 *  - session：单条最近会话（key = 'current'）
 *  - projects：具名工程
 *  - blobs：音频文件 Blob（内置样例不存音频，重载后按类型重新生成）
 */
const DB_NAME = 'spatial-audio-workbench';
const DB_VERSION = 1;
const STORE_SESSION = 'session';
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSION)) db.createObjectStore(STORE_SESSION);
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const s = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        s.createIndex('savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveSession(doc: ProjectDoc): Promise<void> {
  await tx(STORE_SESSION, 'readwrite', (s) => s.put(doc, 'current'));
}

export async function loadSession(): Promise<ProjectDoc | undefined> {
  return tx(STORE_SESSION, 'readonly', (s) => s.get('current'));
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await tx(STORE_BLOBS, 'readwrite', (s) => s.put(blob, key));
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return tx(STORE_BLOBS, 'readonly', (s) => s.get(key));
}

export async function deleteBlob(key: string): Promise<void> {
  await tx(STORE_BLOBS, 'readwrite', (s) => s.delete(key));
}

export async function listProjects(): Promise<NamedProject[]> {
  const all = await tx<NamedProject[]>(STORE_PROJECTS, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveProject(p: NamedProject): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', (s) => s.put(p));
}

export async function deleteProject(id: string): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
}

export async function getProject(id: string): Promise<NamedProject | undefined> {
  return tx(STORE_PROJECTS, 'readonly', (s) => s.get(id));
}
