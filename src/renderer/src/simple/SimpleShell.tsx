import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSnapshot } from '@shared/types';
import type { Call } from '../lib/store';
import { SDot } from './ui';
import { ModeSwitch } from '../components/ModeSwitch';
import { WindowControls } from '../components/WindowControls';
import { switchMode } from '../lib/mode';
import { Today } from './Today';
import { SimpleYuketang } from './SimpleYuketang';
import { SimpleChaoxing } from './SimpleChaoxing';
import { SimpleLog } from './SimpleLog';
import { SimpleSettings } from './SimpleSettings';

type STab = 'today' | 'yuketang' | 'chaoxing' | 'log' | 'settings';

const TABS: { id: STab; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'yuketang', label: '雨课堂' },
  { id: 'chaoxing', label: '学习通' },
  { id: 'log', label: '记录' },
  { id: 'settings', label: '设置' },
];

const TAB_IDS = TABS.map((t) => t.id) as string[];

/** 开发者模式的页面 id → 普通模式里最接近的一页 */
const FROM_DEV: Record<string, STab> = { overview: 'today', events: 'log', drift: 'settings' };

function readHash(): STab {
  const fromHash = window.location.hash.replace('#', '');
  if (TAB_IDS.includes(fromHash)) return fromHash as STab;
  return FROM_DEV[fromHash] ?? 'today';
}

export function SimpleShell({ snap, call }: { snap: AppSnapshot; call: Call }): ReactNode {
  const [tab, setTab] = useState<STab>(readHash);
  const yt = snap.yuketang;
  const cx = snap.chaoxing;
  const important = snap.events.filter((e) => e.level === 'warn' || e.level === 'error').length;

  useEffect(() => {
    document.body.classList.add('is-simple');
    return () => document.body.classList.remove('is-simple');
  }, []);

  // 浏览器前进/后退、以及从开发者模式切回来时，以 hash 为准
  useEffect(() => {
    const onHash = (): void => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: STab) => {
    setTab(next);
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`);
  }, []);

  const page =
    tab === 'yuketang' ? (
      <SimpleYuketang snap={snap} call={call} />
    ) : tab === 'chaoxing' ? (
      <SimpleChaoxing snap={snap} call={call} />
    ) : tab === 'log' ? (
      <SimpleLog snap={snap} call={call} />
    ) : tab === 'settings' ? (
      <SimpleSettings snap={snap} call={call} />
    ) : (
      <Today snap={snap} call={call} onNavigate={(t) => go(t as STab)} />
    );

  return (
    <div className="s-app">
      <header className="s-topbar">
        <div className="s-brand">
          <span className="s-brand__dot" />
          CourseDesk
        </div>
        <nav className="s-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`s-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => go(t.id)}
            >
              {t.label}
              {t.id === 'log' && important > 0 && <span className="s-tab__badge">{important > 99 ? '99+' : important}</span>}
            </button>
          ))}
        </nav>
        <div className="s-topbar__spacer" />
        <div className="s-conn">
          <button type="button" className="s-conn__item s-conn__item--btn" onClick={() => go('yuketang')}>
            <SDot tone={yt.auth.logged ? 'ok' : 'err'} />
            雨课堂
          </button>
          <button type="button" className="s-conn__item s-conn__item--btn" onClick={() => go('chaoxing')}>
            <SDot tone={cx.auth.logged ? 'ok' : 'err'} />
            学习通
          </button>
        </div>
        <ModeSwitch mode={snap.settings.ui.mode} onChange={switchMode} />
        <WindowControls />
      </header>
      <main className="s-main">{page}</main>
    </div>
  );
}

export function SimpleSplash({ ready, onDone }: { ready: boolean; onDone: () => void }): ReactNode {
  const [pct, setPct] = useState(1);
  const started = useRef(0);
  const finished = useRef(false);

  // 1% → 99% 的渐进：约 1.2 秒走完，之后停在 99 等主进程就绪
  useEffect(() => {
    started.current = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started.current;
      const next = Math.min(99, Math.round(1 + (elapsed / 1200) * 98));
      setPct((prev) => (next > prev ? next : prev));
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!ready || finished.current) return;
    const elapsed = performance.now() - started.current;
    const waitForRamp = Math.max(0, 1250 - elapsed);
    const toFull = window.setTimeout(() => setPct(100), waitForRamp);
    const done = window.setTimeout(() => {
      finished.current = true;
      onDone();
    }, waitForRamp + 320);
    return () => {
      window.clearTimeout(toFull);
      window.clearTimeout(done);
    };
  }, [ready, onDone]);

  const stage = pct < 35 ? '读取本地配置' : pct < 70 ? '恢复登录状态' : pct < 99 ? '准备界面' : '就绪';

  return (
    <div className="s-splash">
      <div className="s-splash__card">
        <div className="s-splash__brand">
          <span className="s-splash__mark" aria-hidden />
          CourseDesk
        </div>
        <div className="s-splash__title">正在连接工作台</div>
        <div className="s-splash__hint">配置、日志、登录态都只在本机</div>
        <div className="s-splash__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="s-splash__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="s-splash__meta">
          <span>{stage}</span>
          <span>{pct}%</span>
        </div>
      </div>
    </div>
  );
}
