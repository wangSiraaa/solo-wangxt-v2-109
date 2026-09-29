import { useState } from 'react';
import type { WorkbenchApi } from '../state/useWorkbench';

export function ProjectBar({ api }: { api: WorkbenchApi }) {
  const [name, setName] = useState(api.loadedProjectName ?? '');
  const [open, setOpen] = useState(false);

  return (
    <div className="project-bar">
      <div className="project-current">
        <span className="muted">工程：</span>
        <b>{api.loadedProjectName ?? '未命名会话（自动保存）'}</b>
        <span className={`save-state ${api.saveState}`}>
          {api.saveState === 'saving' ? '保存中…' : api.saveState === 'saved' ? '已本地保存' : ''}
        </span>
      </div>
      <div className="project-actions">
        <input
          className="project-name-input"
          placeholder="工程名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn small" onClick={() => api.saveProjectAs(name)}>
          另存工程
        </button>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? '收起列表' : '工程列表'}
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            if (confirm('新建将清空当前布局（已另存的工程不受影响），继续？')) void api.newProject();
          }}
        >
          新建
        </button>
      </div>
      {open && (
        <div className="project-list">
          {api.projects.length === 0 && <div className="muted small">还没有保存过工程。</div>}
          {api.projects.map((p) => (
            <div
              key={p.id}
              className={`project-item ${api.loadedProjectId === p.id ? 'active' : ''}`}
            >
              <span className="project-item-name">{p.name}</span>
              <span className="muted small">{new Date(p.savedAt).toLocaleString()}</span>
              <button
                className="btn mini"
                onClick={() => {
                  void api.loadProject(p.id);
                  setOpen(false);
                }}
              >
                载入
              </button>
              <button
                className="btn mini ghost danger"
                onClick={() => {
                  if (confirm(`删除工程「${p.name}」？`)) void api.deleteProject(p.id);
                }}
              >
                删
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
