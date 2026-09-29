import { engine } from '../audio/engine';
import { useEngine } from '../state/useEngine';
import { listenerForward } from '../audio/engine';

function NumberField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="num"
      style={{ width: 64 }}
      defaultValue={Number(value.toFixed(2))}
      step={0.1}
      key={value.toFixed(3)}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

/** 听者位置与朝向的精确数值入口（二维拖动为主，这里用于精确编辑） */
export default function ListenerPanel() {
  useEngine();
  const l = engine.project.listener;
  const f = listenerForward(l);

  return (
    <div className="listener-panel">
      <h2>听者</h2>
      <div className="row">
        <span className="lbl">位置</span>
        <label>X<NumberField value={l.position.x} onChange={(v) => engine.setListener({ position: { ...l.position, x: v } })} /></label>
        <label>Y<NumberField value={l.position.y} onChange={(v) => engine.setListener({ position: { ...l.position, y: v } })} /></label>
        <label>Z<NumberField value={l.position.z} onChange={(v) => engine.setListener({ position: { ...l.position, z: v } })} /></label>
      </div>
      <div className="row">
        <span className="lbl">朝向</span>
        <label>偏航<NumberField value={l.yaw} onChange={(v) => engine.setListener({ yaw: v })} /></label>
        <label>俯仰<NumberField value={l.pitch} onChange={(v) => engine.setListener({ pitch: v })} /></label>
      </div>
      <div className="forward-hint">
        前向向量（{f.x.toFixed(2)}, {f.y.toFixed(2)}, {f.z.toFixed(2)}）
        <span className="lr-note">L = −X 侧（蓝耳） · R = +X 侧（红耳）</span>
      </div>
    </div>
  );
}
