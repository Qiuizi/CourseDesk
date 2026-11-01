import { useState, type ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { ago, hhmm, SIGN_METHOD_LABEL } from '../lib/format';
import { SBadge, SBtn, SCard, SDot, SEmpty, SInput, SRow, SToggle } from './ui';

export function SimpleChaoxing({ snap, call }: PageProps): ReactNode {
  const now = useTick(1000);
  const cx = snap.chaoxing;
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const ongoing = cx.actives.filter((a) => a.ongoing);
  const finished = cx.actives.filter((a) => !a.ongoing);

  return (
    <div className="s-container">
      <div className="s-hero">
        <h1 className="s-hero__title">学习通</h1>
        <p className="s-hero__sub">
          {cx.auth.logged ? `已连接 · ${cx.courses.length} 门课程` : '未连接'} · 上次检查 {ago(cx.monitor.lastPollAt, now)}
        </p>
      </div>

      {!cx.auth.logged ? (
        <div className="s-grid">
          <SCard title="账号密码登录" hint="密码只在本机加密提交，不会保存">
            <div className="s-stack s-stack--tight">
              <SInput value={phone} onCommit={setPhone} placeholder="手机号" />
              <SInput value={password} onCommit={setPassword} placeholder="密码" type="password" />
              <SBtn
                full
                variant="primary"
                busy={busy}
                disabled={!phone || !password}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await call((api) => api.cxLogin(phone, password));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                登录
              </SBtn>
            </div>
          </SCard>
          <SCard title="网页登录" hint="扫码或有验证码时用这个">
            <SEmpty title="打开内置浏览器登录" hint="登录状态会保存在本机，下次直接可用" />
            <SBtn full variant="ghost" onClick={() => void call((api) => api.cxLoginWindow())}>
              打开登录窗口
            </SBtn>
          </SCard>
        </div>
      ) : (
        <div className="s-grid s-grid--wide-left">
          <div className="s-stack">
            <SCard
              className={ongoing.length ? 's-card--accent' : ''}
              title={
                <>
                  <SDot tone={ongoing.length ? 'warn' : 'idle'} />
                  进行中的签到
                </>
              }
              hint={ongoing.length ? '点击签到即可完成' : '当前没有需要处理的签到'}
              actions={
                <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.cxRefresh())}>
                  刷新
                </SBtn>
              }
            >
              {ongoing.length === 0 ? (
                <SEmpty title="没有进行中的活动" hint="有签到时会有系统通知" />
              ) : (
                <div className="s-stack s-stack--tight">
                  {ongoing.map((a) => (
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

            <SCard title="签到记录" hint={`${cx.signs.length} 条`}>
              {cx.signs.length === 0 ? (
                <SEmpty title="还没有签到记录" />
              ) : (
                <div>
                  {cx.signs.slice(0, 12).map((s) => (
                    <SRow
                      key={s.id}
                      leading={<SDot tone={s.ok ? 'ok' : 'err'} />}
                      title={`${s.courseName} · ${s.title}`}
                      sub={`${SIGN_METHOD_LABEL[s.method] ?? s.method} · ${hhmm(s.at)}`}
                      trailing={<SBadge tone={s.ok ? 'ok' : 'err'}>{s.ok ? '成功' : '失败'}</SBadge>}
                    />
                  ))}
                </div>
              )}
            </SCard>

            <SCard title="签到方式" hint="能自动的会自动，其余只提醒你手动处理">
              <div className="s-toolbar" style={{ gap: 6 }}>
                <SBadge tone="ok">普通 · 自动</SBadge>
                <SBadge tone="ok">位置 · 自动</SBadge>
                <SBadge tone="ok">手势 · 自动</SBadge>
                <SBadge tone="ok">签到码 · 自动</SBadge>
                <SBadge tone="warn">二维码 · 手动</SBadge>
                <SBadge tone="warn">拍照 / 人脸 · 手动</SBadge>
              </div>
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--s-dim)' }}>
                位置签到优先用教师给的坐标；取不到时用「设置 → 学习通 → 默认位置」。
              </div>
            </SCard>

            {finished.length > 0 && (
              <SCard title="已结束的活动" hint="仅供查看">
                <div>
                  {finished.slice(0, 6).map((a) => (
                    <SRow
                      key={a.id}
                      title={a.courseName}
                      sub={a.title}
                      trailing={<SBadge>{a.status === 2 ? '已结束' : `状态 ${a.status}`}</SBadge>}
                    />
                  ))}
                </div>
              </SCard>
            )}
          </div>

          <div className="s-stack">
            <SCard title="账号">
              <SRow
                leading={<SDot tone="ok" />}
                title={cx.auth.userName ?? '已连接'}
                sub={`${cx.courses.length} 门课程 · 检查于 ${ago(cx.auth.checkedAt, now)}`}
              />
              <div className="s-stack s-stack--tight" style={{ marginTop: 12 }}>
                <SBtn full variant="ghost" onClick={() => void call((api) => api.cxRefresh())}>
                  刷新数据
                </SBtn>
                <SBtn full variant="danger" onClick={() => void call((api) => api.cxLogout())}>
                  退出登录
                </SBtn>
              </div>
            </SCard>

            <SCard title="课程">
              {cx.courses.length === 0 ? (
                <SEmpty title="还没有课程" />
              ) : (
                <div>
                  {cx.courses.slice(0, 8).map((c) => (
                    <SRow
                      key={`${c.id}-${c.classId ?? ''}`}
                      title={c.name}
                      sub={c.teacher ?? '—'}
                      trailing={
                        <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.cxOpenCourse(c.id, c.classId ?? ''))}>
                          打开
                        </SBtn>
                      }
                    />
                  ))}
                </div>
              )}
            </SCard>

            <SCard title="作业" hint={cx.homework.length ? `${cx.homework.length} 项待处理` : '暂无作业'}>
              {cx.homework.length === 0 ? (
                <SEmpty compact title="没有待完成的作业" />
              ) : (
                <div>
                  {cx.homework.slice(0, 5).map((h) => (
                    <SRow
                      key={h.id}
                      title={h.title}
                      sub={`${h.courseName}${h.leftText ? ` · ${h.leftText}` : ''}`}
                      trailing={<SBadge tone={h.statusText.includes('未') ? 'warn' : 'ok'}>{h.statusText}</SBadge>}
                    />
                  ))}
                </div>
              )}
            </SCard>

            <SCard title="自动签到">
              <SToggle
                checked={snap.settings.chaoxing.autoSign}
                onChange={(v) =>
                  void call((api) => api.updateSettings({ chaoxing: { ...snap.settings.chaoxing, autoSign: v } }))
                }
                label={snap.settings.chaoxing.autoSign ? '已开启' : '已关闭'}
                hint="普通 / 位置 / 手势 / 签到码；二维码与拍照会提醒你手动处理"
              />
            </SCard>
          </div>
        </div>
      )}
    </div>
  );
}
