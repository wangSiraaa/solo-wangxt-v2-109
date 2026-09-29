import type { DistanceModel } from '../types';
import type { WorkbenchApi } from '../state/useWorkbench';

const MODELS: { value: DistanceModel; label: string; formula: string }[] = [
  {
    value: 'inverse',
    label: 'inverse 反距离',
    formula: 'g = refDistance / (refDistance + rolloff · max(d − ref, 0))',
  },
  {
    value: 'linear',
    label: 'linear 线性',
    formula: 'g = 1 − rolloff · (d − ref) / (max − ref)',
  },
  {
    value: 'exponential',
    label: 'exponential 指数',
    formula: 'g = (max(d, ref) / ref) ^ (−rolloff)',
  },
];

export function SpatialPanel({ api }: { api: WorkbenchApi }) {
  const s = api.doc.spatial;
  const current = MODELS.find((m) => m.value === s.distanceModel)!;
  return (
    <div className="panel">
      <div className="panel-title">HRTF 与距离衰减</div>
      <label className="num-field wide">
        <span>距离模型（PannerNode.distanceModel）</span>
        <select
          value={s.distanceModel}
          onChange={(e) => api.setSpatial({ distanceModel: e.target.value as DistanceModel })}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="formula muted">{current.formula}</div>
      <div className="num-grid three">
        <label className="num-field">
          <span>refDistance (m)</span>
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={s.refDistance}
            onChange={(e) => api.setSpatial({ refDistance: Math.max(0.01, Number(e.target.value)) })}
          />
        </label>
        <label className="num-field">
          <span>rolloffFactor</span>
          <input
            type="number"
            min={0}
            step={0.05}
            value={s.rolloffFactor}
            onChange={(e) => api.setSpatial({ rolloffFactor: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="num-field">
          <span>maxDistance (m)</span>
          <input
            type="number"
            min={0.01}
            step={1}
            value={s.maxDistance}
            onChange={(e) => api.setSpatial({ maxDistance: Math.max(0.01, Number(e.target.value)) })}
          />
        </label>
      </div>
      <label className="slider-field">
        <span>
          移动平滑时间常数 <b>{(s.positionTimeConstant * 1000).toFixed(0)} ms</b>
          <em className="muted">（仅平滑参数，不重启声源）</em>
        </span>
        <input
          type="range"
          min={5}
          max={300}
          step={5}
          value={s.positionTimeConstant * 1000}
          onChange={(e) =>
            api.setSpatial({ positionTimeConstant: Number(e.target.value) / 1000 })
          }
        />
      </label>
      <p className="muted small">
        定位模型固定为 <code>HRTF</code>（PannerNode.panningModel），衰减由浏览器在音频线程实时计算；
        界面显示的距离增益仅为同公式的理论值。
      </p>
    </div>
  );
}
