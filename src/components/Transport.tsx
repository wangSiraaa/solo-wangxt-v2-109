import { useEffect, useRef, useState } from 'react';
import { engine, dbToGain } from '../audio/engine';
import { useEngine } from '../state/useEngine';

function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function MeterBar({ label, peak, clip }: { label: string; peak: number; clip: boolean }) {
  const db = peak <= 0.00001 ? -60 : 20 * Math.log10(peak);
  const pct = Math.max(0, Math.min(1, (db + 60) / 60));
  return (
    <div className="meter-bar" title={`${label} ${db.toFixed(1)} dBFS`}>
      <span className="meter-tag">{label}</span>
      <div className="meter-track">
        <div
          className={`meter-fill ${clip ? 'clip' : db > -3 ? 'hot' : ''}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className={`meter-clip ${clip ? 'lit' : ''}`}>PEAK</span>
    </div>
  );
}

export default function Transport() {
  useEngine();
  const [, force] = useState(0);
  const rafRef = useRef(0);

  // 峰值表与时钟：rAF 拉取实际输出链（master 之后）的分析数据
  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      force((v) => (v + 1) % 1_000_000);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const peaks = engine.getPeaks();
  const locked = engine.audioState === 'locked';
  const masterGain = dbToGain(engine.project.masterGainDb);

  return (
    <div className="transport">
      <div className="transport-left">
        <button
          className="tbtn play"
          onClick={() => void engine.play()}
          title={locked ? '首次播放将解锁音频（浏览器手势要求）' : '播放（所有轨道同步开始）'}
        >
          {engine.isPlaying ? '▶ 播放中' : '▶ 播放'}
        </button>
        <button className="tbtn" onClick={() => void engine.pause()} disabled={!engine.isPlaying}>
          ⏸ 暂停
        </button>
        <button className="tbtn" onClick={() => void engine.stop()}>
          ⏹ 停止
        </button>
        <span className="clock">{fmt(engine.transportTime())}</span>
        <span className={`audio-badge ${engine.audioState}`}>
          {locked
            ? '音频未解锁'
            : engine.audioState === 'running'
              ? '音频运行中'
              : `音频${engine.audioState}`}
        </span>
      </div>

      <div className="transport-right">
        <div className="meters" onClick={() => engine.resetClip()} title="点击清除峰值过载锁存">
          <MeterBar label="L" peak={peaks.l} clip={peaks.clipL} />
          <MeterBar label="R" peak={peaks.r} clip={peaks.clipR} />
        </div>
        <div className="master">
          <span className="lbl">总线 {engine.project.masterGainDb > 0 ? `+${engine.project.masterGainDb.toFixed(1)}` : engine.project.masterGainDb.toFixed(1)} dB</span>
          <input
            type="range"
            min={-48}
            max={12}
            step={0.5}
            value={engine.project.masterGainDb}
            onChange={(e) => engine.setMasterGain(parseFloat(e.target.value))}
          />
          <span className="gain-linear">×{masterGain.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
