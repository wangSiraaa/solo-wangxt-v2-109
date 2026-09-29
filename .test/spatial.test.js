var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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

// test/spatial.test.ts
import assert from "node:assert/strict";
import {
  describe,
  it
} from "node:test";

// src/lib/spatial.ts
function forwardVector(yaw, pitch = 0) {
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch)
  };
}
function rightVector(yaw) {
  return { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function length(a) {
  return Math.hypot(a.x, a.y, a.z);
}
function relativeAzimuth(source, listener) {
  const rel = sub(source, listener.position);
  const fwd = forwardVector(listener.yaw, 0);
  const right = rightVector(listener.yaw);
  const front = dot(rel, fwd);
  const side = dot(rel, right);
  const az = Math.atan2(side, front) * (180 / Math.PI);
  if (az > 180) return az - 360;
  if (az < -180) return az + 360;
  return az;
}
function distanceTo(source, listener) {
  return length(sub(source, listener));
}
function elevationAngle(source, listener) {
  const rel = sub(source, listener);
  const horiz = Math.hypot(rel.x, rel.z);
  return Math.atan2(rel.y, horiz) * 180 / Math.PI;
}
function describeAzimuth(az) {
  const a = Math.abs(az);
  let dir;
  if (a < 5) dir = "\u6B63\u524D";
  else if (a > 175) dir = "\u6B63\u540E";
  else dir = az > 0 ? `\u53F3\u504F ${a.toFixed(0)}\xB0` : `\u5DE6\u504F ${a.toFixed(0)}\xB0`;
  return dir;
}
function distanceGain(distance, model, refDistance, rolloffFactor, maxDistance) {
  const d = Math.max(distance, 1e-4);
  let g = 1;
  switch (model) {
    case "linear":
      g = 1 - rolloffFactor * ((d - refDistance) / (maxDistance - refDistance));
      break;
    case "inverse":
      g = refDistance / (refDistance + rolloffFactor * Math.max(d - refDistance, 0));
      break;
    case "exponential":
      g = Math.pow(Math.max(d, refDistance) / refDistance, -rolloffFactor);
      break;
  }
  return Math.min(1, Math.max(0, g));
}

// test/spatial.test.ts
function listenerAt(x = 0, yaw = 0, pitch = 0) {
  return {
    position: { x, y: 0, z: 0 },
    yaw,
    pitch,
    earHeight: 0
  };
}
describe("\u542C\u8005\u671D\u5411\u7EA6\u5B9A\uFF08\u4E0E AudioListener / Three.js \u4E00\u81F4\uFF09", () => {
  it("yaw=0 \u65F6\u524D\u65B9\u4E3A -Z\uFF0C\u53F3\u65B9\u4E3A +X", () => {
    const f = forwardVector(0, 0);
    assert.ok(Math.abs(f.z - -1) < 1e-9);
    assert.ok(Math.abs(f.x) < 1e-9);
    const r = rightVector(0);
    assert.ok(Math.abs(r.x - 1) < 1e-9);
    assert.ok(Math.abs(r.z) < 1e-9);
  });
  it("yaw=+90\xB0 \u662F\u5411\u53F3\u8F6C\u8EAB\uFF1A\u524D\u65B9\u53D8\u4E3A +X", () => {
    const f = forwardVector(Math.PI / 2, 0);
    assert.ok(Math.abs(f.x - 1) < 1e-9);
    assert.ok(Math.abs(f.z) < 1e-9);
  });
  it("\u4FEF\u4EF0\u6B63\u5411\u65F6\u524D\u65B9\u62AC\u5347", () => {
    const f = forwardVector(0, Math.PI / 4);
    assert.ok(f.y > 0);
    assert.ok(Math.abs(f.z - -Math.SQRT1_2) < 1e-9);
  });
});
describe("relativeAzimuth\uFF1A\u6B63\u8D1F\u53F7\u5373\u5DE6\u53F3\u58F0\u9053\u542B\u4E49", () => {
  it("\u6B63\u53F3\u65B9\u58F0\u6E90 +90\xB0\uFF08\u53F3\u8033\u54CD\uFF09\uFF0C\u6B63\u5DE6\u65B9 -90\xB0", () => {
    const r = relativeAzimuth({ x: 5, y: 0, z: 0 }, listenerAt());
    assert.ok(Math.abs(r - 90) < 1e-6);
    const l = relativeAzimuth({ x: -5, y: 0, z: 0 }, listenerAt());
    assert.ok(Math.abs(l - -90) < 1e-6);
  });
  it("\u6B63\u524D\u65B9 0\xB0\uFF0C\u6B63\u540E\u65B9 \xB1180\xB0", () => {
    assert.ok(Math.abs(relativeAzimuth({ x: 0, y: 0, z: -5 }, listenerAt())) < 1e-6);
    const back = relativeAzimuth({ x: 0, y: 0, z: 5 }, listenerAt());
    assert.ok(Math.abs(Math.abs(back) - 180) < 1e-6);
  });
  it("\u542C\u8005\u53F3\u8F6C 90\xB0 \u540E\uFF0C\u4E16\u754C +X \u7684\u58F0\u6E90\u53D8\u4E3A\u6B63\u524D\u65B9", () => {
    const az = relativeAzimuth(
      { x: 5, y: 0, z: 0 },
      listenerAt(0, Math.PI / 2)
    );
    assert.ok(Math.abs(az) < 1e-6);
  });
  it("\u542C\u8005\u53F3\u8F6C 90\xB0 \u540E\uFF0C\u4E16\u754C -Z\uFF08\u539F\u524D\u65B9\uFF09\u53D8\u4E3A\u5DE6\u4FA7 90\xB0", () => {
    const az = relativeAzimuth(
      { x: 0, y: 0, z: -5 },
      listenerAt(0, Math.PI / 2)
    );
    assert.ok(Math.abs(az - -90) < 1e-6);
  });
  it("\u4EBA\u7C7B\u53EF\u8BFB\u63CF\u8FF0\u5DE6\u53F3\u6B63\u786E", () => {
    assert.match(describeAzimuth(60), /右偏 60/);
    assert.match(describeAzimuth(-60), /左偏 60/);
    assert.equal(describeAzimuth(0), "\u6B63\u524D");
    assert.equal(describeAzimuth(180), "\u6B63\u540E");
  });
});
describe("\u8DDD\u79BB\u4E0E\u4EF0\u89D2", () => {
  it("3-4-5", () => {
    assert.equal(distanceTo({ x: 3, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }), 5);
  });
  it("\u6B63\u4E0A\u65B9\u4EF0\u89D2 90\xB0", () => {
    assert.equal(elevationAngle({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 }), 90);
  });
});
describe("distanceGain\uFF1A\u4E0E PannerNode \u89C4\u8303\u516C\u5F0F\u4E00\u81F4", () => {
  it("inverse\uFF1Ad=ref \u65F6\u4E3A 1\uFF0C\u968F\u540E\u5355\u8C03\u8870\u51CF", () => {
    assert.ok(
      Math.abs(
        distanceGain(1, "inverse", 1, 1, 100) - 1
      ) < 1e-9
    );
    const g2 = distanceGain(2, "inverse", 1, 1, 100);
    assert.ok(Math.abs(g2 - 0.5) < 1e-9);
    const g3 = distanceGain(3, "inverse", 1, 1, 100);
    assert.ok(Math.abs(g3 - 1 / 3) < 1e-9);
    assert.ok(distanceGain(10, "inverse", 1, 1, 100) < g3);
  });
  it("exponential\uFF1Ag = (d/ref)^-rolloff", () => {
    assert.ok(Math.abs(distanceGain(4, "exponential", 1, 0.5, 100) - 0.5) < 1e-9);
    assert.ok(Math.abs(distanceGain(0.2, "exponential", 1, 1, 100) - 1) < 1e-9);
  });
  it("linear\uFF1A\u5230 maxDistance \u8870\u51CF\u4E3A 0\uFF0C\u4E2D\u95F4\u7EBF\u6027", () => {
    assert.equal(distanceGain(1, "linear", 1, 1, 11), 1);
    assert.ok(Math.abs(distanceGain(6, "linear", 1, 1, 11) - 0.5) < 1e-9);
    assert.equal(distanceGain(11, "linear", 1, 1, 11), 0);
    assert.equal(distanceGain(50, "linear", 1, 1, 11), 0);
  });
  it("\u5168\u90E8\u6A21\u578B\u589E\u76CA\u94B3\u5236\u5728 0..1", () => {
    for (const model of ["inverse", "linear", "exponential"]) {
      for (const d of [0, 1e-4, 0.5, 1, 5, 20, 1e3]) {
        const g = distanceGain(d, model, 1, 2, 20);
        assert.ok(g >= 0 && g <= 1, `${model} d=${d} g=${g}`);
      }
    }
  });
});
var FakeBuffer = class {
  numberOfChannels;
  sampleRate;
  duration;
  length;
  channels;
  constructor(channels, length2, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length2;
    this.sampleRate = sampleRate;
    this.duration = length2 / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length2));
  }
  getChannelData(i) {
    return this.channels[i];
  }
};
var fakeCtx = {
  sampleRate: 48e3,
  createBuffer: (ch, len, sr) => new FakeBuffer(ch, len, sr)
};
describe("\u5185\u7F6E\u6837\u4F8B", () => {
  it("\u8109\u51B2\u5728 1.6s \u5185\u5305\u542B\u4E09\u4E2A\u77AC\u6001\uFF0C\u4E14\u65E0\u58F0\u76F4\u6D41", async () => {
    const { createPulseBuffer: createPulseBuffer2 } = await Promise.resolve().then(() => (init_samples(), samples_exports));
    const buf = createPulseBuffer2(fakeCtx);
    const d = buf.getChannelData(0);
    assert.ok(Math.abs(d[Math.floor((0.05 + 1 / 1200 / 4) * 48e3)]) > 0.5);
    assert.ok(Math.abs(d[Math.floor(0.3 * 48e3)]) < 1e-3);
    assert.equal(buf.length, 48e3 * 1.6);
  });
  it("\u53CC\u58F0\u6E90 A/B \u9010\u91C7\u6837\u5B8C\u5168\u76F8\u540C\uFF08\u540C\u6B65/\u58F0\u50CF\u68C0\u67E5\u7684\u524D\u63D0\uFF09", async () => {
    const { createDuoBuffer: createDuoBuffer2 } = await Promise.resolve().then(() => (init_samples(), samples_exports));
    const a = createDuoBuffer2(fakeCtx, "A").getChannelData(0);
    const b = createDuoBuffer2(fakeCtx, "B").getChannelData(0);
    assert.equal(a.length, b.length);
    let nonZero = 0;
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i], b[i], `sample ${i} differs`);
      if (a[i] !== 0) nonZero++;
    }
    assert.ok(nonZero > a.length * 0.9, "\u6837\u4F8B\u5E94\u5F53\u51E0\u4E4E\u5904\u5904\u6709\u4FE1\u53F7");
  });
  it("\u5355\u97F3 440Hz\u30013 \u79D2\u3001\u5355\u58F0\u9053", async () => {
    const { createToneBuffer: createToneBuffer2 } = await Promise.resolve().then(() => (init_samples(), samples_exports));
    const buf = createToneBuffer2(fakeCtx);
    assert.equal(buf.numberOfChannels, 1);
    assert.equal(buf.length, 48e3 * 3);
    assert.ok(Math.abs(buf.getChannelData(0)[0]) < 0.01);
  });
});
