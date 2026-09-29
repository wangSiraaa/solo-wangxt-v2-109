var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/spatial.ts
function forwardVector(yaw, pitch = 0) {
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch)
  };
}
var init_spatial = __esm({
  "src/lib/spatial.ts"() {
    "use strict";
  }
});

// src/lib/samples.ts
var samples_exports = {};
__export(samples_exports, {
  SAMPLE_LABELS: () => SAMPLE_LABELS,
  createDuoBuffer: () => createDuoBuffer,
  createPulseBuffer: () => createPulseBuffer,
  createSampleBuffer: () => createSampleBuffer,
  createToneBuffer: () => createToneBuffer
});
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function createPulseBuffer(ctx) {
  const sr = ctx.sampleRate;
  const dur = 1.6;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const data = buf.getChannelData(0);
  const pulseStarts = [0.05, 0.55, 1.05];
  for (const start of pulseStarts) {
    const s0 = Math.floor(start * sr);
    const n = Math.floor(0.05 * sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.pow(1 - i / n, 1.6);
      data[s0 + i] = Math.sin(2 * Math.PI * 1200 * t) * env * 0.9;
    }
  }
  return buf;
}
function createToneBuffer(ctx) {
  const sr = ctx.sampleRate;
  const dur = 3;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const data = buf.getChannelData(0);
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fade = Math.min(1, t / 0.02, (dur - t) / 0.05);
    data[i] = Math.sin(2 * Math.PI * 440 * t) * 0.5 * fade;
  }
  return buf;
}
function createDuoBuffer(ctx, _variant) {
  const sr = ctx.sampleRate;
  const dur = 4;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const data = buf.getChannelData(0);
  const rand = mulberry32(20260929);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const noise = (rand() * 2 - 1) * 0.18;
    const tone = Math.sin(2 * Math.PI * 330 * t) * 0.28;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
    const fade = Math.min(1, t / 0.05, (dur - t) / 0.1);
    data[i] = (noise + tone) * (0.6 + 0.4 * lfo) * fade;
  }
  return buf;
}
function createSampleBuffer(ctx, type) {
  switch (type) {
    case "pulse":
      return createPulseBuffer(ctx);
    case "tone":
      return createToneBuffer(ctx);
    case "duoA":
      return createDuoBuffer(ctx, "A");
    case "duoB":
      return createDuoBuffer(ctx, "B");
    default:
      throw new Error(`\u975E\u5185\u7F6E\u6837\u4F8B\u7C7B\u578B: ${type}`);
  }
}
var SAMPLE_LABELS;
var init_samples = __esm({
  "src/lib/samples.ts"() {
    "use strict";
    SAMPLE_LABELS = {
      pulse: "\u8109\u51B2\u6837\u4F8B\uFF08\u65B9\u4F4D\u6D4B\u8BD5\uFF09",
      tone: "\u5355\u97F3\u6837\u4F8B\uFF08\u58F0\u50CF/\u8DDD\u79BB\uFF09",
      duoA: "\u53CC\u58F0\u6E90 A\uFF08\u540C\u6B65\u5DE6\uFF09",
      duoB: "\u53CC\u58F0\u6E90 B\uFF08\u540C\u6B65\u53F3\uFF09"
    };
  }
});

// src/lib/audioEngine.ts
var audioEngine_exports = {};
__export(audioEngine_exports, {
  AudioEngine: () => AudioEngine,
  DecodeError: () => DecodeError
});
function localUp(yaw, pitch) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x: -sp * Math.sin(yaw),
    y: cp,
    z: sp * Math.cos(yaw)
  };
}
var DecodeError, AudioEngine;
var init_audioEngine = __esm({
  "src/lib/audioEngine.ts"() {
    "use strict";
    init_spatial();
    init_samples();
    DecodeError = class extends Error {
      trackId;
      constructor(trackId, message) {
        super(message);
        this.name = "DecodeError";
        this.trackId = trackId;
      }
    };
    AudioEngine = class {
      ctx = null;
      unlock = "locked";
      busGain = null;
      masterGain = null;
      soloBus = null;
      muteBus = null;
      analyser = null;
      timeDomainBuf = new Float32Array(new ArrayBuffer(8192));
      peakWorklet = null;
      workletFailed = false;
      voices = /* @__PURE__ */ new Map();
      buffers = /* @__PURE__ */ new Map();
      pendingFiles = /* @__PURE__ */ new Map();
      spatial = null;
      anySolo = false;
      unlockListeners = /* @__PURE__ */ new Set();
      levelListeners = /* @__PURE__ */ new Set();
      endedListeners = /* @__PURE__ */ new Set();
      rafHandle = 0;
      clipLatchL = false;
      clipLatchR = false;
      lastPeak = { l: 0, r: 0, clipL: false, clipR: false };
      onUnlock(fn) {
        this.unlockListeners.add(fn);
        fn(this.unlock);
        return () => {
          this.unlockListeners.delete(fn);
        };
      }
      onLevels(fn) {
        this.levelListeners.add(fn);
        return () => {
          this.levelListeners.delete(fn);
        };
      }
      onEnded(fn) {
        this.endedListeners.add(fn);
        return () => {
          this.endedListeners.delete(fn);
        };
      }
      emitUnlock() {
        this.unlockListeners.forEach((fn) => fn(this.unlock));
      }
      /** 必须在用户手势中调用；与“未解锁”分别上报明确的失败状态 */
      async resume() {
        if (this.unlock === "unlocked" && this.ctx) {
          if (this.ctx.state === "suspended") await this.ctx.resume();
          return;
        }
        this.unlock = "unlocking";
        this.emitUnlock();
        try {
          const Ctor = window.AudioContext ?? window.webkitAudioContext;
          if (!Ctor) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 Web Audio API");
          const ctx = new Ctor();
          this.ctx = ctx;
          this.buildGraph(ctx);
          if (ctx.state === "suspended") await ctx.resume();
          if (ctx.state !== "running") {
            throw new Error("AudioContext \u88AB\u6D4F\u89C8\u5668\u7B56\u7565\u963B\u6B62\uFF0C\u672A\u80FD\u8FDB\u5165 running \u72B6\u6001");
          }
          this.unlock = "unlocked";
          this.emitUnlock();
          this.startMeterLoop();
          void this.ensurePeakWorklet(ctx);
        } catch (err) {
          this.unlock = "failed";
          this.emitUnlock();
          throw err;
        }
      }
      buildGraph(ctx) {
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
        this.masterGain.connect(this.analyser);
        this.analyser.connect(ctx.destination);
      }
      /**
       * 峰值/削波检测器串联在 masterGain 之后、destination 之前的真实输出链上，
       * 逐采样扫描。Worklet 源码以 Blob 注入，无需额外网络资源。
       */
      async ensurePeakWorklet(ctx) {
        if (this.peakWorklet || this.workletFailed) return !!this.peakWorklet;
        try {
          const workletSource = `
class PeakMeterProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const in0 = inputs[0];
    const out0 = outputs[0];
    if (!in0 || in0.length === 0) {
      // \u4E0A\u6E38\u9759\u9ED8\u4F18\u5316\u65F6\u8F93\u51FA\u4FDD\u6301\u96F6\u586B\u5145\u5373\u53EF
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
      if (ol) ol[i] = vl; // \u5FC5\u987B\u663E\u5F0F\u900F\u4F20\uFF0C\u5426\u5219\u8F93\u51FA\u9759\u97F3
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
          const blob = new Blob([workletSource], { type: "application/javascript" });
          const url = URL.createObjectURL(blob);
          try {
            await ctx.audioWorklet.addModule(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          const node = new AudioWorkletNode(ctx, "peak-meter", {
            // 节点串在真实输出链上：必须保持立体声直通，避免被下混成单声道
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2]
          });
          node.channelCount = 2;
          node.channelInterpretation = "speakers";
          this.masterGain.disconnect();
          this.masterGain.connect(node);
          this.analyser.disconnect();
          node.connect(this.analyser);
          this.analyser.connect(ctx.destination);
          node.port.onmessage = (e) => {
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
      startMeterLoop() {
        const tick = () => {
          if (!this.peakWorklet && this.analyser) {
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
              clipR: this.clipLatchR
            };
          }
          const p = this.lastPeak;
          this.levelListeners.forEach((fn) => fn({ ...p }));
          this.rafHandle = requestAnimationFrame(tick);
        };
        this.rafHandle = requestAnimationFrame(tick);
      }
      // ---------- 全局参数 ----------
      setSpatialSettings(s) {
        this.spatial = s;
        if (!this.ctx) return;
        for (const v of this.voices.values()) {
          v.panner.distanceModel = s.distanceModel;
          v.panner.refDistance = s.refDistance;
          v.panner.rolloffFactor = s.rolloffFactor;
          v.panner.maxDistance = s.maxDistance;
        }
      }
      setBusGain(g2) {
        if (this.busGain && this.ctx) {
          this.busGain.gain.setTargetAtTime(g2, this.ctx.currentTime, 0.01);
        }
      }
      setMasterGain(g2) {
        if (this.masterGain && this.ctx) {
          this.masterGain.gain.setTargetAtTime(g2, this.ctx.currentTime, 0.01);
        }
      }
      /** 听者位置/朝向；朝向定义与 spatial.ts、Three.js 相机严格一致 */
      setListener(l) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const f = forwardVector(l.yaw, l.pitch);
        const u = localUp(l.yaw, l.pitch);
        const li = this.ctx.listener;
        const set = (p, v) => {
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
      async ensureTrack(track) {
        if (!this.ctx || this.unlock !== "unlocked") return;
        let buffer = this.buffers.get(track.id);
        if (!buffer) {
          if (track.sourceType === "file") {
            const blob = this.pendingFiles.get(track.id);
            if (!blob) return;
            try {
              const arr = await blob.arrayBuffer();
              buffer = await this.ctx.decodeAudioData(arr.slice(0));
            } catch (err) {
              throw new DecodeError(
                track.id,
                `\u97F3\u9891\u89E3\u7801\u5931\u8D25\uFF1A${err instanceof Error ? err.message : "\u4E0D\u652F\u6301\u7684\u7F16\u7801\u6216\u6587\u4EF6\u635F\u574F"}`
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
      setFileBlob(trackId, blob) {
        this.pendingFiles.set(trackId, blob);
      }
      dropBuffer(trackId) {
        this.buffers.delete(trackId);
      }
      createVoice(track, buffer) {
        const ctx = this.ctx;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = track.loop;
        const trackGain = ctx.createGain();
        trackGain.gain.value = track.muted ? 0 : track.gain;
        const panner = new PannerNode(ctx, {
          panningModel: "HRTF",
          distanceModel: this.spatial?.distanceModel ?? "inverse",
          refDistance: this.spatial?.refDistance ?? 1,
          rolloffFactor: this.spatial?.rolloffFactor ?? 1,
          maxDistance: this.spatial?.maxDistance ?? 100,
          positionX: track.position.x,
          positionY: track.position.y,
          positionZ: track.position.z
        });
        if (buffer.numberOfChannels <= 1) {
          source.connect(trackGain);
        } else {
          const splitter = ctx.createChannelSplitter(buffer.numberOfChannels);
          source.connect(splitter);
          const ch = Math.min(track.channel, buffer.numberOfChannels - 1);
          splitter.connect(trackGain, ch);
        }
        trackGain.connect(panner);
        const audible = this.shouldBeAudible(track);
        panner.connect(audible ? this.soloBus : this.muteBus);
        const voice = {
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
          duration: buffer.duration
        };
        source.onended = () => {
          if (!voice.playing) return;
          const latest = voice.spec;
          voice.playing = false;
          voice.consumed = true;
          voice.offset = 0;
          const fresh = this.createVoice(latest, buffer);
          fresh.offset = 0;
          this.voices.set(track.id, fresh);
          this.endedListeners.forEach((fn) => fn(track.id));
        };
        return voice;
      }
      shouldBeAudible(track) {
        if (track.muted) return false;
        if (this.anySolo) return track.solo;
        return true;
      }
      /** 实时参数更新：不触碰 source 节点 —— 移动声源不会重启音轨 */
      updateVoiceLive(voice, track) {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const tau = Math.max(5e-3, this.spatial?.positionTimeConstant ?? 0.05);
        voice.panner.positionX.setTargetAtTime(track.position.x, t, tau);
        voice.panner.positionY.setTargetAtTime(track.position.y, t, tau);
        voice.panner.positionZ.setTargetAtTime(track.position.z, t, tau);
        voice.panner.distanceModel = this.spatial?.distanceModel ?? voice.panner.distanceModel;
        voice.trackGain.gain.setTargetAtTime(track.muted ? 0 : track.gain, t, 0.01);
        if (voice.source.loop !== track.loop) voice.source.loop = track.loop;
        const audible = this.shouldBeAudible(track);
        if (audible !== voice.audiblyRouted) {
          voice.panner.disconnect();
          voice.panner.connect(audible ? this.soloBus : this.muteBus);
          voice.audiblyRouted = audible;
        }
        voice.spec = track;
      }
      /** 静音/独奏变化：重新评估全部路由（增益本身在 updateVoiceLive 中已设置） */
      reevaluateRouting(tracks) {
        this.anySolo = tracks.some((t) => t.solo);
        if (!this.ctx) return;
        for (const tr of tracks) {
          const v = this.voices.get(tr.id);
          if (!v) continue;
          const audible = this.shouldBeAudible(tr);
          if (audible !== v.audiblyRouted) {
            v.panner.disconnect();
            v.panner.connect(audible ? this.soloBus : this.muteBus);
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
      syncTracks(tracks) {
        if (!this.ctx) return;
        this.anySolo = tracks.some((t) => t.solo);
        for (const tr of tracks) {
          const v = this.voices.get(tr.id);
          if (v) this.updateVoiceLive(v, tr);
        }
      }
      getChannelCount(trackId) {
        return this.buffers.get(trackId)?.numberOfChannels ?? null;
      }
      /**
       * 重建声轨输入图（切换立体声文件的 L/R 声道时使用）。
       * 保持播放偏移；若原本在播放，从同一位置继续（声道选择本身不属于“移动”）。
       */
      async rebuildVoiceGraph(track) {
        await this.ensureTrack(track);
        const old = this.voices.get(track.id);
        const buf = this.buffers.get(track.id);
        if (!old || !buf) return;
        const wasPlaying = old.playing;
        const offset = wasPlaying ? this.currentOffset(old) : old.offset;
        const nv = this.replaceVoice(old, track, buf, offset);
        if (wasPlaying) {
          nv.source.start(this.ctx.currentTime, offset);
          nv.startedAt = this.ctx.currentTime;
          nv.playing = true;
          nv.consumed = true;
        }
      }
      // ---------- 传输控制 ----------
      async playTrack(track) {
        await this.ensureTrack(track);
        let voice = this.voices.get(track.id);
        if (!voice) return;
        if (voice.playing) return;
        if (voice.consumed) {
          const buf = this.buffers.get(track.id);
          voice = this.replaceVoice(voice, track, buf, voice.offset);
        }
        const ctx = this.ctx;
        voice.source.start(ctx.currentTime, voice.offset % voice.duration);
        voice.startedAt = ctx.currentTime;
        voice.playing = true;
        voice.consumed = true;
      }
      pauseTrack(track) {
        const voice = this.voices.get(track.id);
        if (!voice || !voice.playing) return;
        voice.offset = this.currentOffset(voice);
        this.replaceVoice(voice, track, this.buffers.get(track.id), voice.offset);
      }
      stopTrack(track) {
        const voice = this.voices.get(track.id);
        if (!voice) return;
        if (voice.playing || voice.consumed) {
          this.replaceVoice(voice, track, this.buffers.get(track.id), 0);
        } else {
          voice.offset = 0;
        }
      }
      /** 跳转：offsetSec 秒处；autoplay=true 时立即继续播放 */
      async seekTrack(track, offsetSec, autoplay) {
        await this.ensureTrack(track);
        const voice = this.voices.get(track.id);
        const buf = this.buffers.get(track.id);
        if (!voice || !buf) return;
        const offset = track.loop ? (offsetSec % buf.duration + buf.duration) % buf.duration : Math.min(Math.max(0, offsetSec), buf.duration);
        const nv = this.replaceVoice(voice, track, buf, offset);
        if (autoplay) {
          nv.source.start(this.ctx.currentTime, offset);
          nv.startedAt = this.ctx.currentTime;
          nv.playing = true;
          nv.consumed = true;
        }
      }
      /**
       * 停止旧节点并按最新参数重建（仅用于暂停/停止/跳转）。
       * 位置移动严禁走此路径。
       */
      replaceVoice(old, track, buffer, offset) {
        try {
          old.source.onended = null;
          old.source.stop();
        } catch {
        }
        old.source.disconnect();
        old.trackGain.disconnect();
        old.panner.disconnect();
        const nv = this.createVoice(track, buffer);
        nv.offset = offset;
        this.voices.set(track.id, nv);
        return nv;
      }
      currentOffset(v) {
        let p = v.offset + (this.ctx.currentTime - v.startedAt);
        p = v.spec.loop ? (p % v.duration + v.duration) % v.duration : Math.min(p, v.duration);
        return p;
      }
      removeTrack(trackId) {
        const voice = this.voices.get(trackId);
        if (voice) {
          try {
            voice.source.onended = null;
            voice.source.stop();
          } catch {
          }
          voice.source.disconnect();
          voice.trackGain.disconnect();
          voice.panner.disconnect();
        }
        this.voices.delete(trackId);
        this.buffers.delete(trackId);
        this.pendingFiles.delete(trackId);
      }
      getProgress(trackId) {
        const v = this.voices.get(trackId);
        if (!v) return null;
        return v.playing ? this.currentOffset(v) : v.offset;
      }
      getDuration(trackId) {
        return this.buffers.get(trackId)?.duration ?? null;
      }
      isPlaying(trackId) {
        return this.voices.get(trackId)?.playing ?? false;
      }
      dispose() {
        cancelAnimationFrame(this.rafHandle);
        for (const id of [...this.voices.keys()]) this.removeTrack(id);
        void this.ctx?.close();
        this.ctx = null;
        this.unlock = "locked";
      }
    };
  }
});

// test/engine.test.ts
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
var FakeAudioParam = class {
  value;
  events = [];
  constructor(v) {
    this.value = v;
  }
  setTargetAtTime(v, time, tc) {
    this.value = v;
    this.events.push({ time, value: v, tc });
  }
  setValueAtTime(v) {
    this.value = v;
  }
};
var FakeNode = class {
  connects = [];
  disconnected = false;
  connectedFrom = [];
  connect(node, out, inp) {
    const target = node.input ?? node;
    this.connects.push({ node: target, out, inp });
    target.connectedFrom.push(this);
    return target;
  }
  disconnect() {
    this.connects = [];
    this.disconnected = true;
  }
};
var FakeGain = class extends FakeNode {
  gain = new FakeAudioParam(1);
};
var FakeStereoPanner = class extends FakeNode {
};
var FakeDestination = class extends FakeNode {
};
var FakePanner = class extends FakeNode {
  panningModel = "HRTF";
  distanceModel = "inverse";
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 100;
  positionX = new FakeAudioParam(0);
  positionY = new FakeAudioParam(0);
  positionZ = new FakeAudioParam(0);
  positionTimeConstant = 0;
  orientationX = new FakeAudioParam(1);
  constructor(_ctx, opts = {}) {
    super();
    Object.assign(this, opts);
    if (opts.positionX !== void 0) this.positionX = new FakeAudioParam(opts.positionX);
    if (opts.positionY !== void 0) this.positionY = new FakeAudioParam(opts.positionY);
    if (opts.positionZ !== void 0) this.positionZ = new FakeAudioParam(opts.positionZ);
  }
};
var FakeBufferSource = class extends FakeNode {
  buffer = null;
  loop = false;
  started = [];
  stopped = 0;
  onended = null;
  start(time, offset = 0) {
    this.started.push({ time, offset });
  }
  stop() {
    this.stopped++;
  }
};
var FakeBuffer = class {
  duration;
  numberOfChannels;
  length;
  sampleRate;
  data;
  constructor(ch, length, sr, duration) {
    this.numberOfChannels = ch;
    this.length = length;
    this.sampleRate = sr;
    this.duration = duration;
    this.data = Array.from({ length: ch }, () => new Float32Array(length));
  }
  getChannelData(i) {
    return this.data[i];
  }
};
var FakeSplitter = class extends FakeNode {
  constructor(channels) {
    super();
    this.channels = channels;
  }
};
var FakeMerger = class extends FakeNode {
};
var FakeListener = class {
  positionX = new FakeAudioParam(0);
  positionY = new FakeAudioParam(0);
  positionZ = new FakeAudioParam(0);
  forwardX = new FakeAudioParam(0);
  forwardY = new FakeAudioParam(0);
  forwardZ = new FakeAudioParam(-1);
  upX = new FakeAudioParam(0);
  upY = new FakeAudioParam(1);
  upZ = new FakeAudioParam(0);
};
var FakeAnalyser = class extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData(arr) {
    arr.fill(0);
  }
};
var FakeAudioContext = class {
  state = "running";
  currentTime = 0;
  playbackRate = { value: 1 };
  destination = new FakeDestination();
  listener = new FakeListener();
  sampleRate = 48e3;
  audioWorklet = {
    addModule: async () => {
      throw new Error("worklet unavailable in test");
    }
  };
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    return new FakeBufferSource();
  }
  createBuffer(ch, length, sr) {
    return new FakeBuffer(ch, length, sr, length / sr);
  }
  createChannelSplitter(ch) {
    return new FakeSplitter(ch);
  }
  createChannelMerger(ch) {
    return new FakeMerger();
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  createStereoPanner() {
    return new FakeStereoPanner();
  }
  async resume() {
    this.state = "running";
  }
  async decodeAudioData(buf) {
    const text = new TextDecoder().decode(buf);
    if (text === "BAD") throw new Error("EncodingError: fake bad file");
    return new FakeBuffer(1, 48e3, 48e3, 1);
  }
  async close() {
  }
};
var g = globalThis;
g.AudioContext = FakeAudioContext;
g.requestAnimationFrame = (fn) => {
  return setTimeout(() => fn(0), 16);
};
g.cancelAnimationFrame = (id) => clearTimeout(id);
g.window = globalThis;
g.PannerNode = FakePanner;
var { AudioEngine: AudioEngine2, DecodeError: DecodeError2 } = await Promise.resolve().then(() => (init_audioEngine(), audioEngine_exports));
var { createSampleBuffer: createSampleBuffer2 } = await Promise.resolve().then(() => (init_samples(), samples_exports));
function baseTrack(over = {}) {
  return {
    id: "t1",
    name: "T",
    sourceType: "tone",
    loop: false,
    muted: false,
    solo: false,
    gain: 0.8,
    channel: 0,
    color: "#fff",
    position: { x: 2, y: 0, z: 0 },
    status: "pending",
    ...over
  };
}
describe("AudioEngine \u56FE\u884C\u4E3A\uFF08\u6A21\u62DF\u73AF\u5883\uFF09", () => {
  let engine;
  beforeEach(() => {
    engine = new AudioEngine2();
  });
  afterEach(() => {
    engine.dispose();
  });
  it("resume \u89E3\u9501\uFF1BsetListener \u5199\u5165\u4E0E\u7A7A\u95F4\u6570\u5B66\u4E00\u81F4\u7684\u671D\u5411", async () => {
    await engine.resume();
    assert.equal(engine.unlock, "unlocked");
    engine.setListener({
      position: { x: 0, y: 0, z: 3 },
      yaw: Math.PI / 2,
      // 右转 → forward (+1,0,0)
      pitch: 0,
      earHeight: 0
    });
    const li = engine.ctx.listener;
    assert.ok(Math.abs(li.forwardX.value - 1) < 1e-6);
    assert.ok(Math.abs(li.forwardZ.value) < 1e-6);
    assert.ok(Math.abs(li.upY.value - 1) < 1e-6);
    assert.ok(Math.abs(li.positionZ.value - 3) < 1e-6);
  });
  it("\u58F0\u8F68\u94FE\u8DEF\u4E3A source\u2192trackGain\u2192HRTF panner\u2192soloBus\u2192\u2026\u2192destination\uFF1B\u8DDD\u79BB\u6A21\u578B\u53C2\u6570\u4E0B\u53D1", async () => {
    await engine.resume();
    engine.setSpatialSettings({
      distanceModel: "exponential",
      refDistance: 2,
      rolloffFactor: 1.5,
      maxDistance: 25,
      positionTimeConstant: 0.05,
      hrtfIR: "none"
    });
    const track = baseTrack();
    await engine.ensureTrack(track);
    const voices = engine.voices;
    const v = voices.get("t1");
    assert.equal(v.panner.panningModel, "HRTF");
    assert.equal(v.panner.distanceModel, "exponential");
    assert.equal(v.panner.refDistance, 2);
    assert.equal(v.panner.rolloffFactor, 1.5);
    assert.equal(v.panner.maxDistance, 25);
    assert.ok(Math.abs(v.panner.positionX.value - 2) < 1e-9);
    assert.ok(v.source.connects.some((c) => c.node === v.trackGain));
    assert.ok(v.trackGain.connects.some((c) => c.node === v.panner));
    const soloBus = engine.soloBus;
    assert.ok(v.panner.connects.some((c) => c.node === soloBus));
  });
  it("\u9759\u97F3\u771F\u5B9E\u628A trackGain \u7F6E 0\uFF1B\u72EC\u594F\u628A\u975E\u72EC\u594F\u58F0\u8F68\u5207\u5230 muteBus", async () => {
    await engine.resume();
    const a = baseTrack({ id: "a" });
    const b = baseTrack({ id: "b", position: { x: -2, y: 0, z: 0 } });
    await engine.ensureTrack(a);
    await engine.ensureTrack(b);
    const voices = engine.voices;
    const muteBus = engine.muteBus;
    engine.syncTracks([{ ...a, muted: true }, b]);
    assert.equal(voices.get("a").trackGain.gain.value, 0);
    assert.equal(voices.get("b").trackGain.gain.value, 0.8);
    engine.syncTracks([{ ...a, muted: true }, { ...b, solo: true }]);
    assert.ok(voices.get("a").panner.connects.some((c) => c.node === muteBus));
    assert.ok(
      voices.get("b").panner.connects.every((c) => c.node !== muteBus)
    );
    engine.syncTracks([{ ...a, muted: true }, b]);
    assert.ok(voices.get("a").panner.connects.some((c) => c.node === muteBus));
    assert.ok(
      voices.get("a").panner.connects.every((c) => c.node === muteBus)
    );
  });
  it("\u79FB\u52A8\u58F0\u6E90\u53EA\u5199 AudioParam\uFF0C\u7EDD\u4E0D stop/start source\uFF08\u4E0D\u91CD\u542F\u97F3\u8F68\uFF09", async () => {
    await engine.resume();
    const t = baseTrack();
    await engine.playTrack(t);
    const v = engine.voices.get("t1");
    const startsBefore = v.source.started.length;
    const stopsBefore = v.source.stopped;
    for (let i = 0; i < 10; i++) {
      engine.syncTracks([
        { ...t, position: { x: 2 + i * 0.1, y: 0.5, z: -i * 0.2 } }
      ]);
    }
    assert.ok(Math.abs(v.panner.positionX.value - 2.9) < 1e-9);
    assert.ok(Math.abs(v.panner.positionY.value - 0.5) < 1e-9);
    assert.ok(Math.abs(v.panner.positionZ.value - -1.8) < 1e-9);
    assert.equal(v.source.started.length, startsBefore);
    assert.equal(v.source.stopped, stopsBefore);
  });
  it("\u6682\u505C\u4F1A\u505C\u6B62\u5E76\u91CD\u5EFA\u8282\u70B9\u4E14\u4FDD\u7559\u504F\u79FB\uFF1B\u518D\u6B21\u64AD\u653E\u4ECE\u504F\u79FB\u5F00\u59CB", async () => {
    await engine.resume();
    const ctx = engine.ctx;
    const t = { ...baseTrack(), loop: false };
    await engine.playTrack(t);
    ctx.currentTime = 0.3;
    engine.pauseTrack(t);
    await engine.playTrack({ ...t });
    const v = engine.voices.get("t1");
    const last = v.source.started[v.source.started.length - 1];
    assert.ok(Math.abs(last.offset - 0.3) < 1e-6);
  });
  it("\u603B\u7EBF\u4E0E\u4E3B\u589E\u76CA\u771F\u5B9E\u5199\u5165\u5BF9\u5E94 GainNode", async () => {
    await engine.resume();
    engine.setBusGain(0.42);
    engine.setMasterGain(0.71);
    const bus = engine.busGain;
    const master = engine.masterGain;
    assert.ok(Math.abs(bus.gain.value - 0.42) < 1e-9);
    assert.ok(Math.abs(master.gain.value - 0.71) < 1e-9);
    const analyser = engine.analyser;
    const destination = engine.ctx.destination;
    assert.ok(analyser.connects.some((c) => c.node === destination));
  });
  it("\u574F\u6587\u4EF6\u89E3\u7801\u5931\u8D25\u629B\u51FA DecodeError\uFF0C\u4E14\u4E0D\u5F71\u54CD\u5176\u4ED6\u58F0\u8F68", async () => {
    await engine.resume();
    const bad = baseTrack({ id: "bad", sourceType: "file" });
    engine.setFileBlob("bad", new Blob([new TextEncoder().encode("BAD")], { type: "audio/x" }));
    await assert.rejects(engine.ensureTrack(bad), (err) => err instanceof DecodeError2);
    const good = baseTrack({ id: "good" });
    await engine.ensureTrack(good);
    const voices = engine.voices;
    assert.ok(voices.has("good"));
  });
  it("\u5185\u7F6E\u6837\u4F8B\u7F13\u51B2\u53EF\u7ECF\u5F15\u64CE\u5408\u6210\uFF0C\u65F6\u957F\u4E0E\u58F0\u9053\u7B26\u5408\u9884\u671F", async () => {
    await engine.resume();
    const buf = createSampleBuffer2(engine.ctx, "pulse");
    assert.equal(buf.numberOfChannels, 1);
    assert.ok(Math.abs(buf.duration - 1.6) < 1e-6);
  });
});
