import { useState, type ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { FARM_SPEED_OPTIONS, FARM_STATUS_LABEL, clampFarmSpeed } from '../lib/video';
import { useTick } from '../lib/store';
import { ago, durationText, etaText } from '../lib/format';
import { SBadge, SBtn, SCard, SDot, SEmpty, SInput, SMeter, SRow, SSelect } from './ui';
import { ProblemCard } from './ProblemCard';

export function SimpleYuketang({ snap, call }: PageProps): ReactNode {
  const now = useTick(1000);
  const yt = snap.yuketang;
  const lesson = yt.lesson;
  const farm = yt.videoFarm;
  const current = farm.items[farm.currentIndex];
  const doneCount = farm.items.filter((item) => item.done && !item.skipped).length;
  const [manualLesson, setManualLesson] = useState('');
  const [manualClassroom, setManualClassroom] = useState('');
  const [presentationIds, setPresentationIds] = useState('');
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

          <SCard
            title={
              <>
                <SDot
                  tone={farm.status === 'running' ? 'ok' : farm.status === 'error' ? 'err' : farm.items.length ? 'warn' : 'idle'}
                />
                刷课
              </>
            }
            hint={
              farm.items.length
                ? `${FARM_STATUS_LABEL[farm.status]} · ${doneCount}/${farm.items.length} 完成 · ${farm.speed}×`
                : '按真实播放器节奏补齐视频进度，可暂停、续跑'
            }
            actions={
              <SSelect
                value={String(farm.speed)}
                onChange={(v) => void call((api) => api.ytVideoSpeed(clampFarmSpeed(v)))}
                options={FARM_SPEED_OPTIONS}
              />
            }
          >
            {!snap.settings.yuketang.videoHeartbeat ? (
              <SEmpty title="还没打开视频上报" hint="设置 → 雨课堂 → 允许上报视频进度" compact />
            ) : (
              <>
                <div className="s-stack s-stack--tight">
                  <SInput
                    value={presentationIds}
                    onCommit={setPresentationIds}
                    placeholder="课件 ID，多个用逗号隔开（留空 = 当前课堂）"
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <SBtn
                      size="sm"
                      variant="primary"
                      disabled={(!presentationIds && !lesson) || farm.status === 'running' || farm.status === 'collecting'}
                      onClick={() => void call((api) => api.ytVideoStart(presentationIds.trim()))}
                    >
                      开始
                    </SBtn>
                    {farm.status === 'running' ? (
                      <SBtn size="sm" onClick={() => void call((api) => api.ytVideoPause())}>
                        暂停
                      </SBtn>
                    ) : (
                      <SBtn size="sm" disabled={!farm.items.length} onClick={() => void call((api) => api.ytVideoResume())}>
                        继续
                      </SBtn>
                    )}
                    <SBtn size="sm" disabled={!farm.items.length} onClick={() => void call((api) => api.ytVideoSkip())}>
                      跳过
                    </SBtn>
                    <SBtn
                      size="sm"
                      variant="danger"
                      disabled={!farm.items.length}
                      onClick={() => void call((api) => api.ytVideoStop())}
                    >
                      停止
                    </SBtn>
                  </div>
                </div>

                {current && !current.done && (
                  <div style={{ marginTop: 14 }}>
                    <SRow
                      leading={<SDot tone={farm.status === 'running' ? 'ok' : 'warn'} />}
                      title={current.name}
                      sub={`${durationText(current.position)} / ${durationText(current.duration)} · 剩余 ${etaText(
                        (current.duration - current.position) / Math.max(1, farm.speed),
                      )}`}
                      trailing={<SBadge tone="info">{current.percent}%</SBadge>}
                    />
                    <div style={{ marginTop: 6 }}>
                      <SMeter value={current.percent} tone={farm.status === 'error' ? 'err' : 'ok'} />
                    </div>
                  </div>
                )}

                {farm.lastError && (
                  <p style={{ color: '#d92d20', fontSize: 12.5, marginTop: 8 }}>{farm.lastError}</p>
                )}

                {farm.items.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {farm.items.map((item) => (
                      <SRow
                        key={`${item.presentationId}-${item.videoId}`}
                        title={item.name}
                        sub={`${durationText(item.duration)} · ${item.sentTicks} 条${
                          item.skipped ? ' · 已跳过' : item.done ? ' · 完成' : ''
                        }`}
                        trailing={
                          <SBadge tone={item.skipped ? 'warn' : item.done ? 'ok' : 'idle'}>{item.percent}%</SBadge>
                        }
                      />
                    ))}
                  </div>
                )}
              </>
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
