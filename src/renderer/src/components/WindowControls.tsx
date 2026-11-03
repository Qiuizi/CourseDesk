import type { ReactNode } from 'react';

/** 自绘窗口按钮：替代 Windows 原生 caption，切模式时不会闪、也能跟着主题走 */
export function WindowControls(): ReactNode {
  const api = window.coursedesk;
  return (
    <div className="win-ctl" aria-label="窗口控制">
      <button type="button" className="win-ctl__dot win-ctl__dot--min" title="最小化" aria-label="最小化" onClick={() => void api?.minimize()}>
        <span aria-hidden>—</span>
      </button>
      <button type="button" className="win-ctl__dot win-ctl__dot--max" title="最大化 / 还原" aria-label="最大化或还原" onClick={() => void api?.toggleMaximize()}>
        <span aria-hidden>□</span>
      </button>
      <button type="button" className="win-ctl__dot win-ctl__dot--close" title="关闭（收进托盘）" aria-label="关闭窗口" onClick={() => void api?.closeWindow()}>
        <span aria-hidden>×</span>
      </button>
    </div>
  );
}
