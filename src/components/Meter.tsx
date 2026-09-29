import type { LevelState } from '../types';

interface Props {
  levels: LevelState;
  onClear: () => void;
}

/** 输出链末端真实峰值表（L/R），锁存削波指示 */
export function Meter({ levels, onClear }: Props) {
  return (
    <div className="meter">
      <MeterBar label="L" peak={levels.l} clip={levels.clipL} />
      <MeterBar label="R" peak={levels.r} clip={levels.clipR} />
      <button
        className={`clip-clear ${levels.clipL || levels.clipR ? 'armed' : ''}`}
        onClick={onClear}
        title="清除削波锁存"
      >
        {levels.clipL || levels.clipR ? 'CLIP!' : 'PEAK'}
      </button>
    </div>
  );
}

function MeterBar({ label, peak, clip }: { label: string; peak: number; clip: boolean }) {
  // 0..1.5 线性映射到 -∞..+3.5dBFS 区间显示；>=1 红区
  const db = peak <= 0.00001 ? -Infinity : 20 * Math.log10(peak);
  const pct = Math.max(0, Math.min(1, (db + 48) / 51));
  const segments = 24;
  const lit = Math.round(pct * segments);
  return (
    <div className={`meter-bar ${clip ? 'clip' : ''}`}>
      <span className="meter-label">{label}</span>
      <div className="meter-segments">
        {Array.from({ length: segments }).map((_, i) => {
          const on = i < lit;
          // 顶部 3 段对应 0dBFS 以上红区
          const danger = i >= segments - 3;
          return (
            <span
              key={i}
              className={`meter-seg ${on ? 'on' : ''} ${danger ? 'danger' : ''}`}
            />
          );
        })}
      </div>
      <span className="meter-db">{db === -Infinity ? '-∞' : `${db.toFixed(1)}`}</span>
    </div>
  );
}
