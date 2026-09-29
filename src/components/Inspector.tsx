import type { Vec3 } from '../types';
import type { WorkbenchApi } from '../state/useWorkbench';

function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="num-field" title={hint}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** 选中声源的精确坐标编辑（与拖拽同一数据源） */
export function Inspector({ api }: { api: WorkbenchApi }) {
  const track = api.doc.tracks.find((t) => t.id === api.selectedId);
  if (!track) {
    return (
      <div className="panel inspector empty">
        <p>在 3D 场景或 2D 俯视图中点击一个声源以编辑精确坐标。</p>
        <p className="muted">
          坐标约定：<b>+X 右</b>、<b>+Y 上</b>、<b>+Z 后</b>；听者 yaw=0 时朝向 <b>-Z（前方）</b>。
          声源在听者右侧时右耳更响。
        </p>
      </div>
    );
  }

  const setPos = (patch: Partial<Vec3>) =>
    api.moveTrack(track.id, { ...track.position, ...patch });

  return (
    <div className="panel inspector">
      <div className="panel-title">
        <span className="track-color" style={{ background: track.color }} />
        声源参数 · {track.name}
      </div>
      <div className="num-grid">
        <NumberField label="X 右 (m)" value={track.position.x} onChange={(x) => setPos({ x })} />
        <NumberField label="Y 上 (m)" value={track.position.y} onChange={(y) => setPos({ y })} />
        <NumberField label="Z 后 (m)" value={track.position.z} onChange={(z) => setPos({ z })} />
      </div>
      <label className="num-field wide">
        <span>名称</span>
        <input
          type="text"
          value={track.name}
          onChange={(e) => api.updateTrack(track.id, { name: e.target.value })}
        />
      </label>
    </div>
  );
}
