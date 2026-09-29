import { useRef } from 'react';
import type { WorkbenchApi } from '../state/useWorkbench';
import { Meter } from './Meter';
import { gainToDb } from '../lib/spatial';
import type { SourceType } from '../types';

interface Props {
  api: WorkbenchApi;
}

export function MasterBar({ api }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (files: FileList | null) => {
    if (files) void api.addFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="master-bar">
      <div className="master-add">
        <label className="btn">
          ＋ 导入本地音轨
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        <div className="sample-buttons">
          <button className="btn" onClick={() => api.addSample('pulse')}>
            脉冲
          </button>
          <button className="btn" onClick={() => api.addSample('tone')}>
            单音
          </button>
          <button className="btn" onClick={() => addDuo(api)}>
            双声源 A+B
          </button>
        </div>
      </div>

      <div className="master-transport">
        <button className="btn primary" onClick={() => api.playAll()}>
          ▶ 全部播放（同步检查）
        </button>
        <button className="btn" onClick={() => api.stopAll()}>
          ⏹ 全部停止
        </button>
      </div>

      <div className="master-gains">
        <label className="gain-fader">
          <span>总线</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={api.doc.busGain}
            onChange={(e) => api.setBusGain(Number(e.target.value))}
          />
          <b>{gainToDb(api.doc.busGain)}</b>
        </label>
        <label className="gain-fader master">
          <span>主输出</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={api.doc.masterGain}
            onChange={(e) => api.setMasterGain(Number(e.target.value))}
          />
          <b>{gainToDb(api.doc.masterGain)}</b>
        </label>
      </div>

      <Meter levels={api.levels} onClear={api.clearClips} />
    </div>
  );
}

/** 一次性放入一对逐采样相同的双声源，便于试听相位同步 */
async function addDuo(api: WorkbenchApi) {
  const a: Exclude<SourceType, 'file'> = 'duoA';
  const b: Exclude<SourceType, 'file'> = 'duoB';
  await api.addSample(a);
  await api.addSample(b);
}
