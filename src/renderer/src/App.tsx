import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LoadingScreen } from './components/LoadingScreen';
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
  const [booted, setBooted] = useState(false);
  const [progress, setProgress] = useState(1);
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
      setProgress(1);
      setVeil({ mode: next, phase: 'in' });
      // IPC 失败时释放遮罩，允许重试，不把失败显示成加载完成。
      timers.current.push(window.setTimeout(() => setVeil(null), 10000));
    };
    window.addEventListener('coursedesk:switch-mode', onSwitch);
    return () => {
      window.removeEventListener('coursedesk:switch-mode', onSwitch);
      clearAll();
    };
  }, []);

  useEffect(() => {
    if (!veil || veil.phase !== 'in') return;
    const started = performance.now();
    // 这是切换动画进度；到 99% 后等待新模式实际就绪。
    const interval = window.setInterval(() => {
      setProgress(Math.min(99, 1 + Math.floor((performance.now() - started) / 1200 * 98)));
    }, 40);
    return () => window.clearInterval(interval);
  }, [veil]);

  useEffect(() => {
    if (!veil || veil.phase !== 'in' || veil.mode !== mode || progress < 99) return;
    const timer = window.setTimeout(() => {
      // 新界面已经画好，这时才让主进程换标题栏色块
      void window.coursedesk?.chromeReady?.(mode);
      setVeil((v) => (v ? { ...v, phase: 'out' } : v));
      timers.current.push(window.setTimeout(() => setVeil(null), 260));
    }, 140);
    timers.current.push(timer);
    return () => window.clearTimeout(timer);
  }, [mode, veil, progress]);

  const finishBoot = useCallback(() => setBooted(true), []);
  const shell = !ready || !booted ? (
    <SimpleSplash mode={mode} ready={ready} onDone={finishBoot} />
  ) : mode === 'simple' ? (
    <SimpleShell snap={snap} call={call} />
  ) : (
    <DevShell snap={snap} ready={ready} call={call} />
  );

  return (
    <>
      {shell}
      {veil && (
        <LoadingScreen
          mode={veil.mode}
          phase={veil.phase}
          progress={progress}
          title={`正在切换到${veil.mode === 'dev' ? '开发者' : '普通'}模式`}
          hint="界面正在切换，数据不会中断"
        />
      )}
    </>
  );
}
