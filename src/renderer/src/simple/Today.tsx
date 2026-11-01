import { useMemo, type ReactNode } from 'react';
import type { ClassEvent } from '@shared/types';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { ago, hhmm } from '../lib/format';
import { SBadge, SBtn, SCard, SDot, SEmpty, SRow } from './ui';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 相邻同标题事件折叠，避免"轮询失败 ×8"把时间线刷满 */
function foldEvents(events: ClassEvent[]): { event: ClassEvent; repeat: number }[] {
  const out: { event: ClassEvent; repeat: number }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.event.title === e.title && (last.event.detail ?? '') === (e.detail ?? '')) last.repeat += 1;
    else out.push({ event: e, repeat: 1 });
  }
  return out;
}

function toneOf(level: ClassEvent['level']): 'ok' | 'warn' | 'err' | 'info' {
  if (level === 'error') return 'err';
  if (level === 'warn') return 'warn';
  if (level === 'success') return 'ok';
  return 'info';
}

export function Today({ snap, call, onNavigate }: PageProps & { onNavigate: (t: string) => void }): ReactNode {
  const now = useTick(1000);
  const yt = snap.yuketang;
  const cx = snap.chaoxing;
  const onLesson = yt.onLesson;
  const signs = cx.actives.filter((a) => a.ongoing);
  const homework = [...yt.homework, ...cx.homework].slice(0, 5);
  const driftChanged = snap.drift.results.filter((r) => r.changed);
  const important = snap.events.filter((e) => e.level === 'warn' || e.level === 'error').length;
  const running = yt.monitor.running || cx.monitor.running;

  const hour = new Date(now).getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 19 ? '下午好' : '晚上好';
  const d = new Date(now);
  const dateText = `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK[d.getDay()]}`;
  const connections = [yt.auth.logged, cx.auth.logged].filter(Boolean).length;

  const timeline = useMemo(() => foldEvents([...snap.events].slice(-8).reverse()), [snap.events]);

  return (
    <div className="s-container">
      <div className="s-hero">
        <h1 className="s-hero__title">{greeting}</h1>
        <p className="s-hero__sub">
          {dateText} ·{' '}
          {connections === 2
            ? '两个平台都已连接'
            : connections === 1
              ? '已连接 1 个平台'
              : '尚未连接平台'}
          {running ? '' : ' · 自动检查已暂停'}
        </p>
      </div>

      {driftChanged.length > 0 && (
        <div className="s-note">
          <svg className="s-note__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <div style={{ flex: 1 }}>
            <strong>{driftChanged.map((r) => r.label).join('、')} 的结构变了</strong>
            <div style={{ marginTop: 2, opacity: 0.85 }}>平台可能更新了接口。功能若异常，去设置里的「接口变更提醒」看详情。</div>
          </div>
          <SBtn size="sm" variant="ghost" onClick={() => onNavigate('settings')}>
            查看
          </SBtn>
        </div>
      )}

      <div className="s-grid s-grid--wide-left">
        <div className="s-stack">
          <SCard
            className={`s-card--tight${onLesson.length ? ' s-card--accent' : ''}`}
            title={
              <>
                <SDot tone={onLesson.length ? 'ok' : 'idle'} />
                正在上课
              </>
            }
            hint={onLesson.length ? '进入课堂会同时记录出勤' : '当前没有课在进行'}
            actions={onLesson.length > 0 ? <SBadge tone="ok">{onLesson.length} 节</SBadge> : undefined}
          >
            {onLesson.length === 0 ? (
              <SEmpty compact title="没有进行中的课堂" hint="开课后这里会出现，并给你发系统通知" />
            ) : (
              <div className="s-stack s-stack--tight">
                {onLesson.map((item) => (
                  <SRow
                    key={item.lessonId}
                    leading={<SDot tone="ok" />}
                    title={item.courseName}
                    sub={item.classroomName ?? '课堂'}
                    trailing={
                      <SBtn
                        variant="primary"
                        size="sm"
                        onClick={() => void call((api) => api.ytEnterLesson(item.lessonId, item.classroomId, item.courseName))}
                      >
                        进入课堂
                      </SBtn>
                    }
                  />
                ))}
              </div>
            )}
          </SCard>

          <SCard
            className="s-card--tight"
            title={
              <>
                <SDot tone={signs.length ? 'warn' : 'idle'} />
                待签到
              </>
            }
            hint={signs.length ? '学习通有进行中的签到活动' : '学习通暂无签到'}
            actions={
              <SBtn size="sm" variant="ghost" onClick={() => onNavigate('chaoxing')}>
                全部活动
              </SBtn>
            }
          >
            {signs.length === 0 ? (
              <SEmpty compact title="没有待处理的签到" hint={`上次检查 ${ago(cx.monitor.lastPollAt, now)}`} />
            ) : (
              <div className="s-stack s-stack--tight">
                {signs.slice(0, 4).map((a) => (
                  <SRow
                    key={a.id}
                    leading={<SDot tone="warn" />}
                    title={a.courseName}
                    sub={a.title}
                    trailing={
                      <SBtn size="sm" variant="primary" onClick={() => void call((api) => api.cxSign(a.id))}>
                        签到
                      </SBtn>
                    }
                  />
                ))}
              </div>
            )}
          </SCard>

          <SCard
            className="s-card--tight"
            title="作业与任务"
            hint={homework.length ? '最近的几条' : '暂时没有抓取到作业'}
            actions={
              <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.ytRefresh())}>
                刷新
              </SBtn>
            }
          >
            {homework.length === 0 ? (
              <SEmpty compact title="没有待完成的作业" hint="雨课堂部分学校不返回作业列表" />
            ) : (
              <div className="s-stack s-stack--tight">
                {homework.map((h) => (
                  <SRow
                    key={`${h.platform}-${h.id}`}
                    title={h.title}
                    sub={`${h.courseName} · ${h.platform === 'yuketang' ? '雨课堂' : '学习通'}`}
                    trailing={<SBadge tone={h.statusText.includes('未') ? 'warn' : 'ok'}>{h.statusText}</SBadge>}
                  />
                ))}
              </div>
            )}
          </SCard>
        </div>

        <div className="s-stack">
          <SCard title="平台状态">
            <SRow
              leading={<SDot tone={yt.auth.logged ? 'ok' : 'err'} />}
              title="雨课堂"
              sub={yt.auth.logged ? `${yt.courses.length} 门课程 · 在课 ${yt.onLesson.length}` : '未连接'}
              trailing={
                <SBtn size="sm" variant={yt.auth.logged ? 'ghost' : 'soft'} onClick={() => void call((api) => api.ytLogin())}>
                  {yt.auth.logged ? '重新登录' : '连接'}
                </SBtn>
              }
            />
            <SRow
              leading={<SDot tone={cx.auth.logged ? 'ok' : 'err'} />}
              title="学习通"
              sub={cx.auth.logged ? `${cx.courses.length} 门课程 · 活动 ${cx.actives.length}` : '未连接'}
              trailing={
                <SBtn size="sm" variant={cx.auth.logged ? 'ghost' : 'soft'} onClick={() => onNavigate('chaoxing')}>
                  {cx.auth.logged ? '查看' : '登录'}
                </SBtn>
              }
            />
            <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--s-dim)' }}>
              上次检查：雨课堂 {ago(yt.monitor.lastPollAt, now)} · 学习通 {ago(cx.monitor.lastPollAt, now)}
            </div>
          </SCard>

          <SCard
            title="今天的时间线"
            hint={snap.events.length ? `最近 ${snap.events.length} 条里有 ${important} 条需要留意` : '连接平台后开始记录'}
            actions={
              <SBtn size="sm" variant="ghost" onClick={() => onNavigate('log')}>
                全部
              </SBtn>
            }
          >
            {timeline.length === 0 ? (
              <SEmpty compact title="还没有动态" hint="连接平台后开始记录" />
            ) : (
              <div>
                {timeline.map(({ event: e, repeat }) => (
                  <div className="s-ev" key={e.id} style={{ gridTemplateColumns: '44px 8px minmax(0,1fr)' }}>
                    <span className="s-ev__time">{hhmm(e.at)}</span>
                    <span className={`s-ev__dot s-ev__dot--${toneOf(e.level)}`} />
                    <div>
                      <div className="s-ev__title">
                        {e.title}
                        {repeat > 1 && (
                          <span style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--s-dim-2)' }}>×{repeat}</span>
                        )}
                      </div>
                      {e.detail && <div className="s-ev__detail">{e.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SCard>

          <SCard title="快捷操作">
            <div className="s-stack s-stack--tight">
              <SBtn full variant="ghost" onClick={() => void call((api) => api.ytRefresh())}>
                刷新雨课堂
              </SBtn>
              <SBtn full variant="ghost" onClick={() => void call((api) => api.cxRefresh())}>
                刷新学习通
              </SBtn>
              <SBtn full variant="ghost" onClick={() => void call((api) => api.toggleMonitors(!running))}>
                {running ? '暂停自动检查' : '恢复自动检查'}
              </SBtn>
              <SBtn full variant="soft" onClick={() => onNavigate('settings')}>
                设置
              </SBtn>
            </div>
          </SCard>
        </div>
      </div>
    </div>
  );
}
