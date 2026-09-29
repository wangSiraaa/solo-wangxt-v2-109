/** 共享类型定义 */

export type DistanceModel = 'exponential' | 'inverse' | 'linear';

export type SourceType = 'file' | 'pulse' | 'tone' | 'duoA' | 'duoB';

export type TrackStatus =
  | 'pending' // 等待音频解锁后解码/生成
  | 'loading'
  | 'ready'
  | 'decode-error';

export interface Track {
  id: string;
  name: string;
  sourceType: SourceType;
  /** file 类型时为 IDB 中的 Blob 键；内置样例重新生成，不需要持久化音频 */
  blobKey?: string;
  originalFileName?: string;
  loop: boolean;
  muted: boolean;
  solo: boolean;
  /** 推子线性增益（0..1.5），真实进入音频链 */
  gain: number;
  /** 立体声文件选用的输入声道：HRTF 需要单声道输入 */
  channel: number;
  /** 解码后文件的声道数（决定 UI 是否显示 L/R 选择） */
  channels?: number;
  /** UI 颜色 */
  color: string;
  /** 声源世界坐标，单位米，右手系：+X 右，+Y 上，+Z 朝向屏幕（听者后方） */
  position: Vec3;
  status: TrackStatus;
  errorMessage?: string;
  duration?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ListenerState {
  position: Vec3;
  /** 偏航角（弧度），绕世界 +Y 轴；yaw=0 时朝向 -Z（屏幕内） */
  yaw: number;
  /** 俯仰角（弧度），绕本地右向量，正为向上看 */
  pitch: number;
  /** 听者耳高基准（暂以 position.y 为准，保留字段） */
  earHeight: number;
}

export interface SpatialSettings {
  distanceModel: DistanceModel;
  refDistance: number;
  rolloffFactor: number;
  maxDistance: number;
  /** PannerNode 内部平滑时间（秒），移动时不中断音频 */
  positionTimeConstant: number;
  /** HRTF 内部分辨率（部分浏览器不支持读取/设置则忽略） */
  hrtfIR: 'none';
}

export interface ProjectDoc {
  version: 1;
  tracks: Track[];
  listener: ListenerState;
  spatial: SpatialSettings;
  busGain: number;
  masterGain: number;
  savedAt: number;
  name?: string;
}

export interface NamedProject {
  id: string;
  name: string;
  savedAt: number;
  doc: ProjectDoc;
}

export interface LevelState {
  /** 线性峰值 0..1+ */
  l: number;
  r: number;
  /** 锁存的削波标记（任意采样 >= 1.0） */
  clipL: boolean;
  clipR: boolean;
}

export type UnlockState = 'locked' | 'unlocking' | 'unlocked' | 'failed';

export interface ProgressInfo {
  trackId: string;
  current: number;
  duration: number;
}
