/**
 * 内置试听样例：全部由 AudioContext 离线/在线合成，不涉及任何外部资源上传。
 *  - pulse：短促脉冲，检查 HRTF 左右方位
 *  - tone：持续单音，检查稳定声像与距离衰减
 *  - duoA / duoB：双声源同上下文同计时，检查相位同步
 */
import type { SourceType } from '../types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1.6 秒内三声短促脉冲，脉冲之间静音，便于逐次辨别方位 */
export function createPulseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 1.6;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const data = buf.getChannelData(0);
  const pulseStarts = [0.05, 0.55, 1.05];
  for (const start of pulseStarts) {
    const s0 = Math.floor(start * sr);
    const n = Math.floor(0.05 * sr); // 50ms
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // 1200Hz 带包络脉冲，瞬态明显，HRTF 定位线索强
      const env = Math.pow(1 - i / n, 1.6);
      data[s0 + i] = Math.sin(2 * Math.PI * 1200 * t) * env * 0.9;
    }
  }
  return buf;
}

/** 持续 3 秒的 440Hz 正弦单音（带轻微淡入淡出），用于检查稳定声像 */
export function createToneBuffer(ctx: BaseAudioContext): AudioBuffer {
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

/**
 * 双声源：相同的确定性噪声 + 弱 330Hz 基音。
 * A / B 两条声轨内容完全一致，从同一 AudioContext 调度，
 * 放在 ±X 位置可直接验证左右同步（无相位漂移）与同步声像。
 */
export function createDuoBuffer(ctx: BaseAudioContext, _variant: 'A' | 'B'): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 4;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const data = buf.getChannelData(0);
  // A、B 使用同一种子，保证波形逐采样一致
  const rand = mulberry32(20260929);
  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const noise = (rand() * 2 - 1) * 0.18;
    const tone = Math.sin(2 * Math.PI * 330 * t) * 0.28;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
    const fade = Math.min(1, t / 0.05, (dur - t) / 0.1);
    // A、B 使用同一种子与同一波形，逐采样完全一致（仅标签不同）
    data[i] = (noise + tone) * (0.6 + 0.4 * lfo) * fade;
  }
  return buf;
}

export function createSampleBuffer(ctx: BaseAudioContext, type: SourceType): AudioBuffer {
  switch (type) {
    case 'pulse':
      return createPulseBuffer(ctx);
    case 'tone':
      return createToneBuffer(ctx);
    case 'duoA':
      return createDuoBuffer(ctx, 'A');
    case 'duoB':
      return createDuoBuffer(ctx, 'B');
    default:
      throw new Error(`非内置样例类型: ${type}`);
  }
}

export const SAMPLE_LABELS: Record<Exclude<SourceType, 'file'>, string> = {
  pulse: '脉冲样例（方位测试）',
  tone: '单音样例（声像/距离）',
  duoA: '双声源 A（同步左）',
  duoB: '双声源 B（同步右）',
};
