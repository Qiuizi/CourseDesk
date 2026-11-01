import type { ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { ago, hhmm } from '../lib/format';
import { Btn, Empty, KeyVal, Lamp, Panel, Pill, Select, Stat } from '../components/ui';

export function DriftPage({ snap, call }: PageProps): ReactNode {
  const now = useTick(2000);
  const d = snap.drift;
  const changed = d.results.filter((r) => r.changed);
  const unknownOps = Object.entries(d.unknownOps).sort((a, b) => b[1] - a[1]);

  return (
    <div className="stack">
      <div className="grid-2">
        <Panel
          eyebrow="DRIFT / WATCHER"
          title={
            <>
              <Lamp tone={changed.length ? 'warn' : d.running ? 'info' : 'ok'} pulse={d.running || changed.length > 0} />
              接口变更检测
            </>
          }
          meta={`基线比对 · 只探只读端点 · 上次 ${ago(d.lastCheckAt, now)}${d.nextCheckAt ? ` · 下次 ${hhmm(d.nextCheckAt)}` : ''}`}
          actions={
            <>
              <Btn size="sm" variant="primary" busy={d.running} onClick={() => void call((api) => api.driftCheck())}>
                立即检测
              </Btn>
              <Btn
                size="sm"
                disabled={!changed.length}
                onClick={() => void call((api) => api.driftAccept())}
              >
                全部接受
              </Btn>
            </>
          }
        >
          <div className="inline" style={{ gap: 24, alignItems: 'flex-start' }}>
            <Stat
              label="探测项"
              value={d.results.length}
              unit="个"
              hint={d.enabled ? '自动检测已开启' : '自动检测已关闭'}
            />
            <Stat
              label="有变化"
              value={changed.length}
              unit="项"
              tone={changed.length ? 'warn' : 'ok'}
              hint={
                d.results.length === 0
                  ? '还没检测过'
                  : d.results.every((r) => !r.baselineHash)
                    ? '登录后才会建立基线'
                    : changed.length
                      ? '结构已偏离基线'
                      : '与基线一致'
              }
            />
            <Stat label="未知 WS op" value={unknownOps.length} unit="种" tone={unknownOps.length ? 'warn' : 'idle'} />
            <Stat
              label="检测间隔"
              value={`${snap.settings.drift.intervalHours}h`}
              tone="info"
            />
          </div>
          <div className="divider" />
          <div className="inline">
            <Pill tone={snap.settings.drift.enabled ? 'ok' : 'idle'} mono>
              {snap.settings.drift.enabled ? 'AUTO ON' : 'AUTO OFF'}
            </Pill>
            <Select
              value={String(snap.settings.drift.intervalHours)}
              onChange={(v) =>
                void call((api) =>
                  api.updateSettings({ drift: { ...snap.settings.drift, intervalHours: Number(v) } }),
                )
              }
              options={[
                { value: '1', label: '每 1 小时' },
                { value: '3', label: '每 3 小时' },
                { value: '6', label: '每 6 小时' },
                { value: '12', label: '每 12 小时' },
                { value: '24', label: '每天' },
              ]}
              width={140}
            />
            <Btn
              size="sm"
              onClick={() =>
                void call((api) =>
                  api.updateSettings({ drift: { ...snap.settings.drift, enabled: !snap.settings.drift.enabled } }),
                )
              }
            >
              {snap.settings.drift.enabled ? '关闭自动检测' : '开启自动检测'}
            </Btn>
            <span className="grow" />
            <span className="tiny dim2">
              检测只发 GET，不签到、不提交答案；首次检测只建基线，不告警
            </span>
          </div>
        </Panel>

        <Panel eyebrow="DRIFT / UNKNOWN-OPS" title="未识别的 WS 消息" meta="课堂 WebSocket 里出现的新 op">
          {unknownOps.length === 0 ? (
            <Empty title="没有未知 op" hint="雨课堂 WS 的 11 种消息都在已知列表里" />
          ) : (
            <div className="kv-list">
              {unknownOps.map(([op, count]) => (
                <KeyVal key={op} k={op} v={`${count} 次`} />
              ))}
            </div>
          )}
          <div className="divider" />
          <div className="tiny dim2">
            未知 op 通常意味着平台加了新功能（例如新题型、新互动）。出现时事件流会记一条 warn。
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="DRIFT / PROBES"
        title="探测项明细"
        meta="结构指纹 = 响应里所有字段路径的 SHA-1 前 12 位；逐项对比基线"
      >
        {d.results.length === 0 ? (
          <Empty title="还没有检测记录" hint="点「立即检测」建立第一份基线" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>探测项</th>
                <th>HTTP</th>
                <th>字段数</th>
                <th>当前指纹</th>
                <th>基线</th>
                <th>差异</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.results.map((r) => (
                <tr key={r.probeId}>
                  <td>
                    <span className="inline" style={{ gap: 6 }}>
                      <Lamp tone={!r.ok ? 'err' : r.changed ? 'warn' : 'ok'} />
                      {r.label}
                    </span>
                    {r.note && <div className="tiny dim2">{r.note}</div>}
                  </td>
                  <td className="mono">{r.status}</td>
                  <td className="mono">{r.pathCount}</td>
                  <td className="mono tiny">{r.hash}</td>
                  <td className="mono tiny dim2">{r.baselineHash ?? '—'}</td>
                  <td>
                    {!r.baselineHash ? (
                      <Pill tone={r.ok ? 'info' : 'idle'} mono>
                        NO BASE
                      </Pill>
                    ) : r.changed ? (
                      <span className="tiny">
                        <span className="amber">+{r.added.length}</span> / <span className="danger">-{r.removed.length}</span>
                      </span>
                    ) : (
                      <Pill tone="ok" mono>
                        SAME
                      </Pill>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.changed && (
                      <Btn size="sm" variant="quiet" onClick={() => void call((api) => api.driftAccept(r.probeId))}>
                        接受
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {changed.length > 0 && (
        <Panel eyebrow="DRIFT / DIFF" title="结构差异明细" meta="新增/消失的字段路径">
          <div className="stack stack--tight">
            {changed.map((r) => (
              <div key={r.probeId} className="problem">
                <div className="problem__top">
                  <Pill tone="warn" mono>
                    {r.probeId}
                  </Pill>
                  <span className="tiny dim2">{r.label}</span>
                  <span className="grow" />
                  <Btn size="sm" variant="quiet" onClick={() => void call((api) => api.driftAccept(r.probeId))}>
                    接受这次变化
                  </Btn>
                </div>
                {r.added.length > 0 && (
                  <div className="problem__answer" style={{ borderStyle: 'solid' }}>
                    新增字段：{r.added.join('、')}
                  </div>
                )}
                {r.removed.length > 0 && (
                  <div className="problem__analysis">消失字段：{r.removed.join('、')}</div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
