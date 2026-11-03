import type { ReactNode } from 'react';
import { Lamp, Pill } from './ui';
import { ModeSwitch } from './ModeSwitch';
import { useTick } from '../lib/store';
import type { AppSnapshot } from '@shared/types';
import { hhmmss } from '../lib/format';

export function TitleBar({
  snap,
  onToggleMonitor,
  onSetMode,
}: {
  snap: AppSnapshot;
  onToggleMonitor: () => void;
  onSetMode: (mode: 'simple' | 'dev') => void;
}): ReactNode {
  const now = useTick(1000);
  const running = snap.yuketang.monitor.running || snap.chaoxing.monitor.running;
  return (
    <div className="titlebar">
      <div className="titlebar__mark">
        <span className="logo-dot" />
        <span>
          COURSE<b>DESK</b>
        </span>
      </div>
      <div className="titlebar__sub">
        双平台课程工作台 · 本地运行 · v{snap.version}
      </div>
      <div className="titlebar__spacer" />
      <button
        type="button"
        className={`btn btn--sm ${running ? 'btn--ghost' : 'btn--primary'}`}
        onClick={onToggleMonitor}
        title={running ? '暂停两个平台的轮询' : '恢复轮询'}
      >
        <Lamp tone={running ? 'ok' : 'idle'} pulse={running} />
        {running ? '监控运行中' : '监控已暂停'}
      </button>
      <ModeSwitch mode={snap.settings.ui.mode} onChange={onSetMode} />
      <div className="titlebar__clock">{hhmmss(now)}</div>
    </div>
  );
}

const ICONS: Record<string, ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" />
    </svg>
  ),
  yuketang: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M4 17.5 9.5 12l3.5 3.2L20 7" />
      <circle cx="9.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="15.2" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20" cy="7" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  chaoxing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M4.5 12.5 9 17l10-10" />
      <path d="M3 20h18" opacity="0.45" />
    </svg>
  ),
  events: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M3 12h3.5l2-5 3 10 2.5-7 1.8 4H21" />
    </svg>
  ),
  drift: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
};

export type Tab = 'overview' | 'yuketang' | 'chaoxing' | 'events' | 'drift' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'yuketang', label: '雨课堂' },
  { id: 'chaoxing', label: '学习通' },
  { id: 'events', label: '事件流' },
  { id: 'drift', label: '协议' },
  { id: 'settings', label: '设置' },
];

export function Sidebar({
  tab,
  onChange,
  snap,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  snap: AppSnapshot;
}): ReactNode {
  const ytOk = snap.yuketang.auth.logged;
  const cxOk = snap.chaoxing.auth.logged;
  const unread = snap.events.filter((e) => e.level === 'warn' || e.level === 'error').length;
  const driftChanged = snap.drift.results.filter((r) => r.changed).length;
  return (
    <aside className="sidebar">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`nav${tab === t.id ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {ICONS[t.id]}
          <span className="nav__label">{t.label}</span>
          {t.id === 'drift' && driftChanged > 0 && (
            <span
              className="pill pill--warn pill--mono"
              style={{ padding: '0 4px', fontSize: 8.5, lineHeight: 1.4 }}
            >
              {driftChanged}
            </span>
          )}
          {t.id === 'events' && unread > 0 && (
            <span
              className="pill pill--warn pill--mono"
              style={{ padding: '0 4px', fontSize: 8.5, lineHeight: 1.4 }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      ))}
      <div className="sidebar__foot">
        <div className="beat" title="雨课堂登录态">
          <Lamp tone={ytOk ? 'ok' : 'err'} pulse={ytOk} />
          <span>YK</span>
        </div>
        <div className="beat" title="学习通登录态">
          <Lamp tone={cxOk ? 'info' : 'err'} pulse={cxOk} />
          <span>CX</span>
        </div>
        <Pill tone={snap.yuketang.monitor.running ? 'ok' : 'idle'} mono>
          {snap.yuketang.monitor.running ? 'RUN' : 'PAUSE'}
        </Pill>
      </div>
    </aside>
  );
}
