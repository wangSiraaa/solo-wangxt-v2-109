/**
 * AudioEngine —— Web Audio 核心，与 React 状态解耦。
 *
 * 信号链（每条声轨）：
 *   AudioBufferSourceNode ──► [ChannelSplitter 选取单声道]
 *      ──► trackGain ──► PannerNode(HRTF + 明确距离模型) ──► soloBus ──► busGain
 *                                          └（非独奏/静音）──► muteBus(增益0) ──┘
 *                                                                              ▼
 *                                                        masterGain ─► peakWorklet(逐采样峰值/削波)
 *                                                                              ├► AnalyserNode(回退表)
 *                                                                              └► AudioDestination
 *
 * 关键约定：
 *  - 移动声源只更新 PannerNode 的 position AudioParam（setTargetAtTime 平滑），
 *    绝不 stop/start 源节点，因此移动不会重启音轨。
 *  - 静音 = trackGain.gain=0；独奏通过 soloBus/muteBus 真实切换路由。
 *  - 峰值/削波在实际输出链末端（destination 之前）由 AudioWorklet 逐采样检测；
 *    Worklet 不可用时回退到 AnalyserNode 时域峰值（同样在输出链上）。
 *  - AudioContext 必须由用户手势解锁；解码失败逐条声轨以 DecodeError 上报。
 */
import type {
  LevelState,
  ListenerState,
  SpatialSettings,
  Track,
  UnlockState,
} from '../types';
import { forwardVector } from './spatial';
import { createSampleBuffer } from './samples';

interface TrackVoice {
  trackId: string;
  spec: Track;
  source: AudioBufferSourceNode;
  trackGain: GainNode;
  panner: PannerNode;
  /** true = 接在 soloBus（可听见）；false = 接在增益为 0 的 muteBus */
  audiblyRouted: boolean;
  playing: boolean;
  consumed: boolean; // source 是否已 start 过（结束后必须重建才能再播）
  startedAt: number;
  offset: number;
  duration: number;
}

export type EngineUnlockListener = (state: UnlockState) => void;
export type EngineLevelListener = (level: LevelState) => void;
export type EngineEndedListener = (trackId: string) => void;

export class DecodeError extends Error {
  trackId: string;
  constructor(trackId: string, message: string) {
    super(message);
    this.name = 'DecodeError';
    this.trackId = trackId;
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  unlock: UnlockState = 'locked';

  private busGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private soloBus: GainNode | null = null;
  private muteBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomainBuf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(8192));
  private peakWorklet: AudioWorkletNode | null = null;
  private workletFailed = false;

  private voices = new Map<string, TrackVoice>();
  private buffers = new Map<string, AudioBuffer>();
  private pendingFiles = new Map<string, Blob>();

  private spatial: SpatialSettings | null = null;
  private anySolo = false;

  private unlockListeners = new Set<EngineUnlockListener>();
  private levelListeners = new Set<EngineLevelListener>();
  private endedListeners = new Set<EngineEndedListener>();
  private rafHandle = 0;
  private clipLatchL = false;
  private clipLatchR = false;
  private lastPeak: LevelState = { l: 0, r: 0, clipL: false, clipR: false };

  onUnlock(fn: EngineUnlockListener): () => void {
    this.unlockListeners.add(fn);
    fn(this.unlock);
    return () => {
      this.unlockListeners.delete(fn);
    };
  }
  onLevels(fn: EngineLevelListener): () => void {
    this.levelListeners.add(fn);
    return () => {
      this.levelListeners.delete(fn);
    };
  }
  onEnded(fn: EngineEndedListener): () => void {
    this.endedListeners.add(fn);
    return () => {
      this.endedListeners.delete(fn);
    };
  }

  private emitUnlock() {
    this.unlockListeners.forEach((fn) => fn(this.unlock));
  }

  /** 必须在用户手势中调用；与“未解锁”分别上报明确的失败状态 */
  async resume(): Promise<void> {
    if (this.unlock === 'unlocked' && this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.unlock = 'unlocking';
    this.emitUnlock();
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('当前浏览器不支持 Web Audio API');
      const ctx = new Ctor();
      this.ctx = ctx;
      this.buildGraph(ctx);
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') {
        throw new Error('AudioContext 被浏览器策略阻止，未能进入 running 状态');
      }
      this.unlock = 'unlocked';
      this.emitUnlock();
      this.startMeterLoop();
      void this.ensurePeakWorklet(ctx);
    } catch (err) {
      this.unlock = 'failed';
      this.emitUnlock();
      throw err;
    }
  }

  private buildGraph(ctx: AudioContext) {
    this.soloBus = ctx.createGain();
    this.muteBus = ctx.createGain();
    this.muteBus.gain.value = 0;
    this.busGain = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.timeDomainBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    this.soloBus.connect(this.busGain);
    this.muteBus.connect(this.busGain);
    this.busGain.connect(this.masterGain);
    // 先经过 analyser（回退表）；worklet 加载成功后串入 master 与 destination 之间
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  /**
   * 峰值/削波检测器串联在 masterGain 之后、destination 之前的真实输出链上，
   * 逐采样扫描。Worklet 源码以 Blob 注入，无需额外网络资源。
   */
  private async ensurePeakWorklet(ctx: AudioContext): Promise<boolean> {
    if (this.peakWorklet || this.workletFailed) return !!this.peakWorklet;
    try {
      const workletSource = `
class PeakMeterProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const in0 = inputs[0];
    const out0 = outputs[0];
    if (!in0 || in0.length === 0) {
      // 上游静默优化时输出保持零填充即可
      return true;
    }
    let peakL = 0, peakR = 0, clipL = false, clipR = false;
    const l = in0[0];
    const r = in0[1] || in0[0];
    const ol = out0[0];
    const or = out0[1] || out0[0];
    for (let i = 0; i < l.length; i++) {
      const vl = l[i];
      const al = Math.abs(vl);
      if (al > peakL) peakL = al;
      if (al >= 1.0) clipL = true;
      if (ol) ol[i] = vl; // 必须显式透传，否则输出静音
    }
    if (r && or) for (let i = 0; i < r.length; i++) {
      const vr = r[i];
      const ar = Math.abs(vr);
      if (ar > peakR) peakR = ar;
      if (ar >= 1.0) clipR = true;
      if (out0[1]) or[i] = vr;
    }
    this.port.postMessage({ l: peakL, r: peakR, clipL, clipR });
    return true;
  }
}
registerProcessor('peak-meter', PeakMeterProcessor);
`;
      const blob = new Blob([workletSource], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }

      const node = new AudioWorkletNode(ctx, 'peak-meter', {
        // 节点串在真实输出链上：必须保持立体声直通，避免被下混成单声道
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.channelCount = 2;
      node.channelInterpretation = 'speakers';
      // 重排实际链路：masterGain -> peakWorklet -> analyser -> destination
      this.masterGain!.disconnect();
      this.masterGain!.connect(node);
      this.analyser!.disconnect();
      node.connect(this.analyser!);
      this.analyser!.connect(ctx.destination);
      node.port.onmessage = (e: MessageEvent<LevelState>) => {
        const d = e.data;
        if (d.clipL) this.clipLatchL = true;
        if (d.clipR) this.clipLatchR = true;
        this.lastPeak = { l: d.l, r: d.r, clipL: this.clipLatchL, clipR: this.clipLatchR };
      };
      this.peakWorklet = node;
      return true;
    } catch {
      this.workletFailed = true;
      return false;
    }
  }

  clearClipLatch() {
    this.clipLatchL = false;
    this.clipLatchR = false;
  }

  private startMeterLoop() {
    const tick = () => {
      if (!this.peakWorklet && this.analyser) {
        // 回退：AnalyserNode 时域块峰值，仍挂在真实输出链上
        this.analyser.getFloatTimeDomainData(this.timeDomainBuf);
        let peak = 0;
        for (let i = 0; i < this.timeDomainBuf.length; i++) {
          const a = Math.abs(this.timeDomainBuf[i]);
          if (a > peak) peak = a;
        }
        if (peak >= 1) {
          this.clipLatchL = true;
          this.clipLatchR = true;
        }
        this.lastPeak = {
          l: peak,
          r: peak,
          clipL: this.clipLatchL,
          clipR: this.clipLatchR,
        };
      }
      const p = this.lastPeak;
      this.levelListeners.forEach((fn) => fn({ ...p }));
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  // ---------- 全局参数 ----------

  setSpatialSettings(s: SpatialSettings) {
    this.spatial = s;
    if (!this.ctx) return;
    for (const v of this.voices.values()) {
      v.panner.distanceModel = s.distanceModel;
      v.panner.refDistance = s.refDistance;
      v.panner.rolloffFactor = s.rolloffFactor;
      v.panner.maxDistance = s.maxDistance;
    }
  }

  setBusGain(g: number) {
    if (this.busGain && this.ctx) {
      this.busGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    }
  }

  setMasterGain(g: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    }
  }

  /** 听者位置/朝向；朝向定义与 spatial.ts、Three.js 相机严格一致 */
  setListener(l: ListenerState) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = forwardVector(l.yaw, l.pitch);
    const u = localUp(l.yaw, l.pitch);
    const li = this.ctx.listener;
    const set = (p: AudioParam | undefined, v: number) => {
      if (p) p.setTargetAtTime(v, t, 0.02);
    };
    set(li.positionX, l.position.x);
    set(li.positionY, l.position.y);
    set(li.positionZ, l.position.z);
    set(li.forwardX, f.x);
    set(li.forwardY, f.y);
    set(li.forwardZ, f.z);
    set(li.upX, u.x);
    set(li.upY, u.y);
    set(li.upZ, u.z);
  }

  // ---------- 声轨缓冲与节点 ----------

  /**
   * 确保声轨缓冲与节点就绪。
   * 已存在的 voice 只做实时参数更新（位置/增益/路由/loop），绝不重启源。
   */
  async ensureTrack(track: Track): Promise<void> {
    if (!this.ctx || this.unlock !== 'unlocked') return;

    let buffer = this.buffers.get(track.id);
    if (!buffer) {
      if (track.sourceType === 'file') {
        const blob = this.pendingFiles.get(track.id);
        if (!blob) return; // Blob 尚未由 UI 从 IndexedDB 注入
        try {
          const arr = await blob.arrayBuffer();
          // slice(0)：decodeAudioData 会 detach ArrayBuffer，保留原始 Blob 不受影响
          buffer = await this.ctx.decodeAudioData(arr.slice(0));
        } catch (err) {
          throw new DecodeError(
            track.id,
            `音频解码失败：${err instanceof Error ? err.message : '不支持的编码或文件损坏'}`,
          );
        }
      } else {
        buffer = createSampleBuffer(this.ctx, track.sourceType);
      }
      this.buffers.set(track.id, buffer);
    }

    const existing = this.voices.get(track.id);
    if (!existing) {
      this.voices.set(track.id, this.createVoice(track, buffer));
    } else {
      this.updateVoiceLive(existing, track);
    }
  }

  /** 文件 Blob 在解锁后由 UI 层提供（来自 IndexedDB，全程本地） */
  setFileBlob(trackId: string, blob: Blob) {
    this.pendingFiles.set(trackId, blob);
  }

  dropBuffer(trackId: string) {
    this.buffers.delete(trackId);
  }

  private createVoice(track: Track, buffer: AudioBuffer): TrackVoice {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = track.loop;

    const trackGain = ctx.createGain();
    trackGain.gain.value = track.muted ? 0 : track.gain;

    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: this.spatial?.distanceModel ?? 'inverse',
      refDistance: this.spatial?.refDistance ?? 1,
      rolloffFactor: this.spatial?.rolloffFactor ?? 1,
      maxDistance: this.spatial?.maxDistance ?? 100,
      positionX: track.position.x,
      positionY: track.position.y,
      positionZ: track.position.z,
    });

    // 立体声文件：HRTF 需要单声道输入，显式选取文件原始左/右声道
    if (buffer.numberOfChannels <= 1) {
      source.connect(trackGain);
    } else {
      const splitter = ctx.createChannelSplitter(buffer.numberOfChannels);
      source.connect(splitter);
      const ch = Math.min(track.channel, buffer.numberOfChannels - 1);
      // splitter 单口输出为单声道，接入立体声 gain 时浏览器自动等声级上混
      splitter.connect(trackGain, ch);
    }
    trackGain.connect(panner);

    const audible = this.shouldBeAudible(track);
    panner.connect(audible ? this.soloBus! : this.muteBus!);

    const voice: TrackVoice = {
      trackId: track.id,
      spec: track,
      source,
      trackGain,
      panner,
      audiblyRouted: audible,
      playing: false,
      consumed: false,
      startedAt: 0,
      offset: 0,
      duration: buffer.duration,
    };

    source.onended = () => {
      if (!voice.playing) return; // stop() 触发的 onended 忽略
      const latest = voice.spec;
      voice.playing = false;
      voice.consumed = true;
      voice.offset = 0;
      // 以最新参数立即重建待播 voice，保证自然结束后再次按播放不会对已结束 source start
      const fresh = this.createVoice(latest, buffer);
      fresh.offset = 0;
      this.voices.set(track.id, fresh);
      this.endedListeners.forEach((fn) => fn(track.id));
    };
    return voice;
  }

  private shouldBeAudible(track: Track): boolean {
    if (track.muted) return false;
    if (this.anySolo) return track.solo;
    return true;
  }

  /** 实时参数更新：不触碰 source 节点 —— 移动声源不会重启音轨 */
  private updateVoiceLive(voice: TrackVoice, track: Track) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const tau = Math.max(0.005, this.spatial?.positionTimeConstant ?? 0.05);

    voice.panner.positionX.setTargetAtTime(track.position.x, t, tau);
    voice.panner.positionY.setTargetAtTime(track.position.y, t, tau);
    voice.panner.positionZ.setTargetAtTime(track.position.z, t, tau);
    voice.panner.distanceModel = this.spatial?.distanceModel ?? voice.panner.distanceModel;

    voice.trackGain.gain.setTargetAtTime(track.muted ? 0 : track.gain, t, 0.01);
    if (voice.source.loop !== track.loop) voice.source.loop = track.loop;

    const audible = this.shouldBeAudible(track);
    if (audible !== voice.audiblyRouted) {
      voice.panner.disconnect();
      voice.panner.connect(audible ? this.soloBus! : this.muteBus!);
      voice.audiblyRouted = audible;
    }
    voice.spec = track;
  }

  /** 静音/独奏变化：重新评估全部路由（增益本身在 updateVoiceLive 中已设置） */
  reevaluateRouting(tracks: Track[]) {
    this.anySolo = tracks.some((t) => t.solo);
    if (!this.ctx) return;
    for (const tr of tracks) {
      const v = this.voices.get(tr.id);
      if (!v) continue;
      const audible = this.shouldBeAudible(tr);
      if (audible !== v.audiblyRouted) {
        v.panner.disconnect();
        v.panner.connect(audible ? this.soloBus! : this.muteBus!);
        v.audiblyRouted = audible;
      }
      v.trackGain.gain.setTargetAtTime(tr.muted ? 0 : tr.gain, this.ctx.currentTime, 0.01);
      v.spec = tr;
    }
  }

  /**
   * 高频实时同步：对已存在的 voice 更新位置/增益/loop/独奏路由。
   * 不创建节点、不触碰 source，移动声源不会重启音轨。
   * 尚未创建 voice 的声轨（未解锁/未解码）跳过，由 ensureTrack 负责。
   */
  syncTracks(tracks: Track[]) {
    if (!this.ctx) return;
    this.anySolo = tracks.some((t) => t.solo);
    for (const tr of tracks) {
      const v = this.voices.get(tr.id);
      if (v) this.updateVoiceLive(v, tr);
    }
  }

  getChannelCount(trackId: string): number | null {
    return this.buffers.get(trackId)?.numberOfChannels ?? null;
  }

  /**
   * 重建声轨输入图（切换立体声文件的 L/R 声道时使用）。
   * 保持播放偏移；若原本在播放，从同一位置继续（声道选择本身不属于“移动”）。
   */
  async rebuildVoiceGraph(track: Track): Promise<void> {
    await this.ensureTrack(track);
    const old = this.voices.get(track.id);
    const buf = this.buffers.get(track.id);
    if (!old || !buf) return;
    const wasPlaying = old.playing;
    const offset = wasPlaying ? this.currentOffset(old) : old.offset;
    const nv = this.replaceVoice(old, track, buf, offset);
    if (wasPlaying) {
      nv.source.start(this.ctx!.currentTime, offset);
      nv.startedAt = this.ctx!.currentTime;
      nv.playing = true;
      nv.consumed = true;
    }
  }

  // ---------- 传输控制 ----------

  async playTrack(track: Track): Promise<void> {
    await this.ensureTrack(track);
    let voice = this.voices.get(track.id);
    if (!voice) return;
    if (voice.playing) return;
    if (voice.consumed) {
      // 自然结束后未被 onended 重建的兜底
      const buf = this.buffers.get(track.id)!;
      voice = this.replaceVoice(voice, track, buf, voice.offset);
    }
    const ctx = this.ctx!;
    voice.source.start(ctx.currentTime, voice.offset % voice.duration);
    voice.startedAt = ctx.currentTime;
    voice.playing = true;
    voice.consumed = true;
  }

  pauseTrack(track: Track) {
    const voice = this.voices.get(track.id);
    if (!voice || !voice.playing) return;
    voice.offset = this.currentOffset(voice);
    this.replaceVoice(voice, track, this.buffers.get(track.id)!, voice.offset);
  }

  stopTrack(track: Track) {
    const voice = this.voices.get(track.id);
    if (!voice) return;
    if (voice.playing || voice.consumed) {
      this.replaceVoice(voice, track, this.buffers.get(track.id)!, 0);
    } else {
      voice.offset = 0;
    }
  }

  /** 跳转：offsetSec 秒处；autoplay=true 时立即继续播放 */
  async seekTrack(track: Track, offsetSec: number, autoplay: boolean) {
    await this.ensureTrack(track);
    const voice = this.voices.get(track.id);
    const buf = this.buffers.get(track.id);
    if (!voice || !buf) return;
    const offset = track.loop
      ? ((offsetSec % buf.duration) + buf.duration) % buf.duration
      : Math.min(Math.max(0, offsetSec), buf.duration);
    const nv = this.replaceVoice(voice, track, buf, offset);
    if (autoplay) {
      nv.source.start(this.ctx!.currentTime, offset);
      nv.startedAt = this.ctx!.currentTime;
      nv.playing = true;
      nv.consumed = true;
    }
  }

  /**
   * 停止旧节点并按最新参数重建（仅用于暂停/停止/跳转）。
   * 位置移动严禁走此路径。
   */
  private replaceVoice(
    old: TrackVoice,
    track: Track,
    buffer: AudioBuffer,
    offset: number,
  ): TrackVoice {
    try {
      old.source.onended = null;
      old.source.stop();
    } catch {
      /* 已停止 */
    }
    old.source.disconnect();
    old.trackGain.disconnect();
    old.panner.disconnect();
    const nv = this.createVoice(track, buffer);
    nv.offset = offset;
    this.voices.set(track.id, nv);
    return nv;
  }

  private currentOffset(v: TrackVoice): number {
    let p = v.offset + (this.ctx!.currentTime - v.startedAt);
    p = v.spec.loop ? ((p % v.duration) + v.duration) % v.duration : Math.min(p, v.duration);
    return p;
  }

  removeTrack(trackId: string) {
    const voice = this.voices.get(trackId);
    if (voice) {
      try {
        voice.source.onended = null;
        voice.source.stop();
      } catch {
        /* ignore */
      }
      voice.source.disconnect();
      voice.trackGain.disconnect();
      voice.panner.disconnect();
    }
    this.voices.delete(trackId);
    this.buffers.delete(trackId);
    this.pendingFiles.delete(trackId);
  }

  getProgress(trackId: string): number | null {
    const v = this.voices.get(trackId);
    if (!v) return null;
    return v.playing ? this.currentOffset(v) : v.offset;
  }

  getDuration(trackId: string): number | null {
    return this.buffers.get(trackId)?.duration ?? null;
  }

  isPlaying(trackId: string): boolean {
    return this.voices.get(trackId)?.playing ?? false;
  }

  dispose() {
    cancelAnimationFrame(this.rafHandle);
    for (const id of [...this.voices.keys()]) this.removeTrack(id);
    void this.ctx?.close();
    this.ctx = null;
    this.unlock = 'locked';
  }
}

/**
 * 听者本地 +Y(上) 经 yaw(绕世界Y，正值右转) 与 pitch(绕本地右向量，正值抬头)
 * 后的世界上方向量。满足 right = forward × up。
 */
function localUp(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // 抬头时头顶略向 +Z（听者身后）倾；再绕世界 Y 按“右转”约定施加 yaw
  return {
    x: -sp * Math.sin(yaw),
    y: cp,
    z: sp * Math.cos(yaw),
  };
}
