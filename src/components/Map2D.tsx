import { useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { useEngine } from '../state/useEngine';

const LIMIT = 11; // 与引擎的 POS_LIMIT 一致
const VIEW = 12; // viewBox 半边长

type DragMode =
  | { kind: 'source'; id: string }
  | { kind: 'listener-move' }
  | { kind: 'listener-rotate' }
  | null;

interface Props {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * 二维俯视工作台（主要操作入口）。
 * 屏幕右 = 世界 +X = 听者右；屏幕上 = 世界 -Z = 听者前方（yaw=0）。
 * 拖动只写 panner/listener 参数，不重启音轨。
 */
export default function Map2D({ selectedId, onSelect }: Props) {
  useEngine();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragMode>(null);
  const project = engine.project;

  const toWorld = (e: React.PointerEvent): { x: number; z: number } => {
    const svg = svgRef.current!;
    const pt = new DOMPoint(e.clientX, e.clientY);
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, z: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, z: p.y }; // viewBox 中 y 即世界 z
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, z } = toWorld(e);
    if (drag.kind === 'source') {
      engine.setTrackPosition(drag.id, { x, z });
    } else if (drag.kind === 'listener-move') {
      engine.setListener({ position: { ...engine.project.listener.position, x, z } });
    } else if (drag.kind === 'listener-rotate') {
      const lp = engine.project.listener.position;
      // 手柄屏幕偏移正比于 (-sin yaw, -cos yaw)
      const yaw = (Math.atan2(-(x - lp.x), -(z - lp.z)) * 180) / Math.PI;
      engine.setListener({ yaw });
    }
  };

  const endDrag = () => setDrag(null);

  const lp = project.listener.position;
  const soloActive = project.tracks.some((t) => t.solo);

  return (
    <div className="map2d-wrap">
      <svg
        ref={svgRef}
        viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
        className="map2d"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={() => onSelect(null)}
      >
        {/* 网格 */}
        {Array.from({ length: 23 }, (_, i) => i - 11).map((i) => (
          <g key={i} stroke="#243043" strokeWidth={i === 0 ? 1.4 : 0.5}>
            <line x1={i} y1={-LIMIT} x2={i} y2={LIMIT} />
            <line x1={-LIMIT} y1={i} x2={LIMIT} y2={i} />
          </g>
        ))}
        {/* 轴向：+X 红（右），-Z 蓝（前/上） */}
        <line x1={-LIMIT} y1={0} x2={LIMIT} y2={0} stroke="#e05a5a" strokeWidth={1.2} />
        <line x1={0} y1={LIMIT} x2={0} y2={-LIMIT} stroke="#5a9be0" strokeWidth={1.2} />
        <text x={LIMIT - 0.4} y={-0.4} fill="#e08a8a" fontSize={0.8} textAnchor="end">+X 右</text>
        <text x={0.4} y={-LIMIT + 0.9} fill="#8ab8e0" fontSize={0.8}>-Z 前</text>

        {/* 声源：作用距离圆 + 编号球 */}
        {project.tracks.map((t, idx) => {
          const dimmed = t.muted || (soloActive && !t.solo);
          const selected = selectedId === t.id;
          return (
            <g
              key={t.id}
              transform={`translate(${t.position.x},${t.position.z})`}
              style={{ cursor: drag ? 'grabbing' : 'grab', opacity: dimmed ? 0.35 : 1 }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(t.id);
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDrag({ kind: 'source', id: t.id });
              }}
            >
              <circle r={20} fill={t.color} opacity={0.05} />
              <circle r={1} fill="none" stroke={t.color} strokeWidth={0.06} strokeDasharray="0.2 0.2" opacity={0.7} />
              <circle
                r={0.42}
                fill={t.color}
                stroke={selected ? '#fff' : 'rgba(0,0,0,.5)'}
                strokeWidth={selected ? 0.12 : 0.05}
              />
              <text
                y={0.28}
                textAnchor="middle"
                fontSize={0.5}
                fill="#0b0f16"
                fontWeight="bold"
                pointerEvents="none"
              >
                {idx + 1}
              </text>
              <text y={-0.62} textAnchor="middle" fontSize={0.62} fill="#dfe6f2" pointerEvents="none">
                {t.name.length > 8 ? t.name.slice(0, 8) + '…' : t.name}
              </text>
            </g>
          );
        })}

        {/* 听者：本体可拖动，前方手柄可旋转 */}
        <g
          transform={`translate(${lp.x},${lp.z}) rotate(${-project.listener.yaw})`}
        >
          <circle r={1.1} fill="none" stroke="#ffd166" strokeWidth={0.05} strokeDasharray="0.25 0.25" opacity={0.5} />
          {/* 朝向扇形（旋转随 yaw；旋转方向：正 yaw 在屏幕上为逆时针） */}
          <path
            d="M 0 0 L -0.55 -1.1 A 1.1 1.1 0 0 1 0.55 -1.1 Z"
            fill="#ffd166"
            opacity={0.18}
            pointerEvents="none"
          />
          <g
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag({ kind: 'listener-move' });
            }}
          >
            <circle r={0.5} fill="#ffd166" stroke="#8a6d1f" strokeWidth={0.08} />
            <text x={-0.28} y={0.2} fontSize={0.5} fill="#1f6fb0" fontWeight="bold" pointerEvents="none">L</text>
            <text x={0.1} y={0.2} fontSize={0.5} fill="#b03838" fontWeight="bold" pointerEvents="none">R</text>
          </g>
          {/* 旋转手柄位于听者前方（局部 -Y），rotate 正角逆时针 → 与 yaw 一致 */}
          <circle
            cy={-1.1}
            r={0.22}
            fill="#ff8c42"
            stroke="#fff"
            strokeWidth={0.06}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag({ kind: 'listener-rotate' });
            }}
          />
          <text y={0.95} textAnchor="middle" fontSize={0.55} fill="#ffd166" pointerEvents="none">
            听者
          </text>
        </g>
      </svg>
      <div className="map2d-hint">
        拖动彩色球移动声源 · 拖动黄色听者平移 · 拖动橙色手柄转向 · 距离衰减半径 20m
      </div>
    </div>
  );
}
