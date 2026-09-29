import { useCallback, useState } from 'react';
import { useWorkbench } from './state/useWorkbench';
import { Scene3DView } from './components/Scene3DView';
import { Plan2D } from './components/Plan2D';
import { TrackRow } from './components/TrackRow';
import { Inspector } from './components/Inspector';
import { ListenerPanel } from './components/ListenerPanel';
import { SpatialPanel } from './components/SpatialPanel';
import { MasterBar } from './components/MasterBar';
import { ProjectBar } from './components/ProjectBar';
import { UnlockOverlay } from './components/UnlockOverlay';
import type { Vec3 } from './types';

export default function App() {
  const api = useWorkbench();
  const [view, setView] = useState<'3d' | '2d'>('3d');

  const onMoveSource = useCallback(
    (id: string, pos: Vec3) => api.moveTrack(id, pos),
    [api],
  );
  const onMoveListener = useCallback(
    (pos: Vec3) => api.setListener({ position: pos }),
    [api],
  );
  const onRotateListener = useCallback(
    (yaw: number) => api.setListener({ yaw }),
    [api],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">◉</span> 空间声像工作台
          <span className="brand-sub">HRTF · PannerNode · 纯本地浏览器</span>
        </div>
        <div className="view-switch">
          <button className={`btn small ${view === '3d' ? 'active' : ''}`} onClick={() => setView('3d')}>
            3D 场景
          </button>
          <button className={`btn small ${view === '2d' ? 'active' : ''}`} onClick={() => setView('2d')}>
            2D 俯视
          </button>
        </div>
        <div className="coords-help">
          右手坐标：<b>+X 右耳方向</b> · <b>+Y 上</b> · <b>听者前方 −Z</b> · yaw 正值向右转身
        </div>
      </header>

      <ProjectBar api={api} />

      <div className="layout">
        <aside className="sidebar left">
          <MasterBar api={api} />
          <div className="track-list">
            {api.doc.tracks.length === 0 && (
              <div className="empty-hint">
                还没有声轨。
                <br />
                导入本地音频，或添加
                <button className="btn inline" onClick={() => api.addSample('pulse')}>
                  脉冲
                </button>
                /
                <button className="btn inline" onClick={() => api.addSample('tone')}>
                  单音
                </button>
                /
                <button className="btn inline" onClick={() => MasterBarAddDuo(api)}>
                  双声源
                </button>
                样例检查方位与同步。
              </div>
            )}
            {api.doc.tracks.map((t) => (
              <TrackRow key={t.id} track={t} api={api} />
            ))}
          </div>
        </aside>

        <main className="stage">
          <div className={`view-container ${view === '3d' ? 'show' : ''}`}>
            <Scene3DView api={api} onMoveSource={onMoveSource} onMoveListener={onMoveListener} />
          </div>
          <div className={`view-container ${view === '2d' ? 'show' : ''}`}>
            <Plan2D
              tracks={api.doc.tracks}
              listener={api.doc.listener}
              selectedId={api.selectedId}
              onSelect={api.selectTrack}
              onMoveSource={onMoveSource}
              onMoveListener={onMoveListener}
              onRotateListener={onRotateListener}
            />
          </div>
        </main>

        <aside className="sidebar right">
          <ListenerPanel api={api} />
          <Inspector api={api} />
          <SpatialPanel api={api} />
        </aside>
      </div>

      {api.globalError && (
        <div className="global-toast">
          ⚠ {api.globalError}
          <button className="btn mini" onClick={api.dismissGlobalError}>
            知道了
          </button>
        </div>
      )}
      <UnlockOverlay api={api} />
    </div>
  );
}

/** 空状态下直接添加一对双声源 */
function MasterBarAddDuo(api: ReturnType<typeof useWorkbench>) {
  void api.addSample('duoA').then(() => api.addSample('duoB'));
}
