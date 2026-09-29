import { useEffect, useState } from 'react';
import { engine } from './audio/engine';
import { useEngine } from './state/useEngine';
import Scene3D from './components/Scene3D';
import Map2D from './components/Map2D';
import TrackPanel from './components/TrackPanel';
import Transport from './components/Transport';
import ListenerPanel from './components/ListenerPanel';
import HelpModal from './components/HelpModal';

/**
 * 方位/同步检查场景：
 * 1) 脉冲单源 —— 放在右侧，检验瞬态方位与 L/R 含义
 * 2) 单音 —— 放在左侧，检验持续声像
 * 3) 双声源 —— 两轨同样的脉冲对称放置，检验同步（应正前方稳定声像，无回声/拍频）
 */
async function loadDemo() {
  await engine.stop();
  for (const id of engine.project.tracks.map((t) => t.id)) engine.removeTrack(id);
  engine.renameProject('方位与同步检查');
  engine.addSampleTrack('impulse');
  engine.setTrackPosition(engine.project.tracks[0].id, { x: 2.5, y: 1.6, z: 0 });
  engine.project.tracks[0].name = '脉冲·右 +90°';
  engine.addSampleTrack('tone');
  engine.setTrackPosition(engine.project.tracks[1].id, { x: -2.5, y: 1.6, z: 0 });
  engine.project.tracks[1].name = '单音·左 −90°';
  engine.addSampleTrack('impulse');
  engine.setTrackPosition(engine.project.tracks[2].id, { x: -2.2, y: 1.6, z: -1.2 });
  engine.project.tracks[2].name = '双声源A·前左';
  engine.addSampleTrack('impulse');
  engine.setTrackPosition(engine.project.tracks[3].id, { x: 2.2, y: 1.6, z: -1.2 });
  engine.project.tracks[3].name = '双声源B·前右';
  engine.setListener({ position: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0 });
  await engine.save();
}

export default function App() {
  useEngine();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [saving, setSaving] = useState(false);

  // 离开页面前尽量把布局落盘
  useEffect(() => {
    const flush = () => void engine.save();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const doSave = async () => {
    setSaving(true);
    await engine.save();
    setTimeout(() => setSaving(false), 600);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🎧 空间声像工作台</div>
        <input
          className="project-name"
          value={engine.project.name}
          onChange={(e) => engine.renameProject(e.target.value)}
        />
        <select
          className="project-select"
          value={engine.project.id}
          onChange={(e) => void engine.loadProject(e.target.value)}
          title="切换本工程（参数恢复，不自动播放）"
        >
          {engine.projects.length === 0 && <option value={engine.project.id}>当前工程</option>}
          {engine.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {new Date(p.updatedAt).toLocaleString()}
            </option>
          ))}
        </select>
        <button className="tbtn small" onClick={() => void engine.newProject()}>新建</button>
        <button className="tbtn small" onClick={() => void doSave()}>{saving ? '已保存 ✓' : '保存'}</button>
        <button className="tbtn small" onClick={() => void loadDemo()}>载入试听样例</button>
        <button className="tbtn small ghost" onClick={() => setShowHelp(true)}>说明 / 检查步骤</button>
      </header>

      <div className="main">
        <aside className="sidebar">
          <ListenerPanel />
          <TrackPanel selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <section className="stage">
          <div className="pane pane-3d">
            <div className="pane-title">三维视图（轨道观察，拖拽鼠标旋转/平移）</div>
            <Scene3D />
          </div>
          <div className="pane pane-2d">
            <div className="pane-title">二维操作入口（俯视：上为前 −Z，右为 +X；L 蓝 / R 红）</div>
            <Map2D selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </section>
      </div>

      <Transport />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
