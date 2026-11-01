import { useMemo, useState, type ReactNode } from 'react';
import type { Problem } from '@shared/types';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { countdown, PROBLEM_TYPE, ago, answerPreview } from '../lib/format';
import { Btn, Empty, Field, KeyVal, Lamp, Panel, Pill, TextInput } from './ui';
import { Feed } from './Feed';

/** 手输答案 → 提交体（选择题取字母，填空题按行/分号切分） */
function parseManualInput(problemType: number, text: string): string[] {
  if (problemType === 4) {
    return text
      .split(/[\n;；,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const letters = text.toUpperCase().match(/[A-F]/g);
  return letters ? Array.from(new Set(letters)) : text.split(/[\s,，]+/).filter(Boolean);
}

function ProblemCard({
  problem,
  call,
  now,
}: {
  problem: Problem;
  call: PageProps['call'];
  now: number;
}): ReactNode {
  const [draft, setDraft] = useState('');
  const live = problem.deadlineAt ? problem.deadlineAt - now > 0 : Boolean(problem.unlockedAt);
  const stateTone =
    problem.submitState === 'submitted'
      ? 'ok'
      : problem.submitState === 'failed'
        ? 'err'
        : problem.submitState === 'confirm'
          ? 'warn'
          : 'idle';

  return (
    <div className={`problem${live ? ' is-live' : ''}`}>
      <div className="problem__top">
        <Pill tone={stateTone} mono>
          {PROBLEM_TYPE[problem.problemType] ?? `type ${problem.problemType}`}
        </Pill>
        <span className="tiny dim2 mono">#{problem.problemId}</span>
        {problem.slideIndex !== undefined && <span className="tiny dim2">Slide {problem.slideIndex}</span>}
        {problem.deadlineAt && (
          <Pill tone={live ? 'warn' : 'idle'} mono>
            {countdown(problem.deadlineAt, now)}
          </Pill>
        )}
        <span className="grow" />
        <Btn
          size="sm"
          variant="quiet"
          onClick={() => void call((api) => api.ytAskAi(problem.problemId))}
          title="调用已配置的模型生成答案；主观题只生成解析"
        >
          AI 作答
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          onClick={() => void call((api) => api.ytAnswer(problem.problemId, parseManualInput(problem.problemType, draft || answerPreview(problem))))}
        >
          提交
        </Btn>
      </div>

      <div className="problem__body">{problem.body || '（题干未取到，可能还没拉课件）'}</div>

      {problem.options.length > 0 && (
        <div className="problem__opts">
          {problem.options.map((o) => {
            const picked = String(answerPreview(problem)).includes(o.key);
            return (
              <div key={o.key} className={`opt${picked ? ' is-picked' : ''}`}>
                <span className="opt__key">{o.key}</span>
                <span>{o.value}</span>
              </div>
            );
          })}
        </div>
      )}

      {problem.answer !== undefined && problem.answer !== null && (
        <div className="problem__answer">答案 · {answerPreview(problem)}</div>
      )}
      {problem.aiAnalysis && <div className="problem__analysis">{problem.aiAnalysis}</div>}

      <div className="inline" style={{ gap: 6 }}>
        <TextInput
          value={draft}
          onChange={setDraft}
          placeholder={
            problem.problemType === 1 || problem.problemType === 2 || problem.problemType === 3 || problem.problemType === 6
              ? '手输答案，如 A 或 A,C'
              : '手输答案（填空按换行分隔）'
          }
        />
        {problem.submitMessage && <span className="tiny dim2">{problem.submitMessage}</span>}
      </div>
    </div>
  );
}

export function YuketangPage({ snap, call }: PageProps): ReactNode {
  const now = useTick(1000);
  const yt = snap.yuketang;
  const lesson = yt.lesson;
  const [manualLesson, setManualLesson] = useState('');
  const [manualClassroom, setManualClassroom] = useState('');
  const [presentationId, setPresentationId] = useState('');

  const liveProblems = useMemo(
    () => (lesson ? [...lesson.problems].sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)) : []),
    [lesson],
  );

  return (
    <div className="stack">
      <div className="split">
        {/* -------------------------------------------------- 课堂 */}
        <div className="stack">
        <Panel
          eyebrow="LESSON / LIVE SESSION"
          title={
            <>
              <Lamp tone={lesson?.wsState === 'open' ? 'ok' : lesson ? 'warn' : 'idle'} pulse={lesson?.wsState === 'open'} />
              课堂会话
            </>
          }
          meta={
            lesson
              ? `lesson ${lesson.lessonId} · classroom ${lesson.classroomId} · WS ${lesson.wsState}`
              : '尚未进入任何课堂'
          }
          actions={
            <>
              <Btn size="sm" onClick={() => void call((api) => api.ytRefresh())}>
                刷新在课
              </Btn>
              {lesson && (
                <Btn size="sm" onClick={() => void call((api) => api.ytOpenLessonPage(lesson.lessonId))}>
                  打开课堂页
                </Btn>
              )}
            </>
          }
        >
          {!lesson ? (
            <Empty title="进入课堂后这里会显示实时题目" hint="总览页的在课列表 → 进入课堂，或手动填写 lessonId" />
          ) : (
            <>
              <div className="kv-grid">
                <KeyVal k="课程" v={lesson.courseName ?? '—'} mono={false} />
                <KeyVal k="lessonToken" v={lesson.lessonToken ? '已获取' : '缺失'} />
                <KeyVal k="identityId" v={lesson.identityId ?? '—'} />
                <KeyVal k="接入时间" v={ago(lesson.startedAt, now)} />
                <KeyVal k="最后事件" v={ago(lesson.lastEventAt, now)} />
                <KeyVal k="题目数" v={String(lesson.problems.length)} />
              </div>
              <div className="divider" />
              {liveProblems.length === 0 ? (
                <Empty title="还没有题目" hint="老师解锁随堂题时会经 WebSocket 推过来" />
              ) : (
                <div className="stack stack--tight">
                  {liveProblems.map((p) => (
                    <ProblemCard key={p.problemId} problem={p} call={call} now={now} />
                  ))}
                </div>
              )}
            </>
          )}
        </Panel>

          <Panel eyebrow="STREAM / LESSON" title="课堂事件" meta="雨课堂实时事件（WS 推送与接口轮询）">
            <Feed events={snap.events.filter((e) => e.platform === 'yuketang')} limit={11} showPlatform={false} />
          </Panel>
        </div>

        {/* -------------------------------------------------- 控制 */}
        <div className="stack">
          <Panel
            eyebrow="CONTROL / CHECKIN"
            title="进入课堂"
            meta={`source=${snap.settings.yuketang.checkinSource} · 模式 ${snap.settings.yuketang.checkinMode}`}
          >
            {yt.onLesson.length === 0 ? (
              <Empty title="在课列表为空" hint="可手动填 lessonId（老师投屏的课堂号）" />
            ) : (
              <div className="stack stack--tight">
                {yt.onLesson.map((item) => (
                  <div className="row" key={item.lessonId} style={{ padding: '6px 4px' }}>
                    <div className="row__main">
                      <div className="row__title">{item.courseName}</div>
                      <div className="row__sub">lesson {item.lessonId}</div>
                    </div>
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => void call((api) => api.ytEnterLesson(item.lessonId, item.classroomId, item.courseName))}
                    >
                      进入
                    </Btn>
                  </div>
                ))}
              </div>
            )}
            <div className="divider" />
            <div className="stack stack--tight">
              <Field label="lessonId" hint="手动进入">
                <TextInput value={manualLesson} onChange={setManualLesson} placeholder="例如 1234567" />
              </Field>
              <Field label="classroomId">
                <TextInput value={manualClassroom} onChange={setManualClassroom} placeholder="例如 98765" />
              </Field>
              <Btn
                full
                variant="primary"
                disabled={!manualLesson || !manualClassroom}
                onClick={() =>
                  void call((api) => api.ytEnterLesson(manualLesson.trim(), manualClassroom.trim(), '手动进入'))
                }
              >
                调 checkin 并接入 WS
              </Btn>
            </div>
          </Panel>

          <Panel eyebrow="LESSON / QUEUE" title="课件与视频" meta="视频进度上报按真实播放器心跳形状构造">
            <Field label="presentationId" hint="课件 ID">
              <TextInput value={presentationId} onChange={setPresentationId} placeholder="presentation id" />
            </Field>
            <div className="inline" style={{ marginTop: 8 }}>
              <Btn
                size="sm"
                disabled={!presentationId}
                onClick={() => void call((api) => api.ytVideoPush(presentationId.trim()))}
              >
                上报视频进度
              </Btn>
              <span className="tiny dim2">
                已上报 {Object.keys(yt.videoReported).length} 个课件
              </span>
            </div>
            <div className="divider" />
            <KeyVal k="课堂地址" v={`/lesson/fullscreen/v3/<lessonId>?source=${snap.settings.yuketang.checkinSource}`} />
            <KeyVal k="WS" v={`wss://${snap.settings.yuketang.host}/wsapp/`} />
          </Panel>

          <Panel eyebrow="AUTH / SESSION" title="账号与会话">
            <div className="kv-list">
              <KeyVal k="登录态" v={yt.auth.logged ? '已登录' : (yt.auth.error ?? '未登录')} />
              <KeyVal k="Bearer" v={yt.auth.logged ? 'ACTIVE（Set-Auth 自动续期）' : '—'} />
              <KeyVal k="探测时间" v={ago(yt.auth.checkedAt, now)} />
            </div>
            <div className="divider" />
            <div className="inline">
              <Btn size="sm" variant="primary" full onClick={() => void call((api) => api.ytLogin())}>
                打开登录窗口
              </Btn>
              <Btn size="sm" variant="danger" full onClick={() => void call((api) => api.ytLogout())}>
                清除会话
              </Btn>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid-2">
        <Panel
          eyebrow="DATA / COURSES"
          title="课程列表"
          meta={`${yt.courses.length} 门 · 来自 /v2/api/web/courses/list`}
          actions={
            <Btn size="sm" onClick={() => void call((api) => api.ytRefresh())}>
              拉取
            </Btn>
          }
        >
          {yt.courses.length === 0 ? (
            <Empty title="还没有课程数据" hint="登录成功后点刷新" />
          ) : (
            <div className="scroll">
              {yt.courses.map((c) => (
                <div className="row" key={`${c.id}-${c.classId ?? ''}`}>
                  <span className="mono tiny dim2">{c.id}</span>
                  <div className="row__main">
                    <div className="row__title">{c.name}</div>
                    <div className="row__sub">
                      {c.teacher ?? '—'} · classroom {c.classId ?? '—'}
                      {c.extra?.leafId ? ` · leaf ${c.extra.leafId}` : ''}
                    </div>
                  </div>
                  <Pill tone="ok" mono>
                    {c.extra?.leafId ? 'LEAF' : 'COURSE'}
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="DATA / HOMEWORK"
          title="作业列表"
          meta={`${yt.homework.length} 条 · mooc-api exercise list`}
          actions={
            <Btn size="sm" onClick={() => void call((api) => api.ytRefresh())}>
              刷新
            </Btn>
          }
        >
          {yt.homework.length === 0 ? (
            <Empty
              title="没有作业数据"
              hint="需要课程的 leafId（部分学校接口不返回），抓不到时不影响课堂功能"
            />
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {yt.homework.map((h) => (
                    <tr key={h.id}>
                      <td>{h.title}</td>
                      <td>
                        <Pill tone={h.statusText.includes('未') ? 'warn' : 'ok'} mono>
                          {h.statusText}
                        </Pill>
                      </td>
                      <td className="mono">{h.leftText || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

    </div>
  );
}
