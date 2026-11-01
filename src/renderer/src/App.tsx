import { type ReactNode } from 'react';
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

  if (!ready) return <SimpleSplash />;

  return snap.settings.ui.mode === 'simple' ? (
    <SimpleShell snap={snap} call={call} />
  ) : (
    <DevShell snap={snap} ready={ready} call={call} />
  );
}
