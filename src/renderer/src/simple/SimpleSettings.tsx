import { useState, type ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { ago, hhmm } from '../lib/format';
import { CHECKIN_HOSTS, CHECKIN_SOURCES } from '../lib/options';
import { SBadge, SBtn, SCard, SDot, SEmpty, SField, SInput, SRow, SSelect, SToggle } from './ui';

export function SimpleSettings({ snap, call }: PageProps): ReactNode {
  const s = snap.settings;
  const now = useTick(2000);
  const [apiKey, setApiKey] = useState('');
  const [note, setNote] = useState('');
  const patch = (p: Parameters<Window['coursedesk']['updateSettings']>[0]): void => {
    void call((api) => api.updateSettings(p));
  };
  const driftChanged = snap.drift.results.filter((r) => r.changed);

  return (
    <div className="s-container">
      <div className="s-hero">
        <h1 className="s-hero__title">设置</h1>
        <p className="s-hero__sub">所有配置只保存在本机 · 检查间隔按需调整</p>
      </div>

      <div className="s-grid">
        <div className="s-stack">
          {/* 接口变更提醒 —— 本轮新增的核心能力 */}
          <SCard
            title="接口变更提醒"
            hint="定期比对雨课堂 / 学习通的响应结构，变了就通知你"
            actions={
              <SBadge tone={driftChanged.length ? 'warn' : 'ok'}>
                {driftChanged.length
                  ? `${driftChanged.length} 项有变化`
                  : snap.drift.results.length === 0
                    ? '尚未检测'
                    : '结构稳定'}
              </SBadge>
            }
          >
            <SToggle
              checked={s.drift.enabled}
              onChange={(v) => patch({ drift: { ...s.drift, enabled: v } })}
              label="自动检测"
              hint={`每 ${s.drift.intervalHours} 小时一次；发现变化会发系统通知`}
            />
            <SToggle
              checked={s.drift.notify}
              onChange={(v) => patch({ drift: { ...s.drift, notify: v } })}
              label="变化时通知我"
            />
            <SField label="检测间隔">
              <SSelect
                value={String(s.drift.intervalHours)}
                onChange={(v) => patch({ drift: { ...s.drift, intervalHours: Number(v) } })}
                options={[
                  { value: '1', label: '每 1 小时' },
                  { value: '3', label: '每 3 小时' },
                  { value: '6', label: '每 6 小时' },
                  { value: '12', label: '每 12 小时' },
                  { value: '24', label: '每天' },
                ]}
              />
            </SField>
            <div style={{ display: 'flex', gap: 8, margin: '14px 0 6px' }}>
              <SBtn
                variant="primary"
                size="sm"
                busy={snap.drift.running}
                onClick={async () => {
                  const res = await call((api) => api.driftCheck());
                  setNote(res ? `已检测 ${res.checked} 项，${res.changed} 项有变化` : '检测失败');
                }}
              >
                立即检测
              </SBtn>
              {driftChanged.length > 0 && (
                <SBtn
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await call((api) => api.driftAccept());
                    setNote('已接受新的结构基线');
                  }}
                >
                  忽略这次变化
                </SBtn>
              )}
            </div>
            {note && <div style={{ fontSize: 12.5, color: 'var(--s-dim)' }}>{note}</div>}
            <div style={{ fontSize: 12.5, color: 'var(--s-dim-2)', marginTop: 6 }}>
              上次检测 {ago(snap.drift.lastCheckAt, now)}
              {snap.drift.nextCheckAt ? ` · 下次约 ${hhmm(snap.drift.nextCheckAt)}` : ''}
            </div>

            <div style={{ marginTop: 12 }}>
              {snap.drift.results.length === 0 ? (
                <SEmpty title="还没有检测记录" hint="点「立即检测」建立基线" />
              ) : (
                snap.drift.results.map((r) => (
                  <SRow
                    key={r.probeId}
                    leading={<SDot tone={!r.ok ? 'err' : r.changed ? 'warn' : 'ok'} />}
                    title={r.label}
                    sub={
                      r.changed
                        ? `结构有变化：新增 ${r.added.length} 项 / 消失 ${r.removed.length} 项`
                        : r.ok
                          ? `${r.pathCount} 个字段 · ${r.baselineHash ? '与基线一致' : '已建立基线'}`
                          : (r.note ?? '检测失败')
                    }
                    trailing={
                      r.changed ? (
                        <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.driftAccept(r.probeId))}>
                          接受
                        </SBtn>
                      ) : (
                        <SBadge tone={r.ok ? 'ok' : 'err'}>{r.ok ? '正常' : `HTTP ${r.status}`}</SBadge>
                      )
                    }
                  />
                ))
              )}
            </div>

            {driftChanged.length > 0 && (
              <div className="s-note" style={{ marginTop: 12 }}>
                <div>
                  {driftChanged.map((r) => (
                    <div key={r.probeId} style={{ marginBottom: 6 }}>
                      <strong>{r.label}</strong>
                      {r.added.length > 0 && (
                        <div style={{ opacity: 0.85 }}>新增：{r.added.slice(0, 6).join('、')}</div>
                      )}
                      {r.removed.length > 0 && (
                        <div style={{ opacity: 0.85 }}>消失：{r.removed.slice(0, 6).join('、')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SCard>

          <SCard title="雨课堂" hint="域名与轮询">
            <SField label="学校域名">
              <SSelect
                value={s.yuketang.host}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, host: v } })}
                options={CHECKIN_HOSTS.map((h) => ({ value: h.value, label: h.label }))}
              />
            </SField>
            <SField label="检查间隔（秒）" hint="太快容易被风控，建议 ≥ 20">
              <SInput
                type="number"
                value={String(s.yuketang.pollIntervalSec)}
                onCommit={(v) => patch({ yuketang: { ...s.yuketang, pollIntervalSec: Math.max(15, Number(v) || 20) } })}
              />
            </SField>
            <SField label="签到渠道" hint="进入课堂时上报的来源">
              <SSelect
                value={String(s.yuketang.checkinSource)}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, checkinSource: Number(v) } })}
                options={CHECKIN_SOURCES.map((x) => ({ value: String(x.value), label: x.label }))}
              />
            </SField>
            <SToggle
              checked={s.yuketang.autoEnterClass}
              onChange={(v) => patch({ yuketang: { ...s.yuketang, autoEnterClass: v } })}
              label="开课后自动进入"
              hint="检测到就立即进课堂（会记录出勤）"
            />
            <SToggle
              checked={s.yuketang.notifyOnLesson}
              onChange={(v) => patch({ yuketang: { ...s.yuketang, notifyOnLesson: v } })}
              label="开课提醒"
            />
            <SField label="答题方式">
              <SSelect
                value={s.yuketang.answerPolicy}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, answerPolicy: v as typeof s.yuketang.answerPolicy } })}
                options={[
                  { value: 'off', label: '自己答（不调用 AI）' },
                  { value: 'confirm', label: 'AI 给答案，我确认后提交' },
                  { value: 'auto', label: '客观题自动提交' },
                ]}
              />
            </SField>
          </SCard>

          <SCard title="学习通" hint="签到与位置">
            <SField label="检查间隔（秒）">
              <SInput
                type="number"
                value={String(s.chaoxing.pollIntervalSec)}
                onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, pollIntervalSec: Math.max(15, Number(v) || 30) } })}
              />
            </SField>
            <SField label="每次检查课程数" hint="课程多时调小，避免请求过密">
              <SInput
                type="number"
                value={String(s.chaoxing.courseScanLimit)}
                onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, courseScanLimit: Math.max(1, Number(v) || 8) } })}
              />
            </SField>
            <SToggle
              checked={s.chaoxing.autoSign}
              onChange={(v) => patch({ chaoxing: { ...s.chaoxing, autoSign: v } })}
              label="自动签到"
              hint="只处理普通 / 位置 / 手势 / 签到码"
            />
            <SToggle
              checked={s.chaoxing.notifyOnNewActive}
              onChange={(v) => patch({ chaoxing: { ...s.chaoxing, notifyOnNewActive: v } })}
              label="新签到提醒"
            />
            <div className="s-grid" style={{ gap: 10, marginTop: 10 }}>
              <SField label="纬度">
                <SInput
                  value={s.chaoxing.location.latitude}
                  onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, location: { ...s.chaoxing.location, latitude: v } } })}
                />
              </SField>
              <SField label="经度">
                <SInput
                  value={s.chaoxing.location.longitude}
                  onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, location: { ...s.chaoxing.location, longitude: v } } })}
                />
              </SField>
            </div>
            <SField label="地址文字" hint="教师未指定位置时使用">
              <SInput
                value={s.chaoxing.location.address}
                onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, location: { ...s.chaoxing.location, address: v } } })}
              />
            </SField>
          </SCard>
        </div>

        <div className="s-stack">
          <SCard title="AI 作答" hint="可选，不填也不影响其他功能">
            <SToggle
              checked={s.ai.enabled}
              onChange={(v) => patch({ ai: { ...s.ai, enabled: v } })}
              label="启用 AI"
              hint="关闭时完全不会请求外部接口"
            />
            <SField label="服务地址">
              <SInput value={s.ai.baseUrl} onCommit={(v) => patch({ ai: { ...s.ai, baseUrl: v } })} />
            </SField>
            <SField label="模型">
              <SInput value={s.ai.model} onCommit={(v) => patch({ ai: { ...s.ai, model: v } })} />
            </SField>
            <SField label="API Key" hint={s.ai.hasKey ? '已保存（加密存储）' : '还没有配置'}>
              <SInput value={apiKey} onCommit={setApiKey} type="password" placeholder="sk-…" />
            </SField>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <SBtn
                size="sm"
                variant="primary"
                disabled={!apiKey}
                onClick={async () => {
                  await call((api) => api.aiKeySet(apiKey));
                  setApiKey('');
                  setNote('API Key 已保存');
                }}
              >
                保存 Key
              </SBtn>
              <SBtn
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await call((api) => api.aiTest());
                  setNote(r ? (r.ok ? `可用 · ${r.detail}` : `失败：${r.detail}`) : '失败');
                }}
              >
                测试
              </SBtn>
            </div>
          </SCard>

          <SCard title="通知与界面">
            <SToggle
              checked={s.notify.system}
              onChange={(v) => patch({ notify: { ...s.notify, system: v } })}
              label="系统通知"
              hint="开课、签到、接口变化"
            />
            <SToggle checked={s.notify.sound} onChange={(v) => patch({ notify: { ...s.notify, sound: v } })} label="通知声音" />
            <SField label="界面模式">
              <SSelect
                value={s.ui.mode}
                onChange={(v) => patch({ ui: { ...s.ui, mode: v as 'simple' | 'dev' } })}
                options={[
                  { value: 'simple', label: '普通模式（简洁）' },
                  { value: 'dev', label: '开发者模式（控制台）' },
                ]}
              />
            </SField>
            <div style={{ marginTop: 10 }}>
              <SBtn
                size="sm"
                variant="danger"
                onClick={() => {
                  void call((api) => api.ytLogout());
                  void call((api) => api.cxLogout());
                }}
              >
                清除两个平台的登录状态
              </SBtn>
            </div>
          </SCard>

          <SCard title="关于">
            <SRow title="版本" sub={`CourseDesk v${snap.version}`} />
            <SRow title="数据位置" sub="配置、日志、登录态都在本机用户目录" />
            <SRow title="协议依据" sub="GitHub 开源项目（docs/协议依据.md）" />
          </SCard>
        </div>
      </div>
    </div>
  );
}
