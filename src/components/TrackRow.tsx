import { useEffect, useState } from 'react';
import type { Track } from '../types';
import { engine } from '../lib/engineInstance';
import {
  describeAzimuth,
  distanceGain,
  distanceTo,
  elevationAngle,
  gainToDb,
  relativeAzimuth,
} from '../lib/spatial';
import type { ListenerState, SpatialSettings } from '../types';
import type { WorkbenchApi } from '../state/useWorkbench';

interface Props {
  track: Track;
  api: WorkbenchApi;
}

function fmt(t: number | null): string {
  if (t == null || !isFinite(t)) return '--:--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackRow({ track, api }: Props) {
  const { doc, playingIds } = api;
  const playing = playingIds.has(track.id);
  const [progress, setProgress] = useState(0);
  const listener: ListenerState = doc.listener;
  const spatial: SpatialSettings = doc.spatial;

  // 播放进度（rAF 轮询引擎读数；停止/暂停自动冻结）
  useEffect(() => {
    if (!playing) {
      setProgress(engine.getProgress(track.id) ?? 0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setProgress(engine.getProgress(track.id) ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, track.id]);

  const az = relativeAzimuth(track.position, listener);
  const dist = distanceTo(track.position, listener.position);
  const elev = elevationAngle(track.position, listener.position);
  const dGain = distanceGain(
    dist,
    spatial.distanceModel,
    spatial.refDistance,
    spatial.rolloffFactor,
    spatial.maxDistance,
  );

  const statusText =
    track.status === 'decode-error'
      ? '解码失败'
      : track.status === 'loading'
        ? '解码中…'
        : track.status === 'pending'
          ? api.unlock === 'locked'
            ? '待解锁'
            : '就绪'
          : '就绪';

  return (
    <div className={`track-row ${api.selectedId === track.id ? 'selected' : ''}`}>
      <div className="track-head">
        <span className="track-color" style={{ background: track.muted ? '#555a63' : track.color }} />
        <button
          className="track-name"
          onClick={() => api.selectTrack(api.selectedId === track.id ? null : track.id)}
          title={track.originalFileName ?? track.name}
        >
          {track.name}
        </button>
        <span className={`track-status ${track.status === 'decode-error' ? 'error' : ''}`}>
          {statusText}
        </span>
      </div>

      {track.status === 'decode-error' && (
        <div className="track-error" title={track.errorMessage}>
          ⚠ {track.errorMessage ?? '解码失败'}
        </div>
      )}

      <div className="track-transport">
        <button
          className="btn small"
          onClick={() => api.togglePlay(track.id)}
          disabled={track.status === 'decode-error'}
          title={playing ? '暂停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button className="btn small" onClick={() => api.stop(track.id)} title="停止">
          ⏹
        </button>
        <label className="loop-toggle" title="循环">
          <input
            type="checkbox"
            checked={track.loop}
            onChange={(e) => api.updateTrack(track.id, { loop: e.target.checked })}
          />
          循环
        </label>
        <button
          className={`btn small ${track.muted ? 'active' : ''}`}
          onClick={() => api.updateTrack(track.id, { muted: !track.muted })}
        >
          M
        </button>
        <button
          className={`btn small ${track.solo ? 'solo' : ''}`}
          onClick={() => api.updateTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
        <button className="btn small ghost danger" onClick={() => api.removeTrack(track.id)} title="删除">
          ✕
        </button>
      </div>

      <div className="track-gain">
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={track.gain}
          onChange={(e) => api.updateTrack(track.id, { gain: Number(e.target.value) })}
        />
        <span className="gain-readout">{gainToDb(track.muted ? 0 : track.gain)}</span>
      </div>

      <div
        className="track-progress"
        onClick={(e) => {
          if (track.duration == null) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          void api.seek(track.id, ratio * track.duration);
        }}
      >
        <div className="track-progress-fill" style={{ width: `${track.duration ? (progress / track.duration) * 100 : 0}%` }} />
        <span className="track-time">
          {fmt(progress)} / {fmt(track.duration ?? null)}
        </span>
      </div>

      <div className="track-spatial-readout">
        <span className={az > 0 ? 'side-r' : az < 0 ? 'side-l' : ''}>{describeAzimuth(az)}</span>
        <span>{dist.toFixed(2)} m</span>
        <span>仰角 {elev.toFixed(0)}°</span>
        <span title="距离模型造成的理论衰减（真实衰减由 PannerNode 执行）">
          距离增益 {gainToDb(dGain)}
        </span>
      </div>

      {track.channels && track.channels > 1 ? (
        <div className="track-channel">
          输入声道：
          {Array.from({ length: track.channels }).map((_, i) => (
            <button
              key={i}
              className={`btn mini ${track.channel === i ? 'active' : ''}`}
              onClick={() => api.updateTrack(track.id, { channel: i })}
              title={i === 0 ? '文件原始左声道 L' : i === 1 ? '文件原始右声道 R' : `声道 ${i + 1}`}
            >
              {i === 0 ? 'L（原始左）' : i === 1 ? 'R（原始右）' : `CH${i + 1}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
