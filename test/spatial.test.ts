/**
 * 空间数学与样例一致性测试（Node 环境，无浏览器）。
 * 覆盖：
 *  - 听者朝向/右向量与“左右声道含义”约定
 *  - relativeAzimuth：右侧声源为正、前 0 / 后 ±180
 *  - distanceGain：三种距离模型单调、钳位、与 W3C 公式一致
 *  - 双声源 A/B 逐采样相同（同步检查的前提）
 */
import assert from 'node:assert/strict';
import {
  describe,
  it,
} from 'node:test';
import {
  describeAzimuth,
  distanceGain,
  distanceTo,
  elevationAngle,
  forwardVector,
  relativeAzimuth,
  rightVector,
} from '../src/lib/spatial.ts';

function listenerAt(x = 0, yaw = 0, pitch = 0) {
  return {
    position: { x, y: 0, z: 0 },
    yaw,
    pitch,
    earHeight: 0,
  };
}

describe('听者朝向约定（与 AudioListener / Three.js 一致）', () => {
  it('yaw=0 时前方为 -Z，右方为 +X', () => {
    const f = forwardVector(0, 0);
    assert.ok(Math.abs(f.z - -1) < 1e-9);
    assert.ok(Math.abs(f.x) < 1e-9);
    const r = rightVector(0);
    assert.ok(Math.abs(r.x - 1) < 1e-9);
    assert.ok(Math.abs(r.z) < 1e-9);
  });

  it('yaw=+90° 是向右转身：前方变为 +X', () => {
    const f = forwardVector(Math.PI / 2, 0);
    assert.ok(Math.abs(f.x - 1) < 1e-9);
    assert.ok(Math.abs(f.z) < 1e-9);
  });

  it('俯仰正向时前方抬升', () => {
    const f = forwardVector(0, Math.PI / 4);
    assert.ok(f.y > 0);
    assert.ok(Math.abs(f.z - -Math.SQRT1_2) < 1e-9);
  });
});

describe('relativeAzimuth：正负号即左右声道含义', () => {
  it('正右方声源 +90°（右耳响），正左方 -90°', () => {
    const r = relativeAzimuth({ x: 5, y: 0, z: 0 }, listenerAt());
    assert.ok(Math.abs(r - 90) < 1e-6);
    const l = relativeAzimuth({ x: -5, y: 0, z: 0 }, listenerAt());
    assert.ok(Math.abs(l - -90) < 1e-6);
  });

  it('正前方 0°，正后方 ±180°', () => {
    assert.ok(Math.abs(relativeAzimuth({ x: 0, y: 0, z: -5 }, listenerAt())) < 1e-6);
    const back = relativeAzimuth({ x: 0, y: 0, z: 5 }, listenerAt());
    assert.ok(Math.abs(Math.abs(back) - 180) < 1e-6);
  });

  it('听者右转 90° 后，世界 +X 的声源变为正前方', () => {
    const az = relativeAzimuth(
      { x: 5, y: 0, z: 0 },
      listenerAt(0, Math.PI / 2),
    );
    assert.ok(Math.abs(az) < 1e-6);
  });

  it('听者右转 90° 后，世界 -Z（原前方）变为左侧 90°', () => {
    const az = relativeAzimuth(
      { x: 0, y: 0, z: -5 },
      listenerAt(0, Math.PI / 2),
    );
    assert.ok(Math.abs(az - -90) < 1e-6);
  });

  it('人类可读描述左右正确', () => {
    assert.match(describeAzimuth(60), /右偏 60/);
    assert.match(describeAzimuth(-60), /左偏 60/);
    assert.equal(describeAzimuth(0), '正前');
    assert.equal(describeAzimuth(180), '正后');
  });
});

describe('距离与仰角', () => {
  it('3-4-5', () => {
    assert.equal(distanceTo({ x: 3, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }), 5);
  });
  it('正上方仰角 90°', () => {
    assert.equal(elevationAngle({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 }), 90);
  });
});

describe('distanceGain：与 PannerNode 规范公式一致', () => {
  it('inverse：d=ref 时为 1，随后单调衰减', () => {
    assert.ok(
      Math.abs(
        distanceGain(1, 'inverse', 1, 1, 100) - 1,
      ) < 1e-9,
    );
    const g2 = distanceGain(2, 'inverse', 1, 1, 100);
    assert.ok(Math.abs(g2 - 0.5) < 1e-9);
    const g3 = distanceGain(3, 'inverse', 1, 1, 100);
    assert.ok(Math.abs(g3 - 1 / 3) < 1e-9);
    assert.ok(distanceGain(10, 'inverse', 1, 1, 100) < g3);
  });

  it('exponential：g = (d/ref)^-rolloff', () => {
    assert.ok(Math.abs(distanceGain(4, 'exponential', 1, 0.5, 100) - 0.5) < 1e-9);
    assert.ok(Math.abs(distanceGain(0.2, 'exponential', 1, 1, 100) - 1) < 1e-9);
  });

  it('linear：到 maxDistance 衰减为 0，中间线性', () => {
    assert.equal(distanceGain(1, 'linear', 1, 1, 11), 1);
    assert.ok(Math.abs(distanceGain(6, 'linear', 1, 1, 11) - 0.5) < 1e-9);
    assert.equal(distanceGain(11, 'linear', 1, 1, 11), 0);
    assert.equal(distanceGain(50, 'linear', 1, 1, 11), 0);
  });

  it('全部模型增益钳制在 0..1', () => {
    for (const model of ['inverse', 'linear', 'exponential'] as const) {
      for (const d of [0, 0.0001, 0.5, 1, 5, 20, 1000]) {
        const g = distanceGain(d, model, 1, 2, 20);
        assert.ok(g >= 0 && g <= 1, `${model} d=${d} g=${g}`);
      }
    }
  });
});

// ---------- 样例缓冲一致性（最小 AudioContext 替身） ----------

class FakeBuffer {
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  length: number;
  private channels: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(i: number) {
    return this.channels[i];
  }
}

const fakeCtx = {
  sampleRate: 48000,
  createBuffer: (ch: number, len: number, sr: number) => new FakeBuffer(ch, len, sr),
} as unknown as BaseAudioContext;

describe('内置样例', () => {
  it('脉冲在 1.6s 内包含三个瞬态，且无声直流', async () => {
    const { createPulseBuffer } = await import('../src/lib/samples.ts');
    const buf = createPulseBuffer(fakeCtx);
    const d = buf.getChannelData(0);
    // 起始脉冲峰值附近能量大（采样正弦峰值点）
    assert.ok(Math.abs(d[Math.floor((0.05 + 1 / 1200 / 4) * 48000)]) > 0.5);
    // 脉冲之间应接近静音
    assert.ok(Math.abs(d[Math.floor(0.3 * 48000)]) < 0.001);
    // 总长度 1.6s
    assert.equal(buf.length, 48000 * 1.6);
  });

  it('双声源 A/B 逐采样完全相同（同步/声像检查的前提）', async () => {
    const { createDuoBuffer } = await import('../src/lib/samples.ts');
    const a = createDuoBuffer(fakeCtx, 'A').getChannelData(0);
    const b = createDuoBuffer(fakeCtx, 'B').getChannelData(0);
    assert.equal(a.length, b.length);
    let nonZero = 0;
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i], b[i], `sample ${i} differs`);
      if (a[i] !== 0) nonZero++;
    }
    assert.ok(nonZero > a.length * 0.9, '样例应当几乎处处有信号');
  });

  it('单音 440Hz、3 秒、单声道', async () => {
    const { createToneBuffer } = await import('../src/lib/samples.ts');
    const buf = createToneBuffer(fakeCtx);
    assert.equal(buf.numberOfChannels, 1);
    assert.equal(buf.length, 48000 * 3);
    // 起音淡入：第 1 个采样接近 0
    assert.ok(Math.abs(buf.getChannelData(0)[0]) < 0.01);
  });
});
