import { useState } from 'react';
import type { WorkbenchApi } from '../state/useWorkbench';

/**
 * 音频解锁提示。浏览器要求 AudioContext 必须在用户手势中 resume；
 * 解锁失败与“尚未解锁”分开显示。
 * 提示可收起：解锁前仍允许编辑布局与导入文件（参数本地保存，绝不自动播放），
 * 收起后以小徽标形式保留入口。
 */
export function UnlockOverlay({ api }: { api: WorkbenchApi }) {
  const [dismissed, setDismissed] = useState(false);
  if (api.unlock === 'unlocked') return null;
  const failed = api.unlock === 'failed';

  if (dismissed) {
    return (
      <button
        className={`unlock-pill ${failed ? 'failed' : ''}`}
        onClick={() => setDismissed(false)}
        title="展开音频解锁"
      >
        {failed ? '⚠ 音频解锁失败，点击重试' : '🔇 音频未解锁，点击启用'}
      </button>
    );
  }

  return (
    <div className="unlock-overlay">
      <div className={`unlock-card ${failed ? 'failed' : ''}`}>
        <h2>{failed ? '音频解锁失败' : '启用空间音频'}</h2>
        <p>
          浏览器要求先由一次点击来解锁音频输出。所有音频文件只保存在本机 IndexedDB，
          不会上传到任何服务器。
        </p>
        {failed && (
          <p className="unlock-error">
            ⚠ {api.unlockError ?? 'AudioContext 无法启动，请检查浏览器自动播放策略后重试。'}
          </p>
        )}
        <button className="btn primary big" onClick={() => void api.unlockAudio()}>
          {failed ? '重新解锁音频' : '点击解锁并开始试听'}
        </button>
        <p className="muted small">
          解锁前你仍可<a onClick={() => setDismissed(true)} className="dismiss-link">先编辑布局</a>；
          参数会本地保存，但重载后不会自动播放。
        </p>
      </div>
    </div>
  );
}
