import { useState, type ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { ago } from '../lib/format';
import { SBadge, SBtn, SCard, SDot, SEmpty, SInput, SRow } from './ui';
import { ProblemCard } from './ProblemCard';

export function SimpleYuketang({ snap, call }: PageProps): ReactNode {
  const now = useTick(1000);
  const yt = snap.yuketang;
  const lesson = yt.lesson;
  const [manualLesson, setManualLesson] = useState('');
  const [manualClassroom, setManualClassroom] = useState('');
  const problems = lesson ? [...lesson.problems].sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)) : [];

  return (
    <div className="s-container">
      <div className="s-hero">
        <h1 className="s-hero__title">雨课堂</h1>
        <p className="s-hero__sub">
          {yt.auth.logged ? `已连接 · ${yt.courses.length} 门课程` : '未连接'} · 上次检查 {ago(yt.monitor.lastPollAt, now)}
        </p>
      </div>

      <div className="s-grid s-grid--wide-left">
        <div className="s-stack">
          <SCard
            title={
              <>
                <SDot tone={yt.onLesson.length ? 'ok' : 'idle'} />
                正在上课
              </>
            }
            actions={
              <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.ytRefresh())}>
                刷新
              </SBtn>
            }
          >
            {yt.onLesson.length === 0 ? (
              <SEmpty title="当前没有课" hint="开课后会自动出现在这里" />
            ) : (
              <div className="s-stack s-stack--tight">
                {yt.onLesson.map((item) => (
                  <SRow
                    key={item.lessonId}
                    leading={<SDot tone="ok" />}
                    title={item.courseName}
                    sub={item.classroomName ?? '课堂'}
                    trailing={
                      <SBtn
                        size="sm"
                        variant="primary"
                        onClick={() => void call((api) => api.ytEnterLesson(item.lessonId, item.classroomId, item.courseName))}
                      >
                        进入
                      </SBtn>
                    }
                  />
                ))}
              </div>
            )}
          </SCard>

          <SCard
            title="课堂题目"
            hint={
              lesson
                ? `已进入课堂 · 共 ${lesson.problems.length} 道题`
                : '进入课堂后，老师解锁的题目会实时出现'
            }
            actions={
              lesson ? (
                <>
                  <SBadge tone={lesson.wsState === 'open' ? 'ok' : 'warn'}>
                    {lesson.wsState === 'open' ? '实时连接' : '连接中'}
                  </SBadge>
                  <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.ytOpenLessonPage(lesson.lessonId))}>
                    课堂页
                  </SBtn>
                </>
              ) : undefined
            }
          >
            {!lesson ? (
              <SEmpty title="还没有进入课堂" hint="从上面选一节课进入，或在下方手动输入课堂号" />
            ) : problems.length === 0 ? (
              <SEmpty title="还没有题目" hint="老师开始答题时会推送到这里" compact />
            ) : (
              <div>
                {problems.map((p) => (
                  <ProblemCard key={p.problemId} problem={p} call={call} now={now} />
                ))}
              </div>
            )}
          </SCard>

          <SCard title="我的课程" hint={yt.courses.length ? '来自雨课堂' : '连接后会显示'}>
            {yt.courses.length === 0 ? (
              <SEmpty title="还没有课程数据" />
            ) : (
              <div>
                {yt.courses.slice(0, 10).map((c) => (
                  <SRow key={`${c.id}-${c.classId ?? ''}`} title={c.name} sub={c.teacher ?? '—'} />
                ))}
              </div>
            )}
          </SCard>
        </div>

        <div className="s-stack">
          <SCard title="账号">
            <SRow
              leading={<SDot tone={yt.auth.logged ? 'ok' : 'err'} />}
              title={yt.auth.logged ? '已连接' : '未连接'}
              sub={yt.auth.logged ? `检查于 ${ago(yt.auth.checkedAt, now)}` : (yt.auth.error ?? '请扫码登录')}
            />
            <div className="s-stack s-stack--tight" style={{ marginTop: 12 }}>
              <SBtn full variant={yt.auth.logged ? 'ghost' : 'primary'} onClick={() => void call((api) => api.ytLogin())}>
                {yt.auth.logged ? '重新登录' : '扫码登录'}
              </SBtn>
              {yt.auth.logged && (
                <SBtn full variant="danger" onClick={() => void call((api) => api.ytLogout())}>
                  退出登录
                </SBtn>
              )}
            </div>
          </SCard>

          <SCard title="手动进入课堂" hint="知道课堂号时可以这样进">
            <div className="s-stack s-stack--tight">
              <SInput value={manualLesson} onCommit={setManualLesson} placeholder="课堂号 lessonId" />
              <SInput value={manualClassroom} onCommit={setManualClassroom} placeholder="教室号 classroomId" />
              <SBtn
                full
                variant="primary"
                disabled={!manualLesson || !manualClassroom}
                onClick={() =>
                  void call((api) => api.ytEnterLesson(manualLesson.trim(), manualClassroom.trim(), '手动进入'))
                }
              >
                进入课堂
              </SBtn>
            </div>
          </SCard>

          <SCard title="课程统计">
            <div className="s-metrics">
              <div className="s-metric">
                <div className="s-metric__label">课程</div>
                <div className="s-metric__value">{yt.courses.length}</div>
              </div>
              <div className="s-metric">
                <div className="s-metric__label">在课</div>
                <div className={`s-metric__value${yt.onLesson.length ? ' s-metric__value--ok' : ''}`}>
                  {yt.onLesson.length}
                </div>
              </div>
              <div className="s-metric">
                <div className="s-metric__label">题目</div>
                <div className="s-metric__value">{lesson ? lesson.problems.length : 0}</div>
              </div>
            </div>
          </SCard>
        </div>
      </div>
    </div>
  );
}
