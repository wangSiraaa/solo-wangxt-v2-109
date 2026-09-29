import { useRef } from 'react';
import { engine } from '../audio/engine';
import { useEngine } from '../state/useEngine';
import type { TrackState } from '../types';

interface Props {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** 数字输入：回车/失焦提交，空值回退到原值 */
function NumberField({
  value,
  step,
  onChange,
  width = 58,
}: {
  value: number;
  step: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  return (
    <input
      type="number"
      className="num"
      style={{ width }}
      defaultValue={Number(value.toFixed(2))}
      step={step}
      key={value.toFixed(3)}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

function TrackCard({ t, index, selected, onSelect }: {
  t: TrackState;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const soloActive = engine.project.tracks.some((x) => x.solo);
  const inaudible = t.muted || (soloActive && !t.solo);

  const setAzimuth = (deg: number) => {
    // 方位快捷：相对听者放置在 2.5m 处，同一平面
    const r = (deg * Math.PI) / 180;
    const lp = engine.project.listener.position;
    engine.setTrackPosition(t.id, {
      x: lp.x - 2.5 * Math.sin(r),
      z: lp.z - 2.5 * Math.cos(r),
      y: lp.y,
    });
  };

  return (
    <div
      className={`track-card ${selected ? 'selected' : ''} ${inaudible ? 'inaudible' : ''}`}
      onClick={onSelect}
    >
      <div className="track-head">
        <span className="track-badge" style={{ background: t.color }}>{index + 1}</span>
        <input
          className="track-name"
          defaultValue={t.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => engine.renameTrack(t.id, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {t.kind === 'file' && (
          <button
            className="mini danger"
            title="删除轨道（同时删除本地缓存）"
            onClick={(e) => {
              e.stopPropagation();
              engine.removeTrack(t.id);
            }}
          >
            ×
          </button>
        )}
        {t.kind !== 'file' && (
          <button
            className="mini danger"
            title="删除样例轨道"
            onClick={(e) => {
              e.stopPropagation();
              engine.removeTrack(t.id);
            }}
          >
            ×
          </button>
        )}
      </div>

      {t.status !== 'ready' && (
        <div className={`track-status ${t.status === 'error' ? 'err' : ''}`}>
          {t.status === 'error'
            ? `⚠ ${t.error ?? '音频错误'}`
            : t.status === 'loading'
              ? '解码中…'
              : '待解锁音频后解码（点击播放即可解锁）'}
        </div>
      )}

      <div className="track-btns" onClick={(e) => e.stopPropagation()}>
        <button className={`pill ${t.muted ? 'on mute-on' : ''}`} onClick={() => engine.toggleMute(t.id)}>
          静音
        </button>
        <button className={`pill ${t.solo ? 'on solo-on' : ''}`} onClick={() => engine.toggleSolo(t.id)}>
          独奏
        </button>
        <button className={`pill ${t.loop ? 'on' : ''}`} onClick={() => engine.toggleLoop(t.id)}>
          循环
        </button>
      </div>

      <div className="row gain-row" onClick={(e) => e.stopPropagation()}>
        <span className="lbl">增益</span>
        <input
          type="range"
          min={-48}
          max={12}
          step={0.5}
          value={t.gainDb}
          onChange={(e) => engine.setTrackGain(t.id, parseFloat(e.target.value))}
        />
        <span className="db">{t.gainDb > 0 ? `+${t.gainDb.toFixed(1)}` : t.gainDb.toFixed(1)} dB</span>
      </div>

      <div className="row pos-row" onClick={(e) => e.stopPropagation()}>
        <span className="lbl">位置</span>
        <label>X<NumberField value={t.position.x} step={0.1} onChange={(v) => engine.setTrackPosition(t.id, { x: v })} /></label>
        <label>Y<NumberField value={t.position.y} step={0.1} onChange={(v) => engine.setTrackPosition(t.id, { y: v })} /></label>
        <label>Z<NumberField value={t.position.z} step={0.1} onChange={(v) => engine.setTrackPosition(t.id, { z: v })} /></label>
      </div>

      {selected && (
        <div className="azimuth" onClick={(e) => e.stopPropagation()}>
          <span className="lbl">方位快捷</span>
          {[
            ['前 0°', 0],
            ['右 +90°', 90],
            ['后 180°', 180],
            ['左 −90°', -90],
          ].map(([name, deg]) => (
            <button key={name as string} className="mini" onClick={() => setAzimuth(deg as number)}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrackPanel({ selectedId, onSelect }: Props) {
  useEngine();
  const tracks = engine.project.tracks;
  const addRef = useRef<HTMLInputElement>(null);

  return (
    <div className="track-panel">
      <div className="panel-head">
        <h2>音轨（{tracks.length}）</h2>
        <div className="panel-actions">
          <button className="mini" title="添加每秒一次的脉冲样例" onClick={() => engine.addSampleTrack('impulse')}>
            + 脉冲
          </button>
          <button className="mini" title="添加 1000Hz 循环单音" onClick={() => engine.addSampleTrack('tone')}>
            + 单音
          </button>
          <button className="mini primary" onClick={() => addRef.current?.click()}>
            + 本地音频
          </button>
          <input
            ref={addRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void engine.importFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <div className="track-list">
        {tracks.length === 0 && (
          <div className="empty-hint">
            还没有音轨。<br />
            可添加「脉冲 / 单音」试听样例，或导入本地音频文件（仅保存在本机 IndexedDB，不会上传）。
          </div>
        )}
        {tracks.map((t, i) => (
          <TrackCard
            key={t.id}
            t={t}
            index={i}
            selected={selectedId === t.id}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
