// 共享类型定义

/** 轨道数据源类型 */
export type TrackKind = 'file' | 'sample-impulse' | 'sample-tone';

/** 文件轨道在解码前的就绪状态 */
export type TrackStatus = 'pending' | 'loading' | 'ready' | 'error';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ListenerState {
  /** 听者位置（米） */
  position: Vec3;
  /**
   * 偏航角（度，逆时针为正，俯视几何角）。
   * 0 表示朝向 -Z；90 表示朝向 -X（听者左侧）。
   */
  yaw: number;
  /** 俯仰角（度，向上为正），仅影响前向向量 */
  pitch: number;
}

export interface TrackState {
  id: string;
  name: string;
  kind: TrackKind;
  position: Vec3;
  gainDb: number;
  muted: boolean;
  solo: boolean;
  loop: boolean;
  color: string;
  status: TrackStatus;
  /** 错误原因（解码失败等），用于分别提示 */
  error?: string;
  /** 生成样例专用：脉冲/单音参数 */
  sample?: {
    type: 'impulse' | 'tone';
    frequency?: number;
    intervalSec?: number;
  };
  /** 已解码时长（秒），由引擎填充，不持久化也无妨 */
  durationSec?: number;
}

export interface Project {
  id: string;
  name: string;
  updatedAt: number;
  tracks: TrackState[];
  listener: ListenerState;
  masterGainDb: number;
  /** 每条轨道的播放偏移（秒），停止时保存，重载后恢复但不自动播放 */
  offsets: Record<string, number>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}
