// 运行时冒烟测试：在 mock Web Audio + fake-indexeddb 下驱动引擎，
// 验证：解锁流程、HRTF/距离参数、移动不重启 source、静音/独奏/总线增益、
// 输出链接线、峰值表、双声源同步起点、工程保存/重载不自动播放。
import 'fake-indexeddb/auto';
import { build as esbuild } from 'esbuild';
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// ---------- 极简 Web Audio mock（记录连接与参数，源 start 记录 when/offset） ----------
class Param {
  value = 0;
  constructor(v = 0) { this.value = v; }
  setTargetAtTime(v: number) { this.value = v; }
}
class Node {
  _connected = new Set();
  connect(dest: unknown) { this._connected.add(dest); return dest; }
  disconnect() { this._connected.clear(); }
  stop() { (this as any).stopped = true; }
}
class BufferSource extends Node {
  buffer: any = null;
  loop = false;
  started: { when: number; offset: number } | null = null;
  start(when = 0, offset = 0) { this.started = { when, offset }; }
}
class GainNode extends Node { gain = new Param(1); }
class PannerNode extends Node {
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  setPosition() { /* noop */ }
}
class Listener {
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  forwardX = new Param(); forwardY = new Param(); forwardZ = new Param();
  upX = new Param(); upY = new Param(1); upZ = new Param();
}
class AnalyserNode extends Node {
  fftSize = 2048;
  getFloatTimeDomainData(a: Float32Array) { a.fill(0); }
}
class ChannelSplitterNode extends Node {}

class AudioContext {
  state: 'running' | 'suspended' = 'running';
  private t0 = performance.now();
  get currentTime() { return 1000 + (performance.now() - this.t0) / 1000; }
  destination = new Node();
  listener = new Listener();
  sampleRate = 48000;
  async resume() { this.state = 'running'; }
  createGain() { return new GainNode(); }
  createPanner() { return new PannerNode(); }
  createAnalyser() { return new AnalyserNode(); }
  createChannelSplitter() { return new ChannelSplitterNode(); }
  createBufferSource() { return new BufferSource(); }
  createBuffer(ch: number, len: number, rate: number) {
    return {
      numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate,
      getChannelData: () => new Float32Array(len),
    };
  }
  async decodeAudioData(buf: ArrayBuffer) {
    if (buf.byteLength === 0) throw new Error('bad audio');
    return this.createBuffer(2, 48000, 48000);
  }
}
(globalThis as any).AudioContext = AudioContext;
(globalThis as any).window = globalThis;
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(0), 0) as unknown as number;
(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

await esbuild({
  entryPoints: ['src/audio/engine.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: '.test/engine.mjs',
  logLevel: 'silent',
});

const engineUrl = pathToFileURL(path.resolve('.test/engine.mjs')).href;
const { Engine, listenerForward, dbToGain } = await import(engineUrl);

let pass = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { console.error(`✗ ${name} ${extra}`); process.exitCode = 1; }
  else { pass++; console.log(`✓ ${name}`); }
};

const e = new Engine();
await e.whenReady();

const f0 = listenerForward({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });
check('前向 yaw=0 指向 -Z', Math.abs(f0.z + 1) < 1e-6 && f0.x === 0, JSON.stringify(f0));
const f90 = listenerForward({ position: { x: 0, y: 0, z: 0 }, yaw: 90, pitch: 0 });
check('前向 yaw=90 指向 -X（听者左侧）', Math.abs(f90.x + 1) < 1e-6, JSON.stringify(f90));
const fR = listenerForward({ position: { x: 0, y: 0, z: 0 }, yaw: -90, pitch: 0 });
check('前向 yaw=-90 指向 +X（听者右侧）', Math.abs(fR.x - 1) < 1e-6, JSON.stringify(fR));

const r = await e.unlock();
check('手势内解锁成功', r === 'running' && e.audioState === 'running');

e.addSampleTrack('impulse');
e.addSampleTrack('tone');
const blobOk = new Blob([new Uint8Array(100)], { type: 'audio/wav' });
const blobBad = new Blob([new Uint8Array(0)], { type: 'audio/wav' });
await e.importFiles([new File([blobOk], 'ok.wav'), new File([blobBad], 'bad.wav')]);
await new Promise((r) => setTimeout(r, 100));

const tracks = e.project.tracks;
check('共 4 轨', tracks.length === 4);
const bad: any = tracks.find((t: any) => t.name === 'bad');
const good: any = tracks.find((t: any) => t.name === 'ok');
check('解码失败单独标记为 error', bad?.status === 'error' && /解码失败/.test(bad.error ?? ''));
check('正常文件就绪', good?.status === 'ready');

await e.play();
check('播放状态', e.isPlaying === true);
const startedSrc = (id: string) => (e as any).nodes.get(id).source;
const before = tracks.map((t: any) => startedSrc(t.id)?.started);
check('就绪轨均已 start', before.filter(Boolean).length >= 3);
const whens = before.filter(Boolean).map((s: any) => s.when);
check('所有源起始 when 相同（双声源同步）', whens.every((w: number) => w === whens[0]), JSON.stringify(whens));
check('全部 panner 使用 HRTF', tracks.every((t: any) => (e as any).nodes.get(t.id).panner.panningModel === 'HRTF'));
check('距离模型 linear + 1m/20m/rolloff=1', tracks.every((t: any) => {
  const p = (e as any).nodes.get(t.id).panner;
  return p.distanceModel === 'linear' && p.refDistance === 1 && p.maxDistance === 20 && p.rolloffFactor === 1;
}));

const t0 = tracks[0];
const srcRef = startedSrc(t0.id);
e.setTrackPosition(t0.id, { x: 5.5, z: -2.25 });
check('移动后 source 未重启（同一对象）', startedSrc(t0.id) === srcRef);
const pan = (e as any).nodes.get(t0.id).panner;
check('panner 坐标与状态一致', pan.positionX.value === 5.5 && pan.positionZ.value === -2.25);
e.setTrackPosition(t0.id, { x: 999 });
check('坐标被限制在 ±11m', (e as any).nodes.get(t0.id).panner.positionX.value === 11);
e.setTrackPosition(t0.id, { x: 7, y: 1.6, z: -3 });

const gainOf = (id: string) => (e as any).nodes.get(id).gain.gain.value;
e.toggleMute(t0.id);
check('静音轨增益为 0', gainOf(t0.id) === 0);
e.toggleMute(t0.id);
check('取消静音恢复', gainOf(t0.id) === dbToGain(0));
e.toggleSolo(tracks[1].id);
check('独奏时其他轨增益为 0', gainOf(t0.id) === 0 && gainOf(tracks[1].id) === 1);
e.toggleSolo(tracks[1].id);
e.setMasterGain(6);
check('总线 +6dB ≈ 1.995', Math.abs((e as any).master.gain.value - dbToGain(6)) < 0.01);
e.setMasterGain(0);

e.setListener({ yaw: 90 });
check('listener forwardX = -1（yaw 90）', Math.abs((e as any).ctx.listener.forwardX.value + 1) < 1e-6);
e.setListener({ yaw: 0 });

const n0 = (e as any).nodes.get(t0.id);
check('音轨链 gain→panner→master', n0.gain._connected.has(n0.panner) && n0.panner._connected.has((e as any).master));
check('master→destination（真实输出）', (e as any).master._connected.has((e as any).ctx.destination));
check('master→splitter（峰值表在输出链上）', (e as any).master._connected.has((e as any).splitter));

await new Promise((r) => setTimeout(r, 150));
await e.pause();
check('暂停后停止状态', e.isPlaying === false);
check('暂停保存了偏移', Object.values(e.project.offsets).some((v) => typeof v === 'number'));
await e.play();
const offs = tracks
  .map((t: any) => (e as any).nodes.get(t.id).source?.started?.offset)
  .filter((v: number | undefined) => v !== undefined);
check('继续播放带上偏移', offs.some((v: number) => v > 0), JSON.stringify(offs));
await e.stop();
check('停止清零偏移', Object.keys(e.project.offsets).length === 0);

const peaks = e.getPeaks();
check('峰值表返回 L/R 且未过载', typeof peaks.l === 'number' && typeof peaks.r === 'number' && peaks.clipL === false);

const id = e.project.id;
e.renameProject('冒烟工程');
await e.save();

const e2 = new Engine();
await e2.whenReady();
check('重载最近工程（参数恢复）', e2.project.id === id && e2.project.name === '冒烟工程');
const restored: any = e2.project.tracks.find((t: any) => t.id === t0.id);
check('声源坐标恢复', restored?.position.x === 7 && restored.position.z === -3);
check('重载后绝不自动播放', e2.isPlaying === false && e2.audioState === 'locked');
check('工程列表含本工程', e2.projects.some((p: any) => p.id === id));

rmSync('.test', { recursive: true, force: true });
console.log(`\n通过 ${pass} 项检查`);
