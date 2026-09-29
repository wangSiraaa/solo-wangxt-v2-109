/**
 * 程序化生成试听样例（不存储音频，重载后用同一参数重新生成）。
 * 两种样例都是单声道 —— 声像完全交给 PannerNode(HRTF)，保证方位判断干净。
 */

export interface SampleOptions {
  frequency?: number;
  intervalSec?: number;
}

export async function generateSampleBuffer(
  ctx: BaseAudioContext,
  type: 'impulse' | 'tone',
  opts: SampleOptions = {},
): Promise<AudioBuffer> {
  if (type === 'impulse') return makeImpulse(ctx, opts.intervalSec ?? 1);
  return makeTone(ctx, opts.frequency ?? 1000);
}

/**
 * 脉冲：每 intervalSec 一次的短指数衰减滴答，20 秒缓冲，循环使用。
 * 瞬态信号最适合检验 HRTF 的方位与同步。
 */
function makeImpulse(ctx: BaseAudioContext, intervalSec: number): AudioBuffer {
  const total = 20;
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, rate * total, rate);
  const data = buf.getChannelData(0);
  const period = Math.max(0.1, intervalSec) * rate;
  const clickLen = Math.floor(rate * 0.02); // 20ms
  for (let start = 0; start < data.length; start += period) {
    for (let i = 0; i < clickLen && start + i < data.length; i++) {
      // 起始为全幅正向尖峰，随后指数衰减，避免直流偏移
      data[start + i] =
        Math.exp(-i / (rate * 0.004)) * (1 - i / clickLen) * 0.9;
    }
  }
  return buf;
}

/**
 * 单音：1000Hz 正弦（HRTF 定位敏感频段），3 秒缓入缓出，循环使用。
 */
function makeTone(ctx: BaseAudioContext, frequency: number): AudioBuffer {
  const total = 3;
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, rate * total, rate);
  const data = buf.getChannelData(0);
  const fade = rate * 0.05;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    let amp = 0.5;
    if (i < fade) amp *= i / fade;
    if (i > data.length - fade) amp *= (data.length - i) / fade;
    data[i] = Math.sin(2 * Math.PI * frequency * t) * amp;
  }
  return buf;
}
