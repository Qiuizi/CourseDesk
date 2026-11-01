import { useMemo, useState, type ReactNode } from 'react';
import type { ClassEvent, EventKind } from '@shared/types';
import type { PageProps } from '../lib/store';
import { hhmmss } from '../lib/format';
import { SBadge, SCard, SEmpty } from './ui';

const KIND_LABEL: Record<EventKind, string> = {
  system: '系统',
  auth: '登录',
  lesson: '课堂',
  problem: '题目',
  answer: '答题',
  sign: '签到',
  homework: '作业',
  video: '视频',
  protocol: '协议',
  network: '网络',
};

type Platform = 'all' | 'yuketang' | 'chaoxing';
type Level = 'all' | 'important' | 'success';

function toneOf(level: ClassEvent['level']): 'ok' | 'warn' | 'err' | 'info' {
  if (level === 'error') return 'err';
  if (level === 'warn') return 'warn';
  if (level === 'success') return 'ok';
  return 'info';
}

/** 相邻同标题事件折叠成一条（轮询失败之类的重复噪音） */
function fold(events: ClassEvent[]): { event: ClassEvent; repeat: number }[] {
  const out: { event: ClassEvent; repeat: number }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.event.title === e.title && (last.event.detail ?? '') === (e.detail ?? '')) {
      last.repeat += 1;
    } else {
      out.push({ event: e, repeat: 1 });
    }
  }
  return out;
}

export function SimpleLog({ snap }: PageProps): ReactNode {
  const [platform, setPlatform] = useState<Platform>('all');
  const [level, setLevel] = useState<Level>('all');
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return [...snap.events]
      .reverse()
      .filter((e) => {
        if (platform !== 'all' && e.platform !== platform) return false;
        if (level === 'important' && e.level !== 'warn' && e.level !== 'error') return false;
        if (level === 'success' && e.level !== 'success') return false;
        if (k && !`${e.title}${e.detail ?? ''}${KIND_LABEL[e.kind] ?? ''}`.toLowerCase().includes(k)) return false;
        return true;
      });
  }, [snap.events, platform, level, keyword]);

  const rows = useMemo(() => fold(filtered), [filtered]);
  const important = snap.events.filter((e) => e.level === 'warn' || e.level === 'error').length;
  const unknownOps = Object.entries(snap.drift.unknownOps ?? {});

  return (
    <div className="s-container">
      <div className="s-hero">
        <h1 className="s-hero__title">记录</h1>
        <p className="s-hero__sub">
          两个平台的动态都记在这里 · 保留最近 {snap.events.length} 条 · 全部只存在本机
        </p>
      </div>

      <SCard className="s-card--tight">
        <div className="s-toolbar">
          <div className="s-seg">
            {(['all', 'yuketang', 'chaoxing'] as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                className={platform === p ? 'is-active' : ''}
                onClick={() => setPlatform(p)}
              >
                {p === 'all' ? '全部' : p === 'yuketang' ? '雨课堂' : '学习通'}
              </button>
            ))}
          </div>
          <div className="s-seg">
            {(['all', 'important', 'success'] as Level[]).map((l) => (
              <button key={l} type="button" className={level === l ? 'is-active' : ''} onClick={() => setLevel(l)}>
                {l === 'all' ? '全部级别' : l === 'important' ? '只看重要' : '只看成功'}
              </button>
            ))}
          </div>
          <input
            className="s-input s-toolbar__search"
            value={keyword}
            spellCheck={false}
            placeholder="搜索标题或详情"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <span style={{ flex: 1 }} />
          <SBadge tone={important > 0 ? 'warn' : 'ok'}>{important} 条需要留意</SBadge>
        </div>
      </SCard>

      <SCard
        className="s-card--tight"
        title="时间线"
        hint={rows.length ? `${filtered.length} 条匹配` : '没有匹配的记录'}
      >
        {rows.length === 0 ? (
          <SEmpty
            compact
            title={snap.events.length ? '没有匹配的记录' : '还没有动态'}
            hint={snap.events.length ? '换个筛选条件试试' : '连接平台后，开课、签到、答题都会记在这里'}
          />
        ) : (
          <div>
            {rows.map(({ event: e, repeat }) => (
              <div className="s-ev" key={e.id}>
                <span className="s-ev__time">{hhmmss(e.at)}</span>
                <span className={`s-ev__dot s-ev__dot--${toneOf(e.level)}`} />
                <div>
                  <div className="s-ev__title">
                    {e.title}
                    {repeat > 1 && (
                      <span style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--s-dim-2)' }}>×{repeat}</span>
                    )}
                  </div>
                  {e.detail && (
                    <div
                      className="s-ev__detail"
                      style={{
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                      title={e.detail}
                    >
                      {e.detail}
                    </div>
                  )}
                </div>
                <span className="s-ev__meta">
                  {e.platform === 'yuketang' ? '雨课堂' : '学习通'} · {KIND_LABEL[e.kind] ?? e.kind}
                </span>
              </div>
            ))}
          </div>
        )}
      </SCard>

      {unknownOps.length > 0 && (
        <SCard
          className="s-card--tight"
          title="课堂上出现了没见过的消息"
          hint="通常是平台加了新功能，已经在后台记录下来"
        >
          <div className="s-toolbar" style={{ gap: 8 }}>
            {unknownOps.map(([op, count]) => (
              <SBadge key={op} tone="warn">
                {op} × {count}
              </SBadge>
            ))}
          </div>
        </SCard>
      )}
    </div>
  );
}
