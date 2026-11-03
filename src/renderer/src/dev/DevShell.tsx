import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSnapshot } from '@shared/types';
import type { Call } from '../lib/store';
import { useTick } from '../lib/store';
import { ago } from '../lib/format';
import { Sidebar, TitleBar, type Tab } from '../components/Chrome';
import { Overview } from '../components/Overview';
import { YuketangPage } from '../components/YuketangPage';
import { ChaoxingPage } from '../components/ChaoxingPage';
import { EventsPage } from '../components/EventsPage';
import { DriftPage } from '../components/DriftPage';
import { SettingsPage } from '../components/SettingsPage';
import { Lamp, Pill } from '../components/ui';

function Rail({ snap, call }: { snap: AppSnapshot; call: Call }): ReactNode {
  const now = useTick(1000);
  const yt = snap.yuketang;
  const cx = snap.chaoxing;
  const anyRunning = yt.monitor.running || cx.monitor.running;
  const lastPoll = Math.max(yt.monitor.lastPollAt ?? 0, cx.monitor.lastPollAt ?? 0);
  const driftChanged = snap.drift.results.filter((r) => r.changed).length;

  return (
    <div className="rail">
      <div className="rail__cell">
        <div className="rail__group">
          <Lamp tone={yt.auth.logged ? 'ok' : 'err'} pulse={yt.auth.logged} />
          <div>
            <div className="rail__label">YUKETANG</div>
            <div className="small">
              {yt.auth.logged ? `${yt.courses.length} 门课 · 在课 ${yt.onLesson.length}` : '未登录'}
            </div>
          </div>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-soft)' }} />
        <div className="rail__group">
          <Lamp tone={cx.auth.logged ? 'info' : 'err'} pulse={cx.auth.logged} />
          <div>
            <div className="rail__label">CHAOXING</div>
            <div className="small">
              {cx.auth.logged ? `${cx.courses.length} 门课 · 活动 ${cx.actives.length}` : '未登录'}
            </div>
          </div>
        </div>
      </div>

      <div className="rail__cell">
        <div className="rail__group" style={{ flex: 1 }}>
          <div>
            <div className="rail__label">轮询节拍</div>
            <div className="small mono">
              雨课堂 {snap.settings.yuketang.pollIntervalSec}s · 学习通 {snap.settings.chaoxing.pollIntervalSec}s
            </div>
          </div>
        </div>
        <Pill tone={anyRunning ? 'ok' : 'idle'} mono>
          上次 {ago(lastPoll, now)}
        </Pill>
      </div>

      <div className="rail__cell rail__cell--right">
        {driftChanged > 0 && (
          <Pill tone="warn" mono>
            {driftChanged} 项接口变化
          </Pill>
        )}
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            void call((api) => api.ytRefresh());
            void call((api) => api.cxRefresh());
          }}
        >
          全量刷新
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => void call((api) => api.toggleMonitors(!anyRunning))}
        >
          {anyRunning ? '暂停' : '恢复'}
        </button>
      </div>
    </div>
  );
}

const DEV_TABS: Tab[] = ['overview', 'yuketang', 'chaoxing', 'events', 'drift', 'settings'];

/** 普通模式的页面 id → 开发者模式里最接近的一页，切换模式时不丢上下文 */
const FROM_SIMPLE: Record<string, Tab> = { today: 'overview', log: 'events' };

export function DevShell({ snap, ready, call }: { snap: AppSnapshot; ready: boolean; call: Call }): ReactNode {
  const [tab, setTab] = useState<Tab>(() => {
    const fromHash = window.location.hash.replace('#', '');
    if ((DEV_TABS as string[]).includes(fromHash)) return fromHash as Tab;
    return FROM_SIMPLE[fromHash] ?? 'overview';
  });

  useEffect(() => {
    document.body.classList.remove('is-simple');
    document.body.classList.toggle('is-compact', snap.settings.ui.density === 'compact');
    document.documentElement.style.setProperty(
      '--accent-2',
      snap.settings.ui.accent === 'amber' ? '#ffb84d' : snap.settings.ui.accent === 'cyan' ? '#4de1c1' : '#6ed0a2',
    );
  }, [snap.settings.ui.density, snap.settings.ui.accent]);

  const page = useMemo(() => {
    switch (tab) {
      case 'yuketang':
        return <YuketangPage snap={snap} call={call} />;
      case 'chaoxing':
        return <ChaoxingPage snap={snap} call={call} />;
      case 'events':
        return <EventsPage snap={snap} call={call} />;
      case 'drift':
        return <DriftPage snap={snap} call={call} />;
      case 'settings':
        return <SettingsPage snap={snap} call={call} />;
      default:
        return <Overview snap={snap} call={call} onNavigate={setTab} />;
    }
  }, [tab, snap, call]);

  return (
    <div className="app">
      <TitleBar
        snap={snap}
        onToggleMonitor={() => void call((api) => api.toggleMonitors(!snap.yuketang.monitor.running))}
        onSwitchMode={() => void call((api) => api.setMode('simple'))}
      />
      <Sidebar
        tab={tab}
        onChange={(next) => {
          setTab(next);
          if (window.location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`);
        }}
        snap={snap}
      />
      <main className="main">
        <Rail snap={snap} call={call} />
        {!ready && (
          <div className="panel" style={{ animationDelay: '0.1s' }}>
            <div className="inline">
              <Lamp tone="warn" pulse />
              <span className="dim">正在连接主进程…</span>
            </div>
          </div>
        )}
        {ready && page}
        <footer className="inline tiny dim2" style={{ justifyContent: 'space-between', padding: '4px 2px' }}>
          <span>COURSEDESK · 协议依据：GitHub 高星开源项目（详见 docs/协议依据.md）</span>
          <span>数据仅保存在本机 · Electron 运行时</span>
        </footer>
      </main>
    </div>
  );
}
