import { forwardVector, rightVector, yawToDegrees } from '../lib/spatial';
import type { WorkbenchApi } from '../state/useWorkbench';

export function ListenerPanel({ api }: { api: WorkbenchApi }) {
  const l = api.doc.listener;
  const fwd = forwardVector(l.yaw, l.pitch);
  const right = rightVector(l.yaw);
  const yawDeg = yawToDegrees(l.yaw);
  const pitchDeg = (l.pitch * 180) / Math.PI;

  return (
    <div className="panel">
      <div className="panel-title">听者（头相关位置）</div>
      <div className="num-grid">
        <label className="num-field">
          <span>X (m)</span>
          <input
            type="number"
            step={0.1}
            value={Number(l.position.x.toFixed(3))}
            onChange={(e) => api.setListener({ position: { x: Number(e.target.value) } })}
          />
        </label>
        <label className="num-field">
          <span>Y (m)</span>
          <input
            type="number"
            step={0.1}
            value={Number(l.position.y.toFixed(3))}
            onChange={(e) => api.setListener({ position: { y: Number(e.target.value) } })}
          />
        </label>
        <label className="num-field">
          <span>Z (m)</span>
          <input
            type="number"
            step={0.1}
            value={Number(l.position.z.toFixed(3))}
            onChange={(e) => api.setListener({ position: { z: Number(e.target.value) } })}
          />
        </label>
      </div>

      <label className="slider-field">
        <span>
          偏航 yaw <b>{yawDeg.toFixed(0)}°</b>
          <em className="muted">（0° 朝 -Z，+90° 朝 +X 即右转）</em>
        </span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(yawDeg > 180 ? yawDeg - 360 : yawDeg)}
          onChange={(e) => api.setListener({ yaw: (Number(e.target.value) * Math.PI) / 180 })}
        />
      </label>
      <label className="slider-field">
        <span>
          俯仰 pitch <b>{pitchDeg.toFixed(0)}°</b>
          <em className="muted">（正为向上）</em>
        </span>
        <input
          type="range"
          min={-60}
          max={60}
          step={1}
          value={Math.round(pitchDeg)}
          onChange={(e) => api.setListener({ pitch: (Number(e.target.value) * Math.PI) / 180 })}
        />
      </label>

      <div className="listener-vec muted">
        <span>
          前方 (
          {fwd.x.toFixed(2)}, {fwd.y.toFixed(2)}, {fwd.z.toFixed(2)})
        </span>
        <span>
          右方 (
          {right.x.toFixed(2)}, {right.y.toFixed(2)}, {right.z.toFixed(2)})
        </span>
      </div>
      <div className="listener-actions">
        <button
          className="btn small"
          onClick={() => {
            api.setListener({ yaw: 0, pitch: 0 });
          }}
        >
          朝向归零
        </button>
        <button
          className="btn small"
          onClick={() =>
            api.setListener({ position: { x: 0, y: 0, z: 3 } })
          }
        >
          位置归位
        </button>
        <button className="btn small" onClick={() => api.setListener({ yaw: l.yaw - Math.PI / 12 })}>
          ↺ 左转 15°
        </button>
        <button className="btn small" onClick={() => api.setListener({ yaw: l.yaw + Math.PI / 12 })}>
          右转 15° ↻
        </button>
      </div>
    </div>
  );
}
