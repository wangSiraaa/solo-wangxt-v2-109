import { AudioEngine } from './audioEngine';

/** 模块级单例：整个应用共享同一个 AudioContext 与声轨节点 */
export const engine = new AudioEngine();
