import { useMemo, useState, type ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { ago, hhmmss, SIGN_METHOD_LABEL } from '../lib/format';
import { Btn, Empty, Field, KeyVal, Lamp, Panel, Pill, Stat, TextInput } from './ui';

type Filter = 'ongoing' | 'all';

export function ChaoxingPage({ snap, call }: PageProps): ReactNode {
  const now = useTick(1000);
  const cx = snap.chaoxing;
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [filter, setFilter] = useState<Filter>('ongoing');
  const [keyword, setKeyword] = useState('');
  const [busyLogin, setBusyLogin] = useState(false);

  const actives = useMemo(() => {
    const list = filter === 'ongoing' ? cx.actives.filter((a) => a.ongoing) : cx.actives;
    if (!keyword.trim()) return list;
    const k = keyword.trim().toLowerCase();
    return list.filter((a) => `${a.courseName}${a.title}${a.id}`.toLowerCase().includes(k));
  }, [cx.actives, filter, keyword]);

  const doLogin = async (): Promise<void> => {
    if (!phone || !password) return;
    setBusyLogin(true);
    try {
      await call((api) => api.cxLogin(phone, password));
    } finally {
      setBusyLogin(false);
    }
  };

  return (
    <div className="stack">
      <div className="split">
        <Panel
          eyebrow="AUTH / LOGIN"
          title={
            <>
              <Lamp tone={cx.auth.logged ? 'info' : 'err'} pulse={cx.auth.logged} />
              学习通账号
            </>
          }
          meta={cx.auth.logged ? `${cx.auth.userName ?? '已登录'} · 探测于 ${ago(cx.auth.checkedAt, now)}` : '两种登录方式：账号密码（AES 加密提交）或打开登录窗口'}
          actions={
            <Btn size="sm" variant="danger" onClick={() => void call((api) => api.cxLogout())}>
              退出
            </Btn>
          }
        >
          <div className="grid-2" style={{ gap: 14 }}>
            <div className="stack stack--tight">
              <Field label="手机号" hint="仅本机提交到 chaoxing 登录接口">
                <TextInput value={phone} onChange={setPhone} placeholder="手机号" />
              </Field>
              <Field label="密码">
                <TextInput value={password} onChange={setPassword} type="password" placeholder="密码" />
              </Field>
              <Btn
                variant="primary"
                busy={busyLogin}
                disabled={!phone || !password}
                onClick={() => void doLogin()}
              >
                账号密码登录
              </Btn>
              <span className="tiny dim2">
                密码使用 AES-128-CBC（key=iv=u2oh6Vu^HWe4_AES）加密后提交，不写入磁盘。
              </span>
            </div>
            <div className="stack stack--tight">
              <KeyVal k="登录态" v={cx.auth.logged ? '已登录' : (cx.auth.error ?? '未登录')} />
              <KeyVal k="课程" v={`${cx.courses.length} 门`} />
              <KeyVal k="活动" v={`${cx.actives.length} 个（进行中 ${cx.actives.filter((a) => a.ongoing).length}）`} />
              <KeyVal k="会话" v="Electron persist 分区（cookie 落盘、重启复用）" mono={false} />
              <Btn onClick={() => void call((api) => api.cxLoginWindow())}>打开网页登录窗口</Btn>
              <Btn onClick={() => void call((api) => api.cxRefresh())}>刷新课程与活动</Btn>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="SIGN / POLICY"
          title="签到策略"
          meta="自动签到只覆盖普通 / 位置 / 手势 / 签到码；二维码与拍照一律转人工提醒"
        >
          <div className="inline" style={{ gap: 20 }}>
            <Stat
              label="自动签到"
              value={snap.settings.chaoxing.autoSign ? 'ON' : 'OFF'}
              tone={snap.settings.chaoxing.autoSign ? 'ok' : 'idle'}
            />
            <Stat label="成功" value={cx.signs.filter((s) => s.ok).length} tone="ok" unit="次" />
            <Stat label="失败" value={cx.signs.filter((s) => !s.ok).length} tone="err" unit="次" />
          </div>
          <div className="divider" />
          <div className="kv-grid">
            <KeyVal k="普通" v={snap.settings.chaoxing.signTypes.normal ? '允许' : '禁止'} />
            <KeyVal k="位置" v={snap.settings.chaoxing.signTypes.location ? '允许' : '禁止'} />
            <KeyVal k="手势" v={snap.settings.chaoxing.signTypes.gesture ? '允许' : '禁止'} />
            <KeyVal k="签到码" v={snap.settings.chaoxing.signTypes.code ? '允许' : '禁止'} />
          </div>
          <div className="divider" />
          <div className="inline tiny dim2">
            默认坐标 {snap.settings.chaoxing.location.latitude}, {snap.settings.chaoxing.location.longitude}
            （{snap.settings.chaoxing.location.address}）· 在「设置」里可改
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="SIGN / ACTIVES"
        title="活动与签到"
        meta={`${actives.length} 条 · 来自 mobilelearn v2 activelist`}
        actions={
          <>
            <div className="seg">
              <button type="button" className={filter === 'ongoing' ? 'is-active' : ''} onClick={() => setFilter('ongoing')}>
                进行中
              </button>
              <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
                全部
              </button>
            </div>
            <div style={{ width: 150 }}>
              <TextInput value={keyword} onChange={setKeyword} placeholder="搜索课程/活动" />
            </div>
            <Btn size="sm" onClick={() => void call((api) => api.cxRefresh())}>
              刷新
            </Btn>
          </>
        }
      >
        {actives.length === 0 ? (
          <Empty
            title={filter === 'ongoing' ? '没有进行中的活动' : '还没有活动数据'}
            hint="轮询会扫描设置里限制的课程数"
          />
        ) : (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>课程</th>
                  <th>活动</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>ID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {actives.map((a) => (
                  <tr key={a.id}>
                    <td>{a.courseName}</td>
                    <td>{a.title}</td>
                    <td className="mono">{a.activeType}</td>
                    <td>
                      <Pill tone={a.ongoing ? 'warn' : 'idle'} mono>
                        {a.ongoing ? '进行中' : `status ${a.status}`}
                      </Pill>
                    </td>
                    <td className="mono tiny">{a.id}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Btn
                        size="sm"
                        variant={a.ongoing ? 'primary' : 'ghost'}
                        disabled={!a.ongoing}
                        onClick={() => void call((api) => api.cxSign(a.id))}
                      >
                        签到
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid-2">
        <Panel eyebrow="RECORD / SIGN" title="签到记录" meta={`${cx.signs.length} 条（本机保存）`}>
          {cx.signs.length === 0 ? (
            <Empty title="还没有签到记录" />
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>课程</th>
                    <th>方式</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {cx.signs.slice(0, 40).map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{hhmmss(s.at)}</td>
                      <td>{s.courseName}</td>
                      <td className="mono">{SIGN_METHOD_LABEL[s.method] ?? s.method}</td>
                      <td>
                        <Pill tone={s.ok ? 'ok' : 'err'} mono>
                          {s.ok ? '成功' : '失败'}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel eyebrow="DATA / COURSES" title="课程" meta={`${cx.courses.length} 门`}>
          {cx.courses.length === 0 ? (
            <Empty title="还没有课程" hint="登录后自动拉取 backclazzdata" />
          ) : (
            <div className="scroll">
              {cx.courses.map((c) => (
                <div className="row" key={`${c.id}-${c.classId ?? ''}`}>
                  <span className="mono tiny dim2">{c.id}</span>
                  <div className="row__main">
                    <div className="row__title">{c.name}</div>
                    <div className="row__sub">
                      class {c.classId ?? '—'} · cpi {c.extra?.cpi ?? '0'}
                    </div>
                  </div>
                  <Btn
                    size="sm"
                    onClick={() => void call((api) => api.cxOpenCourse(c.id, c.classId ?? ''))}
                  >
                    打开
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel eyebrow="DATA / HOMEWORK" title="作业任务点" meta={`${cx.homework.length} 条 · work/task-list 解析`}>
        {cx.homework.length === 0 ? (
          <Empty title="没有作业数据" hint="在设置里提高扫描课程数可覆盖更多课程" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>课程</th>
                <th>作业</th>
                <th>状态</th>
                <th>剩余</th>
              </tr>
            </thead>
            <tbody>
              {cx.homework.map((h) => (
                <tr key={h.id}>
                  <td>{h.courseName}</td>
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
        )}
      </Panel>

      <Panel eyebrow="DEBUG / RAW" title="轮询诊断">
        <div className="kv-grid">
          <KeyVal k="轮询次数" v={String(cx.monitor.pollCount)} />
          <KeyVal k="上次轮询" v={ago(cx.monitor.lastPollAt, now)} />
          <KeyVal k="结果" v={cx.monitor.lastPollOk ? 'OK' : (cx.monitor.lastError ?? '未知')} />
          <KeyVal k="签名" v={cx.monitor.signature ?? '—'} />
        </div>
        <div className="divider" />
        <div className="inline">
          <span className="tiny dim2">
            扫描上限 {snap.settings.chaoxing.courseScanLimit} 门（在设置里调整）· activelist 字段随版本变化，
            解析全部走宽松匹配并记日志
          </span>
        </div>
      </Panel>
    </div>
  );
}
