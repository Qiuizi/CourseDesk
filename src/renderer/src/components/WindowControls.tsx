import type { ReactNode } from 'react';

/** macOS 风格的红黄绿三个小圆点：只用颜色和悬停反馈，不画符号 */
export function WindowControls(): ReactNode {
  const api = window.coursedesk;
  return (
    <div className="win-ctl" aria-label="窗口控制">
      <button type="button" className="win-ctl__dot win-ctl__dot--close" title="关闭（收进托盘）" aria-label="关闭窗口" onClick={() => void api?.closeWindow()} />
      <button type="button" className="win-ctl__dot win-ctl__dot--min" title="最小化" aria-label="最小化" onClick={() => void api?.minimize()} />
      <button type="button" className="win-ctl__dot win-ctl__dot--max" title="最大化 / 还原" aria-label="最大化或还原" onClick={() => void api?.toggleMaximize()} />
    </div>
  );
}
