import type { ReactNode } from 'react';
import type { AppSnapshot } from '@shared/types';
import type { Call } from '../lib/store';
import type { Tab } from './Chrome';
import { useTick } from '../lib/store';
import { ago, roleLabel } from '../lib/format';
import { Btn, Empty, KeyVal, Lamp, Panel, Pill, Stat } from './ui';
import { Feed } from './Feed';

export function Overview({
  snap,
  call,
  onNavigate,
}: {
  snap: AppSnapshot;
  call: Call;
  onNavigate: (tab: Tab) => void;
}): ReactNode {
  const now = useTick(1000);
  const yt = snap.yuketang;
  const cx = snap.chaoxing;
  const ongoingSigns = cx.actives.filter((a) => a.ongoing);
  const homework = [...yt.homework, ...cx.homework].slice(0, 8);

  return (
    <div className="stack">
      <div className="grid-2">
        {/* ------------------------------------------------ 雨课堂 */}
        <Panel
          eyebrow="PLATFORM / YUKETANG"
          title={
            <>
              <Lamp tone={yt.auth.logged ? 'ok' : 'err'} pulse={yt.auth.logged} />
              雨课堂
            </>
          }
          meta={`${snap.settings.yuketang.host} · ${yt.monitor.running ? '监控中' : '已暂停'} · 上次 ${ago(yt.monitor.lastPollAt, now)}`}
          actions={
            <>
              <Btn
                size="sm"
                variant={yt.auth.logged ? 'ghost' : 'primary'}
                onClick={() => void call((api) => api.ytLogin())}
              >
                {yt.auth.logged ? '重新登录' : '登录'}
              </Btn>
              <Btn size="sm" onClick={() => void call((api) => api.ytRefresh())}>
                刷新
              </Btn>
              <Btn size="sm" variant="quiet" onClick={() => onNavigate('yuketang')}>
                面板 →
              </Btn>
            </>
          }
        >
          <div className="inline" style={{ gap: 26, alignItems: 'flex-start' }}>
            <Stat
              label="在课"
              value={yt.onLesson.length}
              unit="节"
              tone={yt.onLesson.length ? 'ok' : 'idle'}
              hint={yt.onLesson.length ? '有新课堂在直播' : '当前无课'}
            />
            <Stat label="课程" value={yt.courses.length} unit="门" />
            <Stat
              label="课堂会话"
              value={yt.lesson ? (yt.lesson.wsState === 'open' ? 'LIVE' : yt.lesson.wsState.toUpperCase()) : '—'}
              tone={yt.lesson?.wsState === 'open' ? 'ok' : 'idle'}
              hint={yt.lesson ? `lesson ${yt.lesson.lessonId}` : '尚未进入课堂'}
            />
            <Stat label="题目" value={yt.lesson?.problems.length ?? 0} unit="道" tone="warn" />
          </div>
          <div className="divider" />
          <div className="kv-grid">
            <KeyVal k="登录态" v={yt.auth.logged ? '已登录' : (yt.auth.error ?? '未登录')} />
            <KeyVal k="轮询次数" v={String(yt.monitor.pollCount)} />
            <KeyVal k="签到指纹" v={`source=${snap.settings.yuketang.checkinSource}`} />
            <KeyVal k="答题策略" v={snap.settings.yuketang.answerPolicy.toUpperCase()} />
          </div>
        </Panel>

        {/* ------------------------------------------------ 学习通 */}
        <Panel
          eyebrow="PLATFORM / CHAOXING"
          title={
            <>
              <Lamp tone={cx.auth.logged ? 'info' : 'err'} pulse={cx.auth.logged} />
              学习通
            </>
          }
          meta={`${cx.monitor.running ? '监控中' : '已暂停'} · 上次 ${ago(cx.monitor.lastPollAt, now)} · 扫描 ${snap.settings.chaoxing.courseScanLimit} 门课`}
          actions={
            <>
              <Btn
                size="sm"
                variant={cx.auth.logged ? 'ghost' : 'primary'}
                onClick={() => onNavigate('chaoxing')}
              >
                {cx.auth.logged ? '账号面板' : '去登录'}
              </Btn>
              <Btn size="sm" onClick={() => void call((api) => api.cxRefresh())}>
                刷新
              </Btn>
            </>
          }
        >
          <div className="inline" style={{ gap: 26, alignItems: 'flex-start' }}>
            <Stat
              label="进行中活动"
              value={ongoingSigns.length}
              unit="个"
              tone={ongoingSigns.length ? 'warn' : 'idle'}
              hint={ongoingSigns.length ? '含签到等待处理' : '无'}
            />
            <Stat label="课程" value={cx.courses.length} unit="门" />
            <Stat label="签到记录" value={cx.signs.length} unit="条" tone="ok" />
            <Stat
              label="自动签到"
              value={snap.settings.chaoxing.autoSign ? 'ON' : 'OFF'}
              tone={snap.settings.chaoxing.autoSign ? 'ok' : 'idle'}
            />
          </div>
          <div className="divider" />
          <div className="kv-grid">
            <KeyVal k="登录态" v={cx.auth.logged ? (cx.auth.userName ?? '已登录') : (cx.auth.error ?? '未登录')} />
            <KeyVal k="轮询次数" v={String(cx.monitor.pollCount)} />
            <KeyVal
              k="默认位置"
              v={`${snap.settings.chaoxing.location.latitude}, ${snap.settings.chaoxing.location.longitude}`}
            />
            <KeyVal k="签到类型" v={Object.entries(snap.settings.chaoxing.signTypes).filter(([, v]) => v).map(([k]) => k).join(' / ') || '无'} />
          </div>
        </Panel>
      </div>

      <div className="split">
        <div className="stack">
          {/* ------------------------------------------------ 在课 */}
          <Panel
            eyebrow="LIVE / ON-LESSON"
            title="正在进行的课堂"
            meta="进入课堂会在服务端记录出勤（网页端的签到凭证就是进入动作本身）"
            actions={
              yt.onLesson.length > 0 ? (
                <Pill tone="ok" mono>
                  {yt.onLesson.length} LIVE
                </Pill>
              ) : null
            }
          >
            {yt.onLesson.length === 0 ? (
              <Empty title="当前没有在上的课" hint="雨课堂开课后这里会自动出现，并推送系统通知" />
            ) : (
              <div className="stack stack--tight">
                {yt.onLesson.map((item) => (
                  <div className="row" key={item.lessonId}>
                    <Lamp tone="ok" pulse />
                    <div className="row__main">
                      <div className="row__title">{item.courseName}</div>
                      <div className="row__sub">
                        {item.classroomName ?? '—'} · lesson {item.lessonId} · {roleLabel(item.role)}
                      </div>
                    </div>
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => void call((api) => api.ytEnterLesson(item.lessonId, item.classroomId, item.courseName))}
                    >
                      进入课堂
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={() => void call((api) => api.ytOpenLessonPage(item.lessonId))}
                      title="只开页面，不调 checkin 接口"
                    >
                      仅开页面
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* ------------------------------------------------ 学习通活动 */}
          <Panel
            eyebrow="SIGN / ACTIVE"
            title="学习通 · 进行中的活动"
            meta="普通 / 位置 / 手势 / 签到码可自动；二维码、拍照转人工提醒"
            actions={
              <Btn size="sm" variant="quiet" onClick={() => onNavigate('chaoxing')}>
                全部活动 →
              </Btn>
            }
          >
            {ongoingSigns.length === 0 ? (
              <Empty title="没有进行中的签到" hint={`上一次轮询 ${ago(cx.monitor.lastPollAt, now)}`} />
            ) : (
              <div className="stack stack--tight">
                {ongoingSigns.slice(0, 6).map((a) => (
                  <div className="row" key={a.id}>
                    <Lamp tone="warn" pulse />
                    <div className="row__main">
                      <div className="row__title">{a.courseName}</div>
                      <div className="row__sub">
                        {a.title} · type {a.activeType} · active {a.id}
                      </div>
                    </div>
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => void call((api) => api.cxSign(a.id))}
                    >
                      签到
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* ------------------------------------------------ 作业 */}
          <Panel
            eyebrow="TASKS / HOMEWORK"
            title="作业与任务点"
            meta={`雨课堂 ${yt.homework.length} 条 · 学习通 ${cx.homework.length} 条`}
          >
            {homework.length === 0 ? (
              <Empty
                title="没有抓到作业"
                hint="雨课堂作业列表需要课程 leafId；学习通走 work/task-list HTML 解析"
              />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>课程</th>
                    <th>任务</th>
                    <th>状态</th>
                    <th>剩余</th>
                  </tr>
                </thead>
                <tbody>
                  {homework.map((h) => (
                    <tr key={`${h.platform}-${h.id}`}>
                      <td className="mono">{h.platform === 'yuketang' ? 'YKT' : 'CX'}</td>
                      <td>{h.courseName}</td>
                      <td>{h.title}</td>
                      <td>
                        <Pill tone={h.statusText.includes('未交') || h.statusText.includes('未提交') ? 'warn' : 'ok'} mono>
                          {h.statusText}
                        </Pill>
                      </td>
                      <td className="mono">{h.leftText || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel
            eyebrow="STREAM / EVENT"
            title="最近事件"
            actions={
              <Btn size="sm" variant="quiet" onClick={() => onNavigate('events')}>
                全部 →
              </Btn>
            }
          >
            <Feed events={snap.events} limit={9} />
          </Panel>

          <Panel eyebrow="DIAGNOSTICS / HEALTH" title="健康检查">
            <KeyVal k="雨课堂轮询" v={yt.monitor.lastPollOk ? '正常' : (yt.monitor.lastError ?? '未开始')} />
            <KeyVal k="学习通轮询" v={cx.monitor.lastPollOk ? '正常' : (cx.monitor.lastError ?? '未开始')} />
            <KeyVal k="接口签名" v={`${yt.monitor.signature ?? '—'} / ${cx.monitor.signature ?? '—'}`} />
            <KeyVal k="AI 作答" v={snap.settings.ai.hasKey ? `已配置 · ${snap.settings.ai.model}` : '未配置 Key'} />
            <KeyVal k="提示" v={snap.health.yuketang.notes[0] ?? '接口结构未发现漂移'} />
            <div className="divider" />
            <div className="inline">
              <Btn size="sm" onClick={() => void call((api) => api.ytRefresh())}>
                探测雨课堂
              </Btn>
              <Btn size="sm" onClick={() => void call((api) => api.cxRefresh())}>
                探测学习通
              </Btn>
            </div>
          </Panel>

          <Panel eyebrow="QUICK / ACTIONS" title="快捷动作">
            <div className="stack stack--tight">
              <Btn full onClick={() => void call((api) => api.cxLoginWindow())}>
                打开学习通登录窗口
              </Btn>
              <Btn full onClick={() => void call((api) => api.ytLogin())}>
                打开雨课堂登录窗口
              </Btn>
              <Btn full onClick={() => onNavigate('settings')}>
                打开设置（节拍 / 位置 / AI）
              </Btn>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
