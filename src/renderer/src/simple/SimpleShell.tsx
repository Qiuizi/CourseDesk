import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AppSnapshot } from '@shared/types';
import type { Call } from '../lib/store';
import { useTick } from '../lib/store';
import { hhmmss } from '../lib/format';
import { SCard, SDot } from './ui';
import { ModeSwitch } from '../components/ModeSwitch';
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
  const now = useTick(1000);
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
        <ModeSwitch mode={snap.settings.ui.mode} onChange={(m) => void call((api) => api.setMode(m))} />
        <span className="s-conn__item" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {hhmmss(now)}
        </span>
      </header>
      <main className="s-main">{page}</main>
    </div>
  );
}

export function SimpleSplash(): ReactNode {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: '#f5f7f4',
        color: '#141a16',
        fontFamily: "'Segoe UI Variable Text','PingFang SC','Microsoft YaHei UI',system-ui,sans-serif",
      }}
    >
      <SCard title="正在连接工作台…" hint="读取本地配置与登录状态">
        <div style={{ fontSize: 13, color: '#6f7d75' }}>首次启动需要几秒钟</div>
      </SCard>
    </div>
  );
}
