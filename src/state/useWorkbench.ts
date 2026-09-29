import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LevelState,
  ListenerState,
  NamedProject,
  ProjectDoc,
  SourceType,
  SpatialSettings,
  Track,
  UnlockState,
} from '../types';
import { engine } from '../lib/engineInstance';
import { DecodeError } from '../lib/audioEngine';
import * as idb from '../lib/idb';
import { SAMPLE_LABELS } from '../lib/samples';

const COLORS = ['#e8734a', '#4ecdc4', '#ffe066', '#a78bfa', '#f472b6', '#34d399', '#60a5fa'];

const DEFAULT_SPATIAL: SpatialSettings = {
  distanceModel: 'inverse',
  refDistance: 1,
  rolloffFactor: 1,
  maxDistance: 30,
  positionTimeConstant: 0.06,
  hrtfIR: 'none',
};

const DEFAULT_LISTENER: ListenerState = {
  position: { x: 0, y: 0, z: 3 },
  yaw: 0,
  pitch: 0,
  earHeight: 0,
};

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function sampleTrack(type: Exclude<SourceType, 'file'>, index: number): Track {
  const presets: Record<Exclude<SourceType, 'file'>, Partial<Track> & { position: Track['position'] }> = {
    pulse: { position: { x: -3, y: 0, z: 0 }, loop: true },
    tone: { position: { x: 3, y: 0, z: 0 }, loop: true },
    duoA: { position: { x: -2, y: 0, z: 0 }, loop: true },
    duoB: { position: { x: 2, y: 0, z: 0 }, loop: true },
  };
  const p = presets[type];
  return {
    id: uid('trk'),
    name: SAMPLE_LABELS[type],
    sourceType: type,
    loop: p.loop ?? true,
    muted: false,
    solo: false,
    gain: 0.9,
    channel: 0,
    color: COLORS[index % COLORS.length],
    position: { ...p.position },
    status: 'pending',
  };
}

function emptyDoc(): ProjectDoc {
  return {
    version: 1,
    tracks: [],
    listener: { ...DEFAULT_LISTENER, position: { ...DEFAULT_LISTENER.position } },
    spatial: { ...DEFAULT_SPATIAL },
    busGain: 1,
    masterGain: 0.9,
    savedAt: 0,
  };
}

export interface WorkbenchApi {
  doc: ProjectDoc;
  unlock: UnlockState;
  unlockError: string | null;
  playingIds: Set<string>;
  levels: LevelState;
  selectedId: string | null;
  projects: NamedProject[];
  loadedProjectId: string | null;
  loadedProjectName: string | null;
  saveState: 'idle' | 'saving' | 'saved';
  globalError: string | null;
  selectTrack: (id: string | null) => void;
  unlockAudio: () => Promise<void>;
  addSample: (type: Exclude<SourceType, 'file'>) => Promise<void>;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  moveTrack: (id: string, position: Track['position']) => void;
  setListener: (
    patch:
      | Partial<Omit<ListenerState, 'position'>>
      | { position: Partial<ListenerState['position']> },
  ) => void;
  setSpatial: (patch: Partial<SpatialSettings>) => void;
  setBusGain: (v: number) => void;
  setMasterGain: (v: number) => void;
  play: (id: string) => Promise<void>;
  pause: (id: string) => void;
  stop: (id: string) => void;
  seek: (id: string, offsetSec: number) => Promise<void>;
  togglePlay: (id: string) => Promise<void>;
  playAll: () => Promise<void>;
  stopAll: () => void;
  clearClips: () => void;
  saveProjectAs: (name: string) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  newProject: () => Promise<void>;
  dismissGlobalError: () => void;
}

export function useWorkbench(): WorkbenchApi {
  const [doc, setDoc] = useState<ProjectDoc>(emptyDoc);
  const [unlock, setUnlock] = useState<UnlockState>('locked');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [playingIds, setPlayingIds] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<LevelState>({ l: 0, r: 0, clipL: false, clipR: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<NamedProject[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [loadedProjectName, setLoadedProjectName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [globalError, setGlobalError] = useState<string | null>(null);

  const docRef = useRef(doc);
  docRef.current = doc;
  const initDone = useRef(false);

  // ---------- 初始化：恢复会话与工程列表，绝不自动播放 ----------
  useEffect(() => {
    // React StrictMode 会双重挂载；用标志保证只加载一次，cancelled 只阻止写状态
    if (initDone.current) return;
    initDone.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [session, list] = await Promise.all([idb.loadSession(), idb.listProjects()]);
        if (cancelled) return;
        if (list) setProjects(list);
        if (session) {
          // 恢复全部参数，但播放状态一律归零（不擅自自动播放）。
          // 文件轨标记 pending，待音频解锁后重新注入 Blob 解码。
          setDoc({
            ...session,
            tracks: session.tracks.map((t) => ({
              ...t,
              status: 'pending',
              errorMessage: undefined,
            })),
          });
        }
      } catch (err) {
        if (!cancelled) {
          setGlobalError(`读取本地工程失败：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- 引擎事件订阅 ----------
  useEffect(() => engine.onUnlock(setUnlock), []);
  useEffect(() => engine.onLevels(setLevels), []);

  useEffect(() => {
    return engine.onEnded((trackId) => {
      setPlayingIds((prev) => {
        if (!prev.has(trackId)) return prev;
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
    });
  }, []);

  // ---------- 全局参数同步到音频链 ----------
  useEffect(() => {
    engine.setSpatialSettings(doc.spatial);
  }, [doc.spatial]);

  useEffect(() => {
    engine.setListener(doc.listener);
  }, [doc.listener]);

  useEffect(() => {
    engine.setBusGain(doc.busGain);
  }, [doc.busGain]);

  useEffect(() => {
    engine.setMasterGain(doc.masterGain);
  }, [doc.masterGain]);

  // 声轨任意参数（位置/增益/静音/独奏/loop）实时同步到音频链：
  // syncTracks 只更新 AudioParam 与路由，不重建 source，移动不会重启音轨
  useEffect(() => {
    engine.syncTracks(doc.tracks);
  }, [doc.tracks]);

  // ---------- 解锁后：同步全部声轨（解码/合成 + 参数），但不播放 ----------
  useEffect(() => {
    if (unlock !== 'unlocked') return;
    let cancelled = false;
    (async () => {
      // 先把当前全局参数推入音频图（恢复工程后这些 effect 不会因解锁而重跑）
      engine.setSpatialSettings(docRef.current.spatial);
      engine.setListener(docRef.current.listener);
      engine.setBusGain(docRef.current.busGain);
      engine.setMasterGain(docRef.current.masterGain);

      // 注入文件 Blob
      for (const t of docRef.current.tracks) {
        if (t.sourceType === 'file' && t.blobKey && t.status !== 'ready') {
          try {
            const blob = await idb.getBlob(t.blobKey);
            if (blob) engine.setFileBlob(t.id, blob);
            else if (!cancelled) {
              patchTrack(t.id, { status: 'decode-error', errorMessage: '本地音频 Blob 缺失' });
            }
          } catch {
            if (!cancelled) {
              patchTrack(t.id, { status: 'decode-error', errorMessage: '读取本地音频失败' });
            }
          }
        }
      }
      for (const t of docRef.current.tracks) {
        if (cancelled) return;
        try {
          await engine.ensureTrack(t);
          if (cancelled) return;
          // 解码期间声轨可能已被删除
          if (!docRef.current.tracks.some((x) => x.id === t.id)) {
            engine.removeTrack(t.id);
            continue;
          }
          const dur = engine.getDuration(t.id);
          const ch = engine.getChannelCount(t.id);
          patchTrack(t.id, {
            status: 'ready',
            errorMessage: undefined,
            duration: dur ?? t.duration,
            channels: ch ?? t.channels,
          });
        } catch (err) {
          if (cancelled) return;
          if (err instanceof DecodeError) {
            patchTrack(t.id, { status: 'decode-error', errorMessage: err.message });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlock]);

  // ---------- 自动保存会话（参数，不保存播放状态），防抖 ----------
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initDone.current) return;
    setSaveState('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const snapshot: ProjectDoc = {
        ...docRef.current,
        savedAt: Date.now(),
      };
      try {
        await idb.saveSession(snapshot);
        setSaveState('saved');
        window.setTimeout(() => setSaveState('idle'), 1200);
      } catch {
        setSaveState('idle');
      }
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [doc]);

  function patchTrack(id: string, patch: Partial<Track>) {
    setDoc((d) => ({
      ...d,
      tracks: d.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }

  const selectTrack = useCallback((id: string | null) => setSelectedId(id), []);

  const unlockAudio = useCallback(async () => {
    setUnlockError(null);
    try {
      await engine.resume();
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const addSample = useCallback(async (type: Exclude<SourceType, 'file'>) => {
    if (engine.unlock !== 'unlocked') {
      // 解锁失败时不继续；用户在遮罩上能看到明确错误
      await unlockAudio();
      if ((engine.unlock as UnlockState) !== 'unlocked') return;
    }
    const track = sampleTrack(type, docRef.current.tracks.length);
    setDoc((d) => ({ ...d, tracks: [...d.tracks, track] }));
    if (engine.unlock === 'unlocked') {
      try {
        await engine.ensureTrack(track);
        const dur = engine.getDuration(track.id);
        const ch = engine.getChannelCount(track.id);
        patchTrack(track.id, {
          status: 'ready',
          duration: dur ?? undefined,
          channels: ch ?? undefined,
        });
      } catch {
        patchTrack(track.id, { status: 'decode-error', errorMessage: '样例合成失败' });
      }
    }
    setSelectedId(track.id);
  }, [unlock, unlockAudio]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = [...files];
      if (arr.length === 0) return;
      if (engine.unlock !== 'unlocked') {
        await unlockAudio();
        if ((engine.unlock as UnlockState) !== 'unlocked') return;
      }
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        const blobKey = uid('blob');
        const idx = docRef.current.tracks.length + i;
        const track: Track = {
          id: uid('trk'),
          name: file.name,
          sourceType: 'file',
          blobKey,
          originalFileName: file.name,
          loop: false,
          muted: false,
          solo: false,
          gain: 0.9,
          channel: 0,
          color: COLORS[idx % COLORS.length],
          position: {
            x: Math.cos((idx * 2 * Math.PI) / Math.max(arr.length, 1)) * 2.5,
            y: 0,
            z: Math.sin((idx * 2 * Math.PI) / Math.max(arr.length, 1)) * 2.5,
          },
          status: engine.unlock === 'unlocked' ? 'loading' : 'pending',
        };
        setDoc((d) => ({ ...d, tracks: [...d.tracks, track] }));
        try {
          await idb.putBlob(blobKey, file);
        } catch {
          patchTrack(track.id, {
            status: 'decode-error',
            errorMessage: '音频写入本地 IndexedDB 失败（浏览器存储可能已满）',
          });
          continue;
        }
        if (engine.unlock !== 'unlocked') continue;
        engine.setFileBlob(track.id, file);
        try {
          // 用户可能在解码期间删除了该声轨
          if (!docRef.current.tracks.some((x) => x.id === track.id)) continue;
          await engine.ensureTrack(track);
          if (!docRef.current.tracks.some((x) => x.id === track.id)) {
            engine.removeTrack(track.id);
            continue;
          }
          const dur = engine.getDuration(track.id);
          const ch = engine.getChannelCount(track.id);
          patchTrack(track.id, {
            status: 'ready',
            duration: dur ?? undefined,
            channels: ch ?? undefined,
          });
        } catch (err) {
          if (!docRef.current.tracks.some((x) => x.id === track.id)) continue;
          if (err instanceof DecodeError) {
            patchTrack(track.id, { status: 'decode-error', errorMessage: err.message });
          } else {
            patchTrack(track.id, {
              status: 'decode-error',
              errorMessage: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    },
    [unlock, unlockAudio],
  );

  const removeTrack = useCallback(async (id: string) => {
    const t = docRef.current.tracks.find((x) => x.id === id);
    engine.removeTrack(id);
    if (t?.blobKey) {
      try {
        await idb.deleteBlob(t.blobKey);
      } catch {
        /* 忽略清理失败 */
      }
    }
    setPlayingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDoc((d) => ({ ...d, tracks: d.tracks.filter((x) => x.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const updateTrack = useCallback(
    (id: string, patch: Partial<Track>) => {
      const prev = docRef.current.tracks.find((x) => x.id === id);
      patchTrack(id, patch);
      // 切换所选输入声道需要重建输入图（splitter 接线改变）
      if (
        prev &&
        patch.channel !== undefined &&
        patch.channel !== prev.channel &&
        engine.unlock === 'unlocked'
      ) {
        const merged: Track = { ...prev, ...patch };
        void engine.rebuildVoiceGraph(merged).catch((err) => {
          if (err instanceof DecodeError) {
            patchTrack(id, { status: 'decode-error', errorMessage: err.message });
          }
        });
      }
    },
    [],
  );

  const moveTrack = useCallback((id: string, position: Track['position']) => {
    setDoc((d) => ({
      ...d,
      tracks: d.tracks.map((t) => (t.id === id ? { ...t, position: { ...position } } : t)),
    }));
  }, []);

  const setListener = useCallback(
    (patch: Partial<ListenerState> | { position: Partial<ListenerState['position']> }) => {
      setDoc((d) => {
        if ('position' in patch) {
          return {
            ...d,
            listener: {
              ...d.listener,
              position: { ...d.listener.position, ...(patch as { position: Partial<ListenerState['position']> }).position },
            },
          };
        }
        return { ...d, listener: { ...d.listener, ...(patch as Partial<ListenerState>) } };
      });
    },
    [],
  );

  const setSpatial = useCallback((patch: Partial<SpatialSettings>) => {
    setDoc((d) => ({ ...d, spatial: { ...d.spatial, ...patch } }));
  }, []);

  const setBusGain = useCallback((v: number) => {
    setDoc((d) => ({ ...d, busGain: v }));
  }, []);

  const setMasterGain = useCallback((v: number) => {
    setDoc((d) => ({ ...d, masterGain: v }));
  }, []);

  // ---------- 传输 ----------
  const play = useCallback(
    async (id: string) => {
      if (engine.unlock !== 'unlocked') await unlockAudio();
      const t = docRef.current.tracks.find((x) => x.id === id);
      if (!t || t.status === 'decode-error') return;
      try {
        await engine.playTrack(t);
        setPlayingIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      } catch (err) {
        if (err instanceof DecodeError) {
          patchTrack(id, { status: 'decode-error', errorMessage: err.message });
        } else {
          setGlobalError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [unlockAudio],
  );

  const pause = useCallback((id: string) => {
    const t = docRef.current.tracks.find((x) => x.id === id);
    if (!t) return;
    engine.pauseTrack(t);
    setPlayingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const stop = useCallback((id: string) => {
    const t = docRef.current.tracks.find((x) => x.id === id);
    if (!t) return;
    engine.stopTrack(t);
    setPlayingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const seek = useCallback(
    async (id: string, offsetSec: number) => {
      const t = docRef.current.tracks.find((x) => x.id === id);
      if (!t) return;
      const wasPlaying = engine.isPlaying(id);
      await engine.seekTrack(t, offsetSec, wasPlaying);
      setPlayingIds((prev) => {
        const next = new Set(prev);
        if (wasPlaying) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [],
  );

  const togglePlay = useCallback(
    async (id: string) => {
      if (engine.isPlaying(id)) pause(id);
      else await play(id);
    },
    [pause, play],
  );

  const playAll = useCallback(async () => {
    if (engine.unlock !== 'unlocked') await unlockAudio();
    for (const t of docRef.current.tracks) {
      if (t.status === 'decode-error') continue;
      try {
        await engine.playTrack(t);
        setPlayingIds((prev) => new Set(prev).add(t.id));
      } catch (err) {
        if (err instanceof DecodeError) {
          patchTrack(t.id, { status: 'decode-error', errorMessage: err.message });
        }
      }
    }
  }, [unlockAudio]);

  const stopAll = useCallback(() => {
    for (const t of docRef.current.tracks) engine.stopTrack(t);
    setPlayingIds(new Set());
  }, []);

  const clearClips = useCallback(() => {
    engine.clearClipLatch();
    setLevels((l) => ({ ...l, clipL: false, clipR: false }));
  }, []);

  // ---------- 具名工程 ----------
  const refreshProjects = useCallback(async () => {
    setProjects(await idb.listProjects());
  }, []);

  const saveProjectAs = useCallback(
    async (name: string) => {
      const id = loadedProjectId ?? uid('proj');
      const named: NamedProject = {
        id,
        name: name.trim() || `工程 ${new Date().toLocaleString()}`,
        savedAt: Date.now(),
        doc: { ...docRef.current, savedAt: Date.now() },
      };
      await idb.saveProject(named);
      setLoadedProjectId(id);
      setLoadedProjectName(named.name);
      await refreshProjects();
    },
    [loadedProjectId, refreshProjects],
  );

  const loadProject = useCallback(
    async (id: string) => {
      const p = await idb.getProject(id);
      if (!p) return;
      // 先拆除当前声轨节点
      for (const t of docRef.current.tracks) engine.removeTrack(t.id);
      setPlayingIds(new Set());
      const restored: ProjectDoc = {
        ...p.doc,
        tracks: p.doc.tracks.map((t) => ({
          ...t,
          // 内置样例可重建；文件声轨等待 Blob 注入解码；不自动播放
          status: t.sourceType === 'file' ? 'pending' : 'pending',
        })),
      };
      setDoc(restored);
      setLoadedProjectId(p.id);
      setLoadedProjectName(p.name);
      setSelectedId(null);
      // 若已解锁，走一遍解锁同步逻辑（手动触发：状态不变，effect 不会重跑）
      if (engine.unlock === 'unlocked') {
        for (const t of restored.tracks) {
          if (t.sourceType === 'file' && t.blobKey) {
            const blob = await idb.getBlob(t.blobKey);
            if (blob) engine.setFileBlob(t.id, blob);
            else patchTrack(t.id, { status: 'decode-error', errorMessage: '本地音频 Blob 缺失' });
          }
          try {
            await engine.ensureTrack(t);
            patchTrack(t.id, {
              status: 'ready',
              duration: engine.getDuration(t.id) ?? t.duration,
              channels: engine.getChannelCount(t.id) ?? t.channels,
              errorMessage: undefined,
            });
          } catch (err) {
            if (err instanceof DecodeError) {
              patchTrack(t.id, { status: 'decode-error', errorMessage: err.message });
            }
          }
        }
      }
    },
    [],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await idb.deleteProject(id);
      if (loadedProjectId === id) {
        setLoadedProjectId(null);
        setLoadedProjectName(null);
      }
      await refreshProjects();
    },
    [loadedProjectId, refreshProjects],
  );

  const newProject = useCallback(async () => {
    for (const t of docRef.current.tracks) engine.removeTrack(t.id);
    setPlayingIds(new Set());
    setDoc(emptyDoc());
    setLoadedProjectId(null);
    setLoadedProjectName(null);
    setSelectedId(null);
  }, []);

  const dismissGlobalError = useCallback(() => setGlobalError(null), []);

  const api = useMemo<WorkbenchApi>(
    () => ({
      doc,
      unlock,
      unlockError,
      playingIds,
      levels,
      selectedId,
      projects,
      loadedProjectId,
      loadedProjectName,
      saveState,
      globalError,
      selectTrack,
      unlockAudio,
      addSample,
      addFiles,
      removeTrack,
      updateTrack,
      moveTrack,
      setListener,
      setSpatial,
      setBusGain,
      setMasterGain,
      play,
      pause,
      stop,
      seek,
      togglePlay,
      playAll,
      stopAll,
      clearClips,
      saveProjectAs,
      loadProject,
      deleteProject,
      newProject,
      dismissGlobalError,
    }),
    [
      doc,
      unlock,
      unlockError,
      playingIds,
      levels,
      selectedId,
      projects,
      loadedProjectId,
      loadedProjectName,
      saveState,
      globalError,
      selectTrack,
      unlockAudio,
      addSample,
      addFiles,
      removeTrack,
      updateTrack,
      moveTrack,
      setListener,
      setSpatial,
      setBusGain,
      setMasterGain,
      play,
      pause,
      stop,
      seek,
      togglePlay,
      playAll,
      stopAll,
      clearClips,
      saveProjectAs,
      loadProject,
      deleteProject,
      newProject,
      dismissGlobalError,
    ],
  );

  return api;
}
