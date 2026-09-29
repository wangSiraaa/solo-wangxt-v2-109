import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListenerState, Track, Vec3 } from '../types';
import { rightVector, forwardVector } from '../lib/spatial';

interface Props {
  tracks: Track[];
  listener: ListenerState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveSource: (id: string, pos: Vec3) => void;
  onMoveListener: (pos: Vec3) => void;
  onRotateListener: (yaw: number) => void;
}

/**
 * 二维俯视操作图。与 3D / Web Audio 使用同一套世界坐标：
 * 屏幕右 = +X，屏幕上 = -Z（听者前方）。听者三角指向即 forwardXZ。
 * 拖拽声源/听者改变 XZ（保持各自高度 Y）；拖听者外圈手柄旋转 yaw。
 */
export function Plan2D({
  tracks,
  listener,
  selectedId,
  onSelect,
  onMoveSource,
  onMoveListener,
  onRotateListener,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<
    | { kind: 'source'; id: string }
    | { kind: 'listener' }
    | { kind: 'rotate' }
    | null
  >(null);

  const RANGE = 10; // 显示 ±10 米
  const SIZE = 520;
  const M = SIZE / (RANGE * 2);
  const toX = (x: number) => SIZE / 2 + x * M;
  const toY = (z: number) => SIZE / 2 + z * M;

  const eventToWorld = useCallback(
    (e: PointerEvent | React.PointerEvent): { x: number; z: number } => {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * SIZE;
      const py = ((e.clientY - rect.top) / rect.height) * SIZE;
      return { x: (px - SIZE / 2) / M, z: (py - SIZE / 2) / M };
    },
    [M],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const w = eventToWorld(e);
      const clamp = (v: number) => Math.max(-RANGE, Math.min(RANGE, v));
      if (drag.kind === 'source') {
        const t = tracks.find((x) => x.id === drag.id);
        onMoveSource(drag.id, { x: clamp(w.x), y: t?.position.y ?? 0, z: clamp(w.z) });
      } else if (drag.kind === 'listener') {
        onMoveListener({
          x: clamp(w.x),
          y: listener.position.y,
          z: clamp(w.z),
        });
      } else if (drag.kind === 'rotate') {
        const dx = w.x - listener.position.x;
        // 屏幕 y 向下 = +Z；yaw 正值右转（前方朝 +X）
        const dy = w.z - listener.position.z;
        const yaw = Math.atan2(dx, -dy);
        onRotateListener(yaw);
      }
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, eventToWorld, tracks, onMoveSource, onMoveListener, onRotateListener, listener.position]);

  const fwd = forwardVector(listener.yaw, 0);
  const right = rightVector(listener.yaw);

  // 听者三角形（本地前 -Z）：顶点世界坐标
  const lp = listener.position;
  const tip: Vec3 = { x: lp.x + fwd.x * 0.8, y: 0, z: lp.z + fwd.z * 0.8 };
  const bl: Vec3 = { x: lp.x - fwd.x * 0.45 + right.x * 0.42, y: 0, z: lp.z - fwd.z * 0.45 + right.z * 0.42 };
  const br: Vec3 = { x: lp.x - fwd.x * 0.45 - right.x * 0.42, y: 0, z: lp.z - fwd.z * 0.45 - right.z * 0.42 };

  const rotateHandle: Vec3 = { x: lp.x + fwd.x * 1.5, y: 0, z: lp.z + fwd.z * 1.5 };

  const gridLines = [];
  for (let i = -RANGE; i <= RANGE; i += 2) {
    gridLines.push(
      <line key={`v${i}`} x1={toX(i)} y1={0} x2={toX(i)} y2={SIZE} stroke="#222a36" strokeWidth={1} />,
    );
    gridLines.push(
      <line key={`h${i}`} x1={0} y1={toY(i)} x2={SIZE} y2={toY(i)} stroke="#222a36" strokeWidth={1} />,
    );
  }

  return (
    <div className="plan2d">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="plan-svg"
        onPointerDown={(e) => {
          if (e.target === svgRef.current) onSelect(null);
        }}
      >
        {gridLines}
        {/* 前半区(-Z)浅色提示 */}
        <rect x={0} y={0} width={SIZE} height={SIZE / 2} fill="rgba(127,209,255,0.05)" />
        <text x={SIZE / 2} y={18} textAnchor="middle" className="plan-axis-label front">
          前 · -Z
        </text>
        <text x={SIZE / 2} y={SIZE - 6} textAnchor="middle" className="plan-axis-label back">
          后 · +Z
        </text>
        <text x={10} y={SIZE / 2} className="plan-axis-label">
          左 -X
        </text>
        <text x={SIZE - 10} y={SIZE / 2} textAnchor="end" className="plan-axis-label">
          右 +X
        </text>

        {/* 原点到听者连线参考 */}
        <line x1={SIZE / 2} y1={SIZE / 2} x2={toX(lp.x)} y2={toY(lp.z)} stroke="#2c3647" strokeDasharray="4 4" />

        {/* 声源 */}
        {tracks.map((t) => {
          const selected = t.id === selectedId;
          return (
            <g
              key={t.id}
              className="plan-source"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(t.id);
                setDrag({ kind: 'source', id: t.id });
              }}
            >
              {selected && (
                <circle cx={toX(t.position.x)} cy={toY(t.position.z)} r={14} fill="none" stroke="#fff" strokeWidth={1.5} />
              )}
              <circle
                cx={toX(t.position.x)}
                cy={toY(t.position.z)}
                r={9}
                fill={t.muted ? '#555a63' : t.color}
                stroke={t.solo ? '#ffe066' : 'rgba(0,0,0,0.4)'}
                strokeWidth={t.solo ? 2.5 : 1}
              />
              <text
                x={toX(t.position.x)}
                y={toY(t.position.z) - 14}
                textAnchor="middle"
                className="plan-source-label"
                fill={t.muted ? '#8a909c' : t.color}
              >
                {t.name.length > 10 ? `${t.name.slice(0, 10)}…` : t.name}
              </text>
            </g>
          );
        })}

        {/* 听者 */}
        <g
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect(null);
            setDrag({ kind: 'listener' });
          }}
          className="plan-listener"
        >
          <polygon
            points={`${toX(tip.x)},${toY(tip.z)} ${toX(bl.x)},${toY(bl.z)} ${toX(br.x)},${toY(br.z)}`}
            fill="#e6edf7"
            stroke="#7fd1ff"
            strokeWidth={1.5}
          />
        </g>
        {/* 朝向旋转手柄 */}
        <circle
          cx={toX(rotateHandle.x)}
          cy={toY(rotateHandle.z)}
          r={7}
          fill="none"
          stroke="#7fd1ff"
          strokeWidth={2}
          className="plan-rotate-handle"
          onPointerDown={(e) => {
            e.stopPropagation();
            setDrag({ kind: 'rotate' });
          }}
        />
      </svg>
      <div className="plan-hint">
        拖动彩色圆点移动声源 · 拖动白色三角移动听者 · 拖蓝色圆环手柄旋转朝向
      </div>
    </div>
  );
}
