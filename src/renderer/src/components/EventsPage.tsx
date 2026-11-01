import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LogLine } from '@shared/types';
import type { PageProps } from '../lib/store';
import { useTick } from '../lib/store';
import { hhmmss } from '../lib/format';
import { Btn, Empty, Panel, Pill, TextInput } from './ui';
import { Feed } from './Feed';

type PlatformFilter = 'all' | 'yuketang' | 'chaoxing';
type LevelFilter = 'all' | 'warn' | 'error' | 'success';

export function EventsPage({ snap, call }: PageProps): ReactNode {
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const now = useTick(2000);

  useEffect(() => {
    if (!showLogs) return;
    let alive = true;
    const pull = async () => {
      const lines = await call((api) => api.logs(220));
      if (alive && lines) setLogs(lines);
    };
    void pull();
    const t = setInterval(() => void pull(), 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [showLogs, call, now]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return snap.events.filter((e) => {
      if (platform !== 'all' && e.platform !== platform) return false;
      if (level === 'warn' && e.level !== 'warn') return false;
      if (level === 'error' && e.level !== 'error') return false;
      if (level === 'success' && e.level !== 'success') return false;
      if (k && !`${e.title}${e.detail ?? ''}${e.kind}`.toLowerCase().includes(k)) return false;
      return true;
    });
  }, [snap.events, platform, level, keyword]);

  const counts = useMemo(() => {
    const c = { warn: 0, error: 0, success: 0, info: 0 };
    for (const e of snap.events) c[e.level] += 1;
    return c;
  }, [snap.events]);

  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of snap.events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [snap.events]);

  const unknownOps = useMemo(
    () => snap.events.filter((e) => e.kind === 'protocol').length,
    [snap.events],
  );

  return (
    <div className="stack">
      <div className="split">
      <Panel
        eyebrow="STREAM / EVENTS"
        title="事件流"
        meta={`${snap.events.length} 条（保留最近 300 条，本机持久化）`}
        actions={
          <>
            <div className="seg">
              {(['all', 'yuketang', 'chaoxing'] as PlatformFilter[]).map((p) => (
                <button key={p} type="button" className={platform === p ? 'is-active' : ''} onClick={() => setPlatform(p)}>
                  {p === 'all' ? '全部' : p === 'yuketang' ? '雨课堂' : '学习通'}
                </button>
              ))}
            </div>
            <div className="seg">
              {(['all', 'warn', 'error', 'success'] as LevelFilter[]).map((l) => (
                <button key={l} type="button" className={level === l ? 'is-active' : ''} onClick={() => setLevel(l)}>
                  {l === 'all' ? '全部' : l === 'warn' ? '警告' : l === 'error' ? '错误' : '成功'}
                </button>
              ))}
            </div>
            <div style={{ width: 170 }}>
              <TextInput value={keyword} onChange={setKeyword} placeholder="搜索标题/详情" />
            </div>
          </>
        }
      >
        <div className="inline" style={{ marginBottom: 10 }}>
          <Pill tone="ok" mono>
            success {counts.success}
          </Pill>
          <Pill tone="warn" mono>
            warn {counts.warn}
          </Pill>
          <Pill tone="err" mono>
            error {counts.error}
          </Pill>
          <Pill tone="info" mono>
            info {counts.info}
          </Pill>
          <span className="grow" />
          <Btn size="sm" variant="quiet" onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? '隐藏主进程日志' : '查看主进程日志'}
          </Btn>
          <Btn
            size="sm"
            variant="quiet"
            onClick={async () => {
              const text = filtered
                .slice()
                .reverse()
                .map((e) => `${new Date(e.at).toISOString()} [${e.platform}/${e.level}] ${e.title} ${e.detail ?? ''}`)
                .join('\n');
              await navigator.clipboard.writeText(text);
            }}
          >
            复制当前视图
          </Btn>
        </div>
        <div className="scroll" style={{ maxHeight: 560 }}>
          {filtered.length === 0 ? <Empty title="没有匹配的事件" /> : <Feed events={filtered} />}
        </div>
      </Panel>

      <div className="stack">
        <Panel eyebrow="STATS / KIND" title="事件分布" meta={`${snap.events.length} 条样本`}>
          {byKind.length === 0 ? (
            <Empty title="暂无数据" />
          ) : (
            <div className="kv-list">
              {byKind.map(([kind, n]) => (
                <div className="kv" key={kind}>
                  <span className="kv__k">{kind}</span>
                  <span className="kv__v kv__v--mono">
                    {n} 条
                    <span
                      style={{
                        display: 'inline-block',
                        marginLeft: 8,
                        height: 4,
                        width: Math.min(120, n * 12),
                        background: 'rgba(154,230,110,.45)',
                        borderRadius: 2,
                        verticalAlign: 'middle',
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="WATCH / DRIFT" title="协议漂移监控" meta="平台改版预警">
          <div className="kv-list">
            <div className="kv">
              <span className="kv__k">未知 WS op</span>
              <span className="kv__v kv__v--mono">{unknownOps} 次</span>
            </div>
            <div className="kv">
              <span className="kv__k">接口签名</span>
              <span className="kv__v kv__v--mono">
                {snap.yuketang.monitor.signature ?? '—'} · {snap.chaoxing.monitor.signature ?? '—'}
              </span>
            </div>
          </div>
          <div className="divider" />
          <div className="tiny dim2">
            WS 出现未知 op、或轮询连续失败，都会落到事件流；接口结构签名变化会在下一次刷新时体现。
          </div>
        </Panel>
      </div>
      </div>

      {showLogs && (
        <Panel
          eyebrow="DIAGNOSTICS / LOG"
          title="主进程日志"
          meta="同时落盘到 userData/logs/coursedesk-YYYYMMDD.jsonl"
          actions={
            <Btn
              size="sm"
              variant="danger"
              onClick={() => {
                void call((api) => api.clearLogs());
                setLogs([]);
              }}
            >
              清空环形缓冲
            </Btn>
          }
        >
          {logs.length === 0 ? (
            <Empty title="暂无日志" />
          ) : (
            <div className="scroll" style={{ maxHeight: 380 }}>
              {[...logs].reverse().map((l, i) => (
                <div className="feed__item" key={`${l.at}-${i}`}>
                  <span className="feed__time">{hhmmss(l.at)}</span>
                  <span className={`feed__dot ${l.level === 'error' ? 'feed__dot--err' : l.level === 'warn' ? 'feed__dot--warn' : 'feed__dot--info'}`} />
                  <div className="feed__body">
                    <div className="feed__title">
                      <span className="tiny dim2">{l.scope}</span> {l.message}
                    </div>
                    {l.data !== undefined && (
                      <div className="feed__detail">{typeof l.data === 'string' ? l.data : JSON.stringify(l.data)}</div>
                    )}
                  </div>
                  <span className="feed__platform">{l.level}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
