import type { Settings } from '@shared/types';

export type UiMode = Settings['ui']['mode'];

/**
 * 切换界面模式：先让 App 铺一层同色遮罩（盖住挂载抖动与原生标题栏换色），
 * 再走 IPC；主进程等渲染层确认后才重设窗口按钮色块，避免闪一下。
 */
export function switchMode(mode: UiMode): void {
  window.dispatchEvent(new CustomEvent<UiMode>('coursedesk:switch-mode', { detail: mode }));
  // 等遮罩铺满再换，避免 React 挂载抖动露在切换瞬间
  window.setTimeout(() => {
    const api = window.coursedesk;
    if (api) void api.setMode(mode);
  }, 150);
}
