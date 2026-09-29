import { useEffect, useRef } from 'react';
import { createScene } from '../three/Scene3D';
import type { Vec3 } from '../types';
import type { WorkbenchApi } from '../state/useWorkbench';

interface Props {
  api: WorkbenchApi;
  onMoveSource: (id: string, pos: Vec3) => void;
  onMoveListener: (pos: Vec3) => void;
}

export function Scene3DView({ api, onMoveSource, onMoveListener }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReturnType<typeof createScene> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    handleRef.current = createScene(ref.current, {
      onSelectSource: api.selectTrack,
      onMoveSource,
      onMoveListener,
    });
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // 场景只创建一次；回调通过 props 闭包，内部使用最新 state 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.sync(api.doc.tracks, api.doc.listener, api.selectedId);
  }, [api.doc.tracks, api.doc.listener, api.selectedId]);

  return <div className="scene3d" ref={ref} />;
}
