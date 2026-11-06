import type { ReactNode } from 'react';
import type { UiMode } from '../lib/mode';

/**
 * 启动与模式切换共用同一张 Loading 卡片：
 * 品牌方块会转圈，下面依次是标题、说明、进度条和百分比。
 */
export function LoadingScreen({
  mode,
  progress,
  title,
  hint,
  phase = 'in',
  maximum = 99,
}: {
  mode: UiMode;
  progress: number;
  title: string;
  hint: string;
  phase?: 'in' | 'out';
  maximum?: number;
}): ReactNode {
  return (
    <div
      className={`mode-veil mode-veil--${mode} is-${phase}`}
      role="status"
      aria-label={title}
      aria-busy={phase === 'in'}
    >
      <div className="mode-veil__card">
        <div className="mode-veil__brand">
          <span className="loading-mark" aria-hidden />
          CourseDesk
        </div>
        <div className="mode-veil__title">{title}</div>
        <div className="mode-veil__hint">{hint}</div>
        <div
          className="mode-veil__bar"
          role="progressbar"
          aria-label="加载进度"
          aria-valuemin={1}
          aria-valuemax={maximum}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="mode-veil__meta">
          <span>{phase === 'out' ? '就绪' : '请稍候'}</span>
          <span>{progress}%</span>
        </div>
      </div>
    </div>
  );
}
