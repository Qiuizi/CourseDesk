import { useEffect, useState, type ReactNode } from 'react';
import type { PageProps } from '../lib/store';
import { Btn, Field, KeyVal, LocalInput, Panel, Pill, Select, TextInput, Toggle } from './ui';
import { CHECKIN_HOSTS, CHECKIN_MODES, CHECKIN_SOURCES, ANSWER_POLICIES } from '../lib/options';

export function SettingsPage({ snap, call }: PageProps): ReactNode {
  const s = snap.settings;
  const [apiKey, setApiKey] = useState('');
  const [aiStatus, setAiStatus] = useState<string>('');
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);

  useEffect(() => {
    void window.coursedesk.appInfo().then(setInfo);
  }, [snap.version]);

  const patch = (p: Parameters<Window['coursedesk']['updateSettings']>[0]): void => {
    void call((api) => api.updateSettings(p));
  };

  return (
    <div className="stack">
      <div className="grid-2">
        {/* ------------------------------------------------ 雨课堂 */}
        <Panel eyebrow="CONFIG / YUKETANG" title="雨课堂" meta="轮询、签到指纹、答题策略">
          <div className="stack stack--tight">
            <Field label="学校域名" hint="不同学校可能部署在不同子域">
              <Select
                value={s.yuketang.host}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, host: v } })}
                options={CHECKIN_HOSTS.map((h) => ({ value: h.value, label: h.label }))}
              />
            </Field>
            <Field label="轮询间隔" hint="秒；下限 15s（过快容易被风控）">
              <LocalInput
                type="number"
                value={String(s.yuketang.pollIntervalSec)}
                onCommit={(v) => patch({ yuketang: { ...s.yuketang, pollIntervalSec: Math.max(15, Number(v) || 15) } })}
              />
            </Field>
            <Field label="签到指纹 source" hint="进入课堂 URL 上的渠道参数，服务端按此记录出勤渠道">
              <Select
                value={String(s.yuketang.checkinSource)}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, checkinSource: Number(v) } })}
                options={CHECKIN_SOURCES.map((s2) => ({ value: String(s2.value), label: s2.label }))}
              />
            </Field>
            <Field label="进入课堂方式">
              <Select
                value={s.yuketang.checkinMode}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, checkinMode: v as typeof s.yuketang.checkinMode } })}
                options={CHECKIN_MODES.map((m) => ({ value: m.value, label: m.label }))}
              />
            </Field>
            <div className="divider" />
            <Toggle
              checked={s.yuketang.autoEnterClass}
              onChange={(v) => patch({ yuketang: { ...s.yuketang, autoEnterClass: v } })}
              label="检测到开课自动进入"
              hint="轮询发现在课 → 立即调 checkin 并接入 WS（可关）"
            />
            <Toggle
              checked={s.yuketang.notifyOnLesson}
              onChange={(v) => patch({ yuketang: { ...s.yuketang, notifyOnLesson: v } })}
              label="开课推送系统通知"
              hint="同一节课 60 秒内只提醒一次"
            />
            <Toggle
              checked={s.yuketang.homeworkWatch}
              onChange={(v) => patch({ yuketang: { ...s.yuketang, homeworkWatch: v } })}
              label="刷新时同时拉作业列表"
              hint="依赖课程 leafId，抓不到不影响课堂"
            />
            <div className="divider" />
            <Field label="答题策略" hint="off 纯人工 / confirm 生成后等确认 / auto 客观题直接交">
              <Select
                value={s.yuketang.answerPolicy}
                onChange={(v) => patch({ yuketang: { ...s.yuketang, answerPolicy: v as typeof s.yuketang.answerPolicy } })}
                options={ANSWER_POLICIES}
              />
            </Field>
            <div className="inline tiny dim2">
              主观题（type 5）永远只生成解析，不提交；这是硬规则，不随策略变化。
            </div>
          </div>
        </Panel>

        {/* ------------------------------------------------ 学习通 */}
        <Panel eyebrow="CONFIG / CHAOXING" title="学习通" meta="轮询、签到白名单、默认位置">
          <div className="stack stack--tight">
            <Field label="轮询间隔" hint="秒；课程间另有 150–500ms 抖动">
              <LocalInput
                type="number"
                value={String(s.chaoxing.pollIntervalSec)}
                onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, pollIntervalSec: Math.max(15, Number(v) || 30) } })}
              />
            </Field>
            <Field label="扫描课程数上限" hint="activelist 是逐课程查询，课程多时降低此值">
              <LocalInput
                type="number"
                value={String(s.chaoxing.courseScanLimit)}
                onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, courseScanLimit: Math.max(1, Number(v) || 8) } })}
              />
            </Field>
            <Toggle
              checked={s.chaoxing.autoSign}
              onChange={(v) => patch({ chaoxing: { ...s.chaoxing, autoSign: v } })}
              label="自动签到"
              hint="命中白名单类型时直接提交；否则只提醒"
            />
            <Toggle
              checked={s.chaoxing.notifyOnNewActive}
              onChange={(v) => patch({ chaoxing: { ...s.chaoxing, notifyOnNewActive: v } })}
              label="新活动推送通知"
            />
            <div className="divider" />
            <div className="eyebrow">签 到 类 型 白 名 单</div>
            <div className="grid-3" style={{ gap: 6 }}>
              <Toggle
                checked={s.chaoxing.signTypes.normal}
                onChange={(v) => patch({ chaoxing: { ...s.chaoxing, signTypes: { ...s.chaoxing.signTypes, normal: v } } })}
                label="普通"
              />
              <Toggle
                checked={s.chaoxing.signTypes.location}
                onChange={(v) => patch({ chaoxing: { ...s.chaoxing, signTypes: { ...s.chaoxing.signTypes, location: v } } })}
                label="位置"
              />
              <Toggle
                checked={s.chaoxing.signTypes.gesture}
                onChange={(v) => patch({ chaoxing: { ...s.chaoxing, signTypes: { ...s.chaoxing.signTypes, gesture: v } } })}
                label="手势"
              />
              <Toggle
                checked={s.chaoxing.signTypes.code}
                onChange={(v) => patch({ chaoxing: { ...s.chaoxing, signTypes: { ...s.chaoxing.signTypes, code: v } } })}
                label="签到码"
              />
            </div>
            <div className="divider" />
            <div className="eyebrow">默 认 位 置（教 师 未 指 定 时 使 用）</div>
            <div className="grid-2" style={{ gap: 8 }}>
              <Field label="纬度">
                <LocalInput
                  value={s.chaoxing.location.latitude}
                  onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, location: { ...s.chaoxing.location, latitude: v } } })}
                />
              </Field>
              <Field label="经度">
                <LocalInput
                  value={s.chaoxing.location.longitude}
                  onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, location: { ...s.chaoxing.location, longitude: v } } })}
                />
              </Field>
            </div>
            <Field label="地址文本" hint="会显示在签到记录里">
              <LocalInput
                value={s.chaoxing.location.address}
                onCommit={(v) => patch({ chaoxing: { ...s.chaoxing, location: { ...s.chaoxing.location, address: v } } })}
              />
            </Field>
          </div>
        </Panel>

        {/* ------------------------------------------------ AI */}
        <Panel
          eyebrow="CONFIG / AI"
          title="AI 作答"
          meta="OpenAI 兼容接口；Key 用 Electron safeStorage 加密后落盘"
          actions={
            <Pill tone={s.ai.hasKey ? 'ok' : 'warn'} mono>
              {s.ai.hasKey ? 'KEY 已保存' : '未配置 KEY'}
            </Pill>
          }
        >
          <div className="stack stack--tight">
            <Toggle
              checked={s.ai.enabled}
              onChange={(v) => patch({ ai: { ...s.ai, enabled: v } })}
              label="启用 AI 作答"
              hint="关闭时只做人工答题，不会调用任何外部接口"
            />
            <Field label="Base URL">
              <LocalInput value={s.ai.baseUrl} onCommit={(v) => patch({ ai: { ...s.ai, baseUrl: v } })} />
            </Field>
            <div className="grid-2" style={{ gap: 8 }}>
              <Field label="模型">
                <LocalInput value={s.ai.model} onCommit={(v) => patch({ ai: { ...s.ai, model: v } })} />
              </Field>
              <Field label="温度">
                <LocalInput
                  value={String(s.ai.temperature)}
                  onCommit={(v) => patch({ ai: { ...s.ai, temperature: Number(v) || 0 } })}
                />
              </Field>
            </div>
            <Field label="API Key" hint="留空则不改动已保存的值">
              <TextInput value={apiKey} onChange={setApiKey} type="password" placeholder="sk-…" />
            </Field>
            <div className="inline">
              <Btn
                variant="primary"
                size="sm"
                disabled={!apiKey}
                onClick={async () => {
                  const res = await call((api) => api.aiKeySet(apiKey));
                  if (res) {
                    setApiKey('');
                    setAiStatus('已保存');
                  }
                }}
              >
                保存 Key
              </Btn>
              <Btn
                size="sm"
                onClick={async () => {
                  setAiStatus('测试中…');
                  const res = await call((api) => api.aiTest());
                  setAiStatus(res ? (res.ok ? `可用 ${res.detail}` : `失败：${res.detail}`) : '失败');
                }}
              >
                测试连通
              </Btn>
              <Btn
                size="sm"
                variant="danger"
                disabled={!s.ai.hasKey}
                onClick={async () => {
                  await call((api) => api.aiKeySet(''));
                  setAiStatus('已清除');
                }}
              >
                清除 Key
              </Btn>
              {aiStatus && <span className="tiny dim2">{aiStatus}</span>}
            </div>
          </div>
        </Panel>

        {/* ------------------------------------------------ 界面 */}
        <Panel eyebrow="CONFIG / UI" title="界面与通知">
          <div className="stack stack--tight">
            <Field label="强调色">
              <Select
                value={s.ui.accent}
                onChange={(v) => patch({ ui: { ...s.ui, accent: v as typeof s.ui.accent } })}
                options={[
                  { value: 'lime', label: '荧光绿（默认）' },
                  { value: 'amber', label: '琥珀' },
                  { value: 'cyan', label: '冷青' },
                ]}
              />
            </Field>
            <Field label="信息密度">
              <Select
                value={s.ui.density}
                onChange={(v) => patch({ ui: { ...s.ui, density: v as typeof s.ui.density } })}
                options={[
                  { value: 'comfortable', label: '标准' },
                  { value: 'compact', label: '紧凑' },
                ]}
              />
            </Field>
            <Toggle
              checked={s.notify.system}
              onChange={(v) => patch({ notify: { ...s.notify, system: v } })}
              label="系统通知"
              hint="开课 / 新签到 / 提交失败"
            />
            <Toggle
              checked={s.notify.sound}
              onChange={(v) => patch({ notify: { ...s.notify, sound: v } })}
              label="通知声音"
            />
            <div className="divider" />
            <div className="eyebrow">危 险 区</div>
            <div className="inline">
              <Btn
                size="sm"
                variant="danger"
                onClick={() => void call((api) => api.resetSettings())}
              >
                恢复默认设置
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  void call((api) => api.ytLogout());
                  void call((api) => api.cxLogout());
                }}
              >
                清除两个平台的登录态
              </Btn>
            </div>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="ABOUT" title="关于与数据位置">
        <div className="grid-2" style={{ gap: 0 }}>
          <div>
            <KeyVal k="版本" v={`v${snap.version}`} />
            <KeyVal k="配置目录" v={info?.dataDir ?? '…'} />
            <KeyVal k="启动时间" v={new Date(snap.startedAt).toLocaleString()} />
            <KeyVal k="事件数" v={`${snap.events.length} / 300`} />
          </div>
          <div>
            <KeyVal k="协议依据" v="GitHub 高星开源项目（docs/协议依据.md）" mono={false} />
            <KeyVal k="登录态" v="Electron persist 分区，重启复用" mono={false} />
            <KeyVal k="敏感值" v="safeStorage 加密（DPAPI）" mono={false} />
            <KeyVal k="网络" v="全部请求由主进程发起，渲染进程不直连" mono={false} />
          </div>
        </div>
        <div className="divider" />
        <div className="inline">
          <Btn size="sm" onClick={() => void call((api) => api.openExternal('https://www.yuketang.cn/v2/web/index'))}>
            打开雨课堂
          </Btn>
          <Btn size="sm" onClick={() => void call((api) => api.openExternal('https://i.chaoxing.com/base'))}>
            打开学习通
          </Btn>
          <Btn
            size="sm"
            variant="quiet"
            onClick={() => void call((api) => api.openExternal(`file://${info?.dataDir ?? ''}`))}
          >
            打开数据目录
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
