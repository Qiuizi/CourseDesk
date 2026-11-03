import { useEffect, type ReactNode } from 'react';
import { useEngine } from './lib/store';
import { DevShell } from './dev/DevShell';
import { SimpleShell, SimpleSplash } from './simple/SimpleShell';

/**
 * 顶层路由：只决定"用哪套界面"。
 *  - simple：浅色、少术语，给日常使用
 *  - dev：深色控制台，带协议检测 / 事件流 / 日志
 * 两套界面共享同一个 Engine 与 IPC，切换不影响正在跑的任务。
 */
export default function App(): ReactNode {
  const { snap, ready, call } = useEngine();

  // 收进托盘 / 切到后台时暂停所有动画，别让脉冲灯和 spinner 继续烧 GPU
  useEffect(() => {
    const sync = (): void => {
      document.body.classList.toggle('is-hidden', document.hidden);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  if (!ready) return <SimpleSplash />;

  return snap.settings.ui.mode === 'simple' ? (
    <SimpleShell snap={snap} call={call} />
  ) : (
    <DevShell snap={snap} ready={ready} call={call} />
  );
}
