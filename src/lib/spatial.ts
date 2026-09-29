import type { ListenerState, Vec3 } from '../types';

export const UP: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * 听者朝向（前方）向量。
 * yaw=0 时为 -Z（屏幕深处）；yaw 正值 = 向右转身，yaw=+90° 时前方为 +X。
 * pitch 正值 = 向上抬头。
 */
export function forwardVector(yaw: number, pitch = 0): Vec3 {
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

/**
 * 听者右方向量（仅由 yaw 决定，俯仰不改变右向量）。
 * yaw=0 时为 +X；满足 right = forward × up。
 */
export function rightVector(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function yawToDegrees(yaw: number): number {
  const deg = (yaw * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * 声源相对于听者的水平方位角（度，-180..180）。
 * 正值 = 听者右侧，负值 = 左侧；0 = 正前方，±180 = 正后方。
 * 与 PannerNode HRTF、Three.js 场景使用同一套坐标与朝向。
 */
export function relativeAzimuth(source: Vec3, listener: ListenerState): number {
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

/** 三维距离（米） */
export function distanceTo(source: Vec3, listener: Vec3): number {
  return length(sub(source, listener));
}

/** 仰角（度）：正为高于听者 */
export function elevationAngle(source: Vec3, listener: Vec3): number {
  const rel = sub(source, listener);
  const horiz = Math.hypot(rel.x, rel.z);
  return (Math.atan2(rel.y, horiz) * 180) / Math.PI;
}

/** 方位角的人类可读描述，明确左右含义 */
export function describeAzimuth(az: number): string {
  const a = Math.abs(az);
  let dir: string;
  if (a < 5) dir = '正前';
  else if (a > 175) dir = '正后';
  else dir = az > 0 ? `右偏 ${a.toFixed(0)}°` : `左偏 ${a.toFixed(0)}°`;
  return dir;
}

/**
 * 按 PannerNode 距离模型计算理论增益（用于界面显示，真实衰减由浏览器执行）。
 * https://www.w3.org/TR/webaudio/#distance-model
 */
export function distanceGain(
  distance: number,
  model: 'exponential' | 'inverse' | 'linear',
  refDistance: number,
  rolloffFactor: number,
  maxDistance: number,
): number {
  const d = Math.max(distance, 0.0001);
  let g = 1;
  switch (model) {
    case 'linear':
      g = 1 - rolloffFactor * ((d - refDistance) / (maxDistance - refDistance));
      break;
    case 'inverse':
      g = refDistance / (refDistance + rolloffFactor * Math.max(d - refDistance, 0));
      break;
    case 'exponential':
      g = Math.pow(Math.max(d, refDistance) / refDistance, -rolloffFactor);
      break;
  }
  return Math.min(1, Math.max(0, g));
}

/** 线性增益 -> dB（显示用） */
export function gainToDb(g: number): string {
  if (g <= 0.0001) return '-∞';
  return `${(20 * Math.log10(g)).toFixed(1)} dB`;
}
