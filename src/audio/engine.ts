import type {
  ListenerState,
  Project,
  ProjectSummary,
  TrackState,
  Vec3,
} from '../types';
import { db, uid } from './db';
import { generateSampleBuffer } from './sampleGen';

const DEG = Math.PI / 180;
const POS_LIMIT = 11; // 二维/高度坐标限制（米）
export const RANGE_LIMIT = 20; // PannerNode.maxDistance

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function dbToGain(db: number): number {
  if (db <= -80) return 0;
  return Math.pow(10, db / 20);
}

/** 听者前向向量（单位向量）。yaw=0 -> (0,0,-1)，yaw=90 -> (-1,0,0) */
export function listenerForward(l: ListenerState): Vec3 {
  const yaw = l.yaw * DEG;
  const pitch = l.pitch * DEG;
  const cp = Math.cos(pitch);
  // 俯视几何约定：yaw 绕 +Y 逆时针
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

export function clampPos(p: Vec3): Vec3 {
  return {
    x: clamp(p.x, -POS_LIMIT, POS_LIMIT),
    y: clamp(p.y, -POS_LIMIT, POS_LIMIT),
    z: clamp(p.z, -POS_LIMIT, POS_LIMIT),
  };
}

interface TrackNodes {
  gain: GainNode;
  panner: PannerNode;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
}

type Listener = () => void;

/**
 * 音频引擎：单一状态源（React 通过 useSyncExternalStore 订阅）。
 * 信号链：BufferSource -> trackGain -> PannerNode(HRTF)
 *         -> masterGain -> [Splitter 取 L/R 给峰值表] -> destination
 */
export class Engine {
  project: Project;
  audioState: 'locked' | 'running' | 'suspended' | 'closed' = 'locked';
  isPlaying = false;
  /** 供 React useSyncExternalStore 使用的状态版本号（任何通知都会自增） */
  version = 0;
  startedAt = 0; // ctx.currentTime（一次全局播放的起点）
  transportOffset = 0; // 暂停时保存的全局播放秒数
  projects: ProjectSummary[] = [];

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private meterL: AnalyserNode | null = null;
  private meterR: AnalyserNode | null = null;
  private meterBufL: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(8192));
  private meterBufR: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(8192));
  private peakHold = { l: 0, r: 0 };
  private nodes = new Map<string, TrackNodes>();
  /** 各节点当前的缓冲准备 Promise（解码/生成），首次播放前可 await 保证有声 */
  private pendingPreps = new Map<string, Promise<void>>();
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private ready: Promise<void>;

  constructor() {
    this.project = {
      id: uid(),
      name: '未命名工程',
      updatedAt: Date.now(),
      tracks: [],
      listener: { position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 },
      masterGainDb: 0,
      offsets: {},
    };
    this.ready = this.init();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  // ---------------- 订阅 ----------------

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** 通知 UI；参数类变更同时标记为已修改并防抖落盘 */
  private emit(persist = false) {
    this.version++;
    if (persist) {
      this.dirty = true;
      this.scheduleSave();
    }
    this.listeners.forEach((fn) => fn());
  }

  /** 仅通知 UI（如播放时钟、加载状态），不触发保存 */
  private emitOnly() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  // ---------------- 初始化 / 持久化 ----------------

  private async init() {
    const summaries = await db.listProjects();
    this.projects = summaries;
    const last = summaries[0];
    if (last) {
      try {
        const loaded = await db.loadProject(last.id);
        if (loaded) {
          this.project = loaded;
          // 重启后的安全状态：参数恢复，但绝不自动播放
          this.isPlaying = false;
        }
      } catch {
        // 工程损坏时退回到空工程
      }
    }
    this.emitOnly();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  async save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    this.project.updatedAt = Date.now();
    // 保存前刷新播放偏移，使重载能恢复到停止位置
    if (this.ctx) {
      for (const t of this.project.tracks) {
        this.project.offsets[t.id] = this.currentOffset(t.id);
      }
    }
    await db.saveProject(this.project);
    this.projects = await db.listProjects();
    this.dirty = false;
    this.emitOnly();
  }

  async newProject() {
    await this.stopInternal();
    const p: Project = {
      id: uid(),
      name: '未命名工程',
      updatedAt: Date.now(),
      tracks: [],
      listener: { position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 },
      masterGainDb: 0,
      offsets: {},
    };
    this.project = p;
    this.transportOffset = 0;
    this.dirty = true;
    await this.save();
  }

  async loadProject(id: string) {
    if (id === this.project.id) return;
    await this.stopInternal();
    const loaded = await db.loadProject(id);
    if (!loaded) return;
    this.project = loaded;
    this.isPlaying = false;
    this.transportOffset = 0;
    this.peakHold = { l: 0, r: 0 };
    // 已解锁情况下，为加载进来的轨道重建音频节点（仍不自动播放）
    if (this.ctx) await this.rebuildAfterHydrate();
    this.dirty = false;
    this.emitOnly();
  }

  async deleteProject(id: string) {
    await db.deleteProject(id);
    this.projects = await db.listProjects();
    if (id === this.project.id) {
      await this.newProject();
    }
    this.emitOnly();
  }

  renameProject(name: string) {
    this.project.name = name.trim() || '未命名工程';
    this.emit(true);
  }

  // ---------------- AudioContext / 信号链 ----------------

  /**
   * 在用户手势中解锁音频。失败（浏览器拒绝/设备异常）与“尚未解锁”分开提示。
   */
  async unlock(): Promise<'running' | 'failed'> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        alert('当前浏览器不支持 Web Audio API');
        return 'failed';
      }
      this.ctx = new Ctor();
      this.buildOutputChain();
      await this.rebuildAfterHydrate();
    }
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch {
      this.audioState = 'closed';
      this.emitOnly();
      return 'failed';
    }
    this.audioState = this.ctx.state as typeof this.audioState;
    this.emitOnly();
    return this.ctx.state === 'running' ? 'running' : 'failed';
  }

  private buildOutputChain() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = dbToGain(this.project.masterGainDb);

    this.splitter = ctx.createChannelSplitter(2);
    this.meterL = ctx.createAnalyser();
    this.meterR = ctx.createAnalyser();
    this.meterL.fftSize = 4096;
    this.meterR.fftSize = 4096;
    this.meterBufL = new Float32Array(new ArrayBuffer(this.meterL.fftSize * 4));
    this.meterBufR = new Float32Array(new ArrayBuffer(this.meterR.fftSize * 4));

    // master -> 实际扬声器输出，同时经分路器取真实输出链上的 L/R
    this.master.connect(ctx.destination);
    this.master.connect(this.splitter);
    this.splitter.connect(this.meterL, 0);
    this.splitter.connect(this.meterR, 1);
  }

  /** 为全部轨道创建/重建节点（用于解锁与工程切换后的数据补水） */
  private async rebuildAfterHydrate() {
    if (!this.ctx) return;
    for (const n of this.nodes.values()) {
      try {
        n.source?.stop();
      } catch {
        /* noop */
      }
      n.panner.disconnect();
      n.gain.disconnect();
    }
    this.nodes.clear();
    this.pendingPreps.clear();

    for (const t of this.project.tracks) {
      const nodes = this.createTrackNodes(t);
      this.nodes.set(t.id, nodes);
      this.pendingPreps.set(t.id, this.prepareBuffer(t, nodes));
    }
    this.applyListener();
    this.emitOnly();
  }

  private createTrackNodes(t: TrackState): TrackNodes {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = this.effectiveGain(t);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    // 明确的距离衰减：线性模型 + 明确的近/远阈值与参考距离
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = RANGE_LIMIT;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360; // 全指向声源
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    this.writePannerPosition(panner, t.position);
    gain.connect(panner);
    panner.connect(this.master!);
    return { gain, panner, buffer: null, source: null };
  }

  private writePannerPosition(panner: PannerNode, p: Vec3) {
    // 优先使用 AudioParam（位置与坐标系定义一致地直接写入）
    type PosPanner = PannerNode & {
      positionX?: AudioParam;
      positionY?: AudioParam;
      positionZ?: AudioParam;
    };
    const pp = panner as PosPanner;
    if (pp.positionX) {
      pp.positionX.value = p.x;
      pp.positionY.value = p.y;
      pp.positionZ.value = p.z;
    } else {
      // 旧版回退：setPosition 与 AudioListener.setOrientation 使用同一右手坐标系
      panner.setPosition(p.x, p.y, p.z);
    }
  }

  private async prepareBuffer(t: TrackState, n: TrackNodes) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (t.kind === 'file') {
      const blob = await db.getAudioBlob(t.id);
      if (!blob) {
        t.status = 'error';
        t.error = '本地音频数据缺失（IndexedDB 中未找到）';
        this.emitOnly();
        return;
      }
      t.status = 'loading';
      this.emitOnly();
      try {
        const buf = await blob.arrayBuffer();
        // 解码失败在此捕获并标记，不影响其他轨道
        const decoded = await ctx.decodeAudioData(buf);
        n.buffer = decoded;
        t.durationSec = decoded.duration;
        t.status = 'ready';
        t.error = undefined;
      } catch (err) {
        t.status = 'error';
        t.error = `解码失败：${err instanceof Error ? err.message : '浏览器无法解码该文件'}`;
      }
      this.emitOnly();
    } else {
      try {
        const decoded = await generateSampleBuffer(ctx, t.sample!.type!, {
          frequency: t.sample?.frequency,
          intervalSec: t.sample?.intervalSec,
        });
        n.buffer = decoded;
        t.durationSec = decoded.duration;
        t.status = 'ready';
        t.error = undefined;
      } catch (err) {
        t.status = 'error';
        t.error = `样例生成失败：${err instanceof Error ? err.message : String(err)}`;
      }
      this.emitOnly();
    }
    this.pendingPreps.delete(t.id);
  }

  // ---------------- 播放 / 停止 / 同步 ----------------

  async play() {
    if ((await this.unlock()) !== 'running') return;
    if (this.isPlaying) return;
    // 首次解锁后节点缓冲可能仍在解码/生成：等待它们就绪（错误轨会自动跳过）
    await Promise.all(this.pendingPreps.values()).catch(() => undefined);
    const ctx = this.ctx!;
    let maxDur = 0;
    for (const t of this.project.tracks) {
      const n = this.nodes.get(t.id);
      if (!n || !n.buffer || t.status !== 'ready') continue;
      // 每条轨道都新建 source —— 这是唯一需要 (重新)start 的时机；
      // 之后移动声源只改 panner 参数，不触碰 source。
      const source = ctx.createBufferSource();
      source.buffer = n.buffer;
      source.loop = t.loop;
      source.connect(n.gain);
      const offset = this.project.offsets[t.id] ?? 0;
      const startOffset = t.loop
        ? offset % Math.max(n.buffer.duration, 0.0001)
        : Math.min(offset, Math.max(n.buffer.duration - 0.02, 0));
      source.start(0, startOffset);
      n.source = source;
      maxDur = Math.max(maxDur, n.buffer.duration - startOffset);
    }
    if (maxDur === 0) {
      // 没有任何可播放轨道：保持停止，不伪造播放状态
      return;
    }
    this.startedAt = ctx.currentTime;
    this.isPlaying = true;
    this.peakHold = { l: 0, r: 0 };
    this.emitOnly();
  }

  currentOffset(trackId: string): number {
    const t = this.project.tracks.find((x) => x.id === trackId);
    const n = this.nodes.get(trackId);
    if (!this.ctx || !t || !n?.buffer) return this.project.offsets[trackId] ?? 0;
    const base = this.project.offsets[trackId] ?? 0;
    if (!this.isPlaying) return base;
    const elapsed = this.ctx.currentTime - this.startedAt + base;
    if (t.loop) return elapsed;
    return Math.min(elapsed, n.buffer.duration);
  }

  /** 全局传输时钟（秒）：暂停偏移 + 本次播放流逝时间 */
  transportTime(): number {
    if (!this.ctx) return 0;
    if (!this.isPlaying) return this.transportOffset;
    return this.transportOffset + (this.ctx.currentTime - this.startedAt);
  }

  async pause() {
    if (!this.isPlaying) return;
    await this.stopInternal(true);
    this.emit(true);
  }

  async stop() {
    await this.stopInternal(false);
    this.emit(true);
  }

  /** 停止全部 source；keepOffset=false 时把偏移归零 */
  private async stopInternal(keepOffset = false) {
    if (!this.ctx) {
      this.isPlaying = false;
      if (!keepOffset) {
        this.project.offsets = {};
        this.transportOffset = 0;
      }
      return;
    }
    if (this.isPlaying && keepOffset) {
      for (const t of this.project.tracks) {
        this.project.offsets[t.id] = this.currentOffset(t.id);
      }
      this.transportOffset += this.ctx.currentTime - this.startedAt;
    }
    if (!keepOffset) {
      this.project.offsets = {};
      this.transportOffset = 0;
    }
    for (const n of this.nodes.values()) {
      try {
        n.source?.stop();
      } catch {
        /* 已停止 */
      }
      n.source = null;
    }
    this.isPlaying = false;
    if (this.ctx.state === 'running') {
      this.audioState = 'running';
    }
  }

  // ---------------- 轨道参数（实时生效） ----------------

  /** 独奏优先逻辑：存在独奏轨时，仅独奏轨可闻；静音总是生效 */
  private soloActive(): boolean {
    return this.project.tracks.some((t) => t.solo);
  }

  private effectiveGain(t: TrackState): number {
    if (t.muted) return 0;
    if (this.soloActive() && !t.solo) return 0;
    return dbToGain(t.gainDb);
  }

  private refreshTrackGain(changed?: TrackState) {
    const apply = (t: TrackState) => {
      const n = this.nodes.get(t.id);
      if (n && this.ctx) {
        // setTargetAtTime 给 5ms 过渡，避免点击声
        n.gain.gain.setTargetAtTime(
          this.effectiveGain(t),
          this.ctx.currentTime,
          0.005,
        );
      }
    };
    if (changed) {
      apply(changed);
      // 独奏开关会影响其他轨的有效增益
      if (changed.solo) this.project.tracks.forEach(apply);
    } else {
      this.project.tracks.forEach(apply);
    }
  }

  setMasterGain(db: number) {
    this.project.masterGainDb = db;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        dbToGain(db),
        this.ctx.currentTime,
        0.005,
      );
    }
    this.emit(true);
  }

  setTrackPosition(id: string, p: Partial<Vec3>) {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    t.position = clampPos({ ...t.position, ...p });
    const n = this.nodes.get(id);
    // 关键：只更新 panner 的位置参数，绝不重启 BufferSource
    if (n) this.writePannerPosition(n.panner, t.position);
    this.emit(true);
  }

  setTrackGain(id: string, db: number) {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    t.gainDb = db;
    this.refreshTrackGain(t);
    this.emit(true);
  }

  toggleMute(id: string) {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    t.muted = !t.muted;
    this.refreshTrackGain(t);
    this.emit(true);
  }

  toggleSolo(id: string) {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    t.solo = !t.solo;
    this.refreshTrackGain();
    this.emit(true);
  }

  toggleLoop(id: string) {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    t.loop = !t.loop;
    const n = this.nodes.get(id);
    if (n?.source) n.source.loop = t.loop;
    this.emit(true);
  }

  renameTrack(id: string, name: string) {
    const t = this.project.tracks.find((x) => x.id === id);
    if (!t) return;
    t.name = name.trim() || t.name;
    this.emit(true);
  }

  removeTrack(id: string) {
    const n = this.nodes.get(id);
    if (n) {
      try {
        n.source?.stop();
      } catch {
        /* noop */
      }
      n.panner.disconnect();
      n.gain.disconnect();
      this.nodes.delete(id);
      this.pendingPreps.delete(id);
    }
    delete this.project.offsets[id];
    void db.deleteAudioBlob(id);
    this.project.tracks = this.project.tracks.filter((t) => t.id !== id);
    this.emit(true);
  }

  // ---------------- 听者（与 3D/2D 使用同一坐标系） ----------------

  setListener(p: Partial<ListenerState>) {
    const next: ListenerState = {
      position: p.position
        ? clampPos({ ...this.project.listener.position, ...p.position })
        : this.project.listener.position,
      yaw: p.yaw ?? this.project.listener.yaw,
      pitch: p.pitch ?? this.project.listener.pitch,
    };
    this.project.listener = next;
    this.applyListener();
    this.emit(true);
  }

  private applyListener() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const { position, yaw, pitch } = this.project.listener;
    const f = listenerForward(this.project.listener);
    // 上方向向量：随 pitch 倾斜，roll 始终为 0
    const up: Vec3 = {
      x: Math.sin(yaw * DEG) * Math.sin(pitch * DEG),
      y: Math.cos(pitch * DEG),
      z: Math.cos(yaw * DEG) * Math.sin(pitch * DEG),
    };
    type LegacyListener = AudioListener & {
      setPosition?: (x: number, y: number, z: number) => void;
      setOrientation?: (
        fx: number, fy: number, fz: number,
        ux: number, uy: number, uz: number,
      ) => void;
    };
    const l = ctx.listener as AudioListener & {
      positionX?: AudioParam;
      forwardX?: AudioParam;
      upX?: AudioParam;
    };
    if (l.positionX) {
      l.positionX.value = position.x;
      l.positionY!.value = position.y;
      l.positionZ!.value = position.z;
      l.forwardX!.value = f.x;
      l.forwardY!.value = f.y;
      l.forwardZ!.value = f.z;
      l.upX!.value = up.x;
      l.upY!.value = up.y;
      l.upZ!.value = up.z;
    } else {
      const legacy = ctx.listener as LegacyListener;
      legacy.setPosition?.(position.x, position.y, position.z);
      legacy.setOrientation?.(f.x, f.y, f.z, up.x, up.y, up.z);
    }
  }

  // ---------------- 新增轨道 ----------------

  private addTrackState(t: TrackState, persist = true) {
    this.project.tracks.push(t);
    if (this.ctx) {
      const n = this.createTrackNodes(t);
      this.nodes.set(t.id, n);
      this.pendingPreps.set(t.id, this.prepareBuffer(t, n));
    }
    this.emit(persist);
  }

  addSampleTrack(type: 'impulse' | 'tone') {
    const presets: Record<string, Partial<TrackState>> = {
      impulse: {
        name: '脉冲（每秒1次）',
        sample: { type: 'impulse', intervalSec: 1 },
      },
      tone: {
        name: '单音 1000Hz（循环）',
        sample: { type: 'tone', frequency: 1000 },
      },
    };
    const colors = ['#ff7849', '#49b6ff', '#9d7bff', '#38d39a', '#f5c542', '#ff6b9d'];
    const t: TrackState = {
      id: uid(),
      name: presets[type].name!,
      kind: type === 'impulse' ? 'sample-impulse' : 'sample-tone',
      position: clampPos({ x: 0, y: 1.6, z: -3 }),
      gainDb: 0,
      muted: false,
      solo: false,
      loop: true,
      color: colors[this.project.tracks.length % colors.length],
      status: 'pending',
      sample: presets[type].sample,
    };
    this.addTrackState(t);
  }

  /** 导入本地文件：只读入浏览器（IndexedDB 存原始数据），不上传任何内容 */
  async importFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const colors = ['#ff7849', '#49b6ff', '#9d7bff', '#38d39a', '#f5c542', '#ff6b9d'];
    for (const file of files) {
      const id = uid();
      const idx = this.project.tracks.length;
      const t: TrackState = {
        id,
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: 'file',
        position: clampPos({
          x: idx % 2 === 0 ? -3 : 3,
          y: 1.6,
          z: -2 - idx,
        }),
        gainDb: 0,
        muted: false,
        solo: false,
        loop: true,
        color: colors[idx % colors.length],
        status: 'pending',
      };
      this.project.tracks.push(t);
      // 先把原始数据存入 IndexedDB，再建解码节点（避免竞态导致“数据缺失”误报）
      await db.putAudioBlob(id, file);
      if (this.ctx) {
        const n = this.createTrackNodes(t);
        this.nodes.set(t.id, n);
        this.pendingPreps.set(t.id, this.prepareBuffer(t, n));
      }
    }
    this.dirty = true;
    this.scheduleSave();
    this.emitOnly();
  }

  // ---------------- 峰值表（挂在实际输出链 master->splitter 之后） ----------------

  getPeaks(): { l: number; r: number; clipL: boolean; clipR: boolean } {
    const scan = (an: AnalyserNode | null, buf: Float32Array<ArrayBuffer>): number => {
      if (!an) return 0;
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
      }
      return peak;
    };
    const l = scan(this.meterL, this.meterBufL);
    const r = scan(this.meterR, this.meterBufR);
    const CLIP = 0.9999;
    if (l >= CLIP) this.peakHold.l = 1;
    if (r >= CLIP) this.peakHold.r = 1;
    return { l, r, clipL: this.peakHold.l >= 1, clipR: this.peakHold.r >= 1 };
  }

  resetClip() {
    this.peakHold = { l: 0, r: 0 };
    this.emitOnly();
  }
}

export const engine = new Engine();
