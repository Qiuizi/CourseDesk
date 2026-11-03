import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEngine } from './lib/store';
import type { UiMode } from './lib/mode';
import { DevShell } from './dev/DevShell';
import { SimpleShell, SimpleSplash } from './simple/SimpleShell';

/**
 * 顶层路由：只决定"用哪套界面"。
 *  - simple：浅色、少术语，给日常使用
 *  - dev：深色控制台，带协议检测 / 事件流 / 日志
 * 两套界面共享同一个 Engine 与 IPC，切换不影响正在跑的任务。
 *
 * 切换时先铺一层同色遮罩，盖住挂载抖动和原生标题栏换色，再淡出。
 */
export default function App(): ReactNode {
  const { snap, ready, call } = useEngine();
  const mode = snap.settings.ui.mode;
  const [veil, setVeil] = useState<{ mode: UiMode; phase: 'in' | 'out' } | null>(null);
  const timers = useRef<number[]>([]);

  // 收进托盘 / 切到后台时暂停所有动画，别让脉冲灯和 spinner 继续烧 GPU
  useEffect(() => {
    const sync = (): void => {
      document.body.classList.toggle('is-hidden', document.hidden);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    const clearAll = (): void => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    const onSwitch = (event: Event): void => {
      const next = (event as CustomEvent<UiMode>).detail;
      clearAll();
      setVeil({ mode: next, phase: 'in' });
      // 兜底：切换失败也别一直盖着
      timers.current.push(
        window.setTimeout(() => setVeil((v) => (v ? { ...v, phase: 'out' } : v)), 2000),
      );
    };
    window.addEventListener('coursedesk:switch-mode', onSwitch);
    return () => {
      window.removeEventListener('coursedesk:switch-mode', onSwitch);
      clearAll();
    };
  }, []);

  useEffect(() => {
    if (!veil || veil.phase !== 'in' || veil.mode !== mode) return;
    const timer = window.setTimeout(() => {
      // 新界面已经画好，这时才让主进程换标题栏色块
      void window.coursedesk?.chromeReady?.(mode);
      setVeil((v) => (v ? { ...v, phase: 'out' } : v));
      timers.current.push(window.setTimeout(() => setVeil(null), 260));
    }, 140);
    timers.current.push(timer);
    return () => window.clearTimeout(timer);
  }, [mode, veil]);

  const shell = !ready ? (
    <SimpleSplash />
  ) : mode === 'simple' ? (
    <SimpleShell snap={snap} call={call} />
  ) : (
    <DevShell snap={snap} ready={ready} call={call} />
  );

  return (
    <>
      {shell}
      {veil && (
        <div
          className={`mode-veil is-${veil.phase}`}
          style={{ background: veil.mode === 'dev' ? '#0a0d0b' : '#f7f9f6' }}
          aria-hidden
        >
          <div className="mode-veil__inner">
            <span className="mode-veil__mark" aria-hidden />
            <span>{veil.mode === 'dev' ? '切换到开发者模式' : '回到普通模式'}</span>
            <span className="mode-veil__bar" aria-hidden />
          </div>
        </div>
      )}
    </>
  );
}
