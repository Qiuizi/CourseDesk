/**
 * 引擎：把两个平台的协议客户端、监控循环、事件流、持久化粘在一起。
 *
 * 只有它可以改运行态状态；渲染进程通过 IPC 读快照 / 发动作。
 */

import { JsonStore } from './log';
import { buildHeartbeatEvents, dedupeEvents, deepMerge } from './pure';
import { log } from './log';
import { notify } from './notify';
import { callAi, buildPrompt, parseAnswerArray } from './ai';
import { decryptSecret, encryptSecret } from './net';
import { YtClient, buildResult, str } from '../platforms/yuketang/client';
import { YtLessonSocket } from '../platforms/yuketang/ws';
import { yt } from '../platforms/yuketang/endpoints';
import { ChaoxingClient, isSignActive } from '../platforms/chaoxing/client';
import { buildProbes, runDriftCheck, type DriftProbe } from './drift';
import type {
  AppSnapshot,
  ChaoxingActive,
  ClassEvent,
  Course,
  EventKind,
  EventLevel,
  HomeworkItem,
  LessonSession,
  OnLesson,
  PlatformId,
  Problem,
  Settings,
  UpdateState,
  SignRecord,
} from '@shared/types';

export const DEFAULT_SETTINGS: Settings = {
  yuketang: {
    host: 'www.yuketang.cn',
    pollIntervalSec: 20,
    notifyOnLesson: true,
    autoEnterClass: false,
    checkinSource: 5,
    checkinMode: 'both',
    answerPolicy: 'off',
    confirmTimeoutSec: 60,
    videoHeartbeat: false,
    homeworkWatch: true,
  },
  chaoxing: {
    pollIntervalSec: 30,
    autoSign: false,
    notifyOnNewActive: true,
    location: { latitude: '30.5560', longitude: '103.9890', address: '校园默认位置' },
    signTypes: { normal: true, location: true, gesture: true, code: true },
    courseScanLimit: 8,
  },
  ai: { enabled: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', temperature: 0.2, timeoutSec: 40 },
  notify: { system: true, sound: false },
  ui: { accent: 'lime', density: 'comfortable', mode: 'simple' },
  drift: { enabled: true, intervalHours: 6, notify: true },
  behavior: { closeToTray: true, launchAtLogin: false, notifyWhenHidden: true },
  startMinimized: false,
};

interface PersistData {
  version: number;
  settings: Settings;
  secrets: Record<string, string>;
  events: ClassEvent[];
  cache: {
    ytCourses?: Course[];
    cxCourses?: Course[];
    ytBearer?: string;
    ytUvId?: string;
    ytUserId?: string;
    cxSigns?: SignRecord[];
    ytHomework?: HomeworkItem[];
    cxHomework?: HomeworkItem[];
    driftBaselines?: Record<string, { hash: string; paths: string[]; at: number }>;
  };
}

export class Engine {
  readonly yt = new YtClient(DEFAULT_SETTINGS.yuketang.host);
  readonly cx = new ChaoxingClient();

  private store: JsonStore<PersistData>;
  private snap: AppSnapshot;
  private ytTimer: NodeJS.Timeout | null = null;
  private cxTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private sock: YtLessonSocket | null = null;
  private aiKey = '';
  private driftTimer: NodeJS.Timeout | null = null;
  private driftPaths = new Map<string, string[]>();
  private seenLessons = new Set<string>();
  private seenActives = new Set<string>();
  private notifyThrottle = new Map<string, number>();
  private stopped = false;

  constructor(private readonly broadcast: (snap: AppSnapshot) => void) {
    this.store = new JsonStore<PersistData>('state.json', {
      version: 1,
      settings: structuredClone(DEFAULT_SETTINGS),
      secrets: {},
      events: [],
      cache: {},
    });
    this.snap = {
      version: '',
      startedAt: Date.now(),
      settings: structuredClone(DEFAULT_SETTINGS),
      yuketang: {
        auth: { logged: false },
        courses: [],
        onLesson: [],
        lesson: null,
        homework: [],
        monitor: { running: false, pollCount: 0 },
        videoReported: {},
      },
      chaoxing: {
        auth: { logged: false },
        courses: [],
        actives: [],
        signs: [],
        homework: [],
        monitor: { running: false, pollCount: 0 },
      },
      events: [],
      health: { yuketang: { ok: true, notes: [] }, chaoxing: { ok: true, notes: [] } },
      drift: {
        enabled: true,
        intervalHours: 6,
        running: false,
        results: [],
        unknownOps: {},
        hasDrift: false,
      },
      update: { status: 'idle' },
      busy: {},
    };
  }

  /* ---------------------------------------------------------------- 生命周期 */

  async init(version: string): Promise<void> {
    const persisted = await this.store.load();
    this.snap.version = version;
    this.snap.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), persisted.settings ?? {});
    this.aiKey = decryptSecret(persisted.secrets.aiKey);
    this.snap.settings.ai.hasKey = Boolean(this.aiKey);
    this.snap.events = dedupeEvents(Array.isArray(persisted.events) ? persisted.events : []);
    this.snap.drift.enabled = this.snap.settings.drift.enabled;
    this.snap.drift.intervalHours = this.snap.settings.drift.intervalHours;

    const cache = persisted.cache ?? {};
    this.yt.setHost(this.snap.settings.yuketang.host);
    this.yt.bearer = cache.ytBearer ?? '';
    this.yt.uvId = cache.ytUvId ?? '0';
    this.yt.userId = cache.ytUserId ?? '';
    this.snap.yuketang.courses = cache.ytCourses ?? [];
    this.snap.chaoxing.courses = cache.cxCourses ?? [];
    this.snap.chaoxing.signs = cache.cxSigns ?? [];
    this.snap.yuketang.homework = cache.ytHomework ?? [];
    this.snap.chaoxing.homework = cache.cxHomework ?? [];

    this.emit({
      platform: 'yuketang',
      kind: 'system',
      level: 'info',
      title: '工作台已启动',
      detail: `版本 ${version} · 配置目录已就绪`,
    });

    // 截图/自检用的演示数据：只读本地，不发任何请求
    if (process.env['COURSEDESK_DEMO'] === '1') {
      this.seedDemo();
      this.pushSoon();
      return;
    }

    void this.probeAll(false);
    this.startMonitors();
    const driftNow = process.env['COURSEDESK_DRIFT_NOW'];
    this.scheduleDrift(driftNow ? 1500 : 25_000);
    this.pushSoon();
  }

  /** COURSEDESK_DEMO=1：塞一份形状真实的快照，用于界面自检与文档截图 */
  private seedDemo(): void {
    const now = Date.now();
    const min = 60_000;

    this.snap.yuketang.auth = { logged: true, userName: '演示账号', userId: '90210', checkedAt: now - 4 * min };
    this.snap.yuketang.courses = [
      { platform: 'yuketang', id: '41120', classId: '88021', name: '数据结构与算法', teacher: '王敏', extra: { leafId: '3311' } },
      { platform: 'yuketang', id: '41131', classId: '88104', name: '计算机网络', teacher: '李宏' },
      { platform: 'yuketang', id: '41207', classId: '88290', name: '概率论与数理统计', teacher: '陈雯' },
    ];
    this.snap.yuketang.onLesson = [
      {
        lessonId: '1024001',
        classroomId: '88021',
        courseId: '41120',
        courseName: '数据结构与算法',
        classroomName: '周三 3-4 节 · 教三 204',
        role: 5,
        detectedAt: now - 6 * min,
      },
    ];
    const problems: Problem[] = [
      {
        problemId: 'p-77120',
        problemType: 1,
        body: '在一棵有 n 个结点的完全二叉树中，叶子结点的个数为？',
        options: [
          { key: 'A', value: 'n/2 向下取整' },
          { key: 'B', value: 'n/2 向上取整' },
          { key: 'C', value: '2n' },
          { key: 'D', value: 'n-1' },
        ],
        blankCount: 0,
        slideIndex: 12,
        limitSec: 120,
        unlockedAt: now - 40_000,
        deadlineAt: now + 80_000,
        answer: ['B'],
        submitState: 'confirm',
        submitMessage: 'AI 已给出建议，确认后提交',
      },
      {
        problemId: 'p-77121',
        problemType: 2,
        body: '下列哪些排序算法在最坏情况下时间复杂度为 O(n log n)？',
        options: [
          { key: 'A', value: '归并排序' },
          { key: 'B', value: '快速排序' },
          { key: 'C', value: '堆排序' },
          { key: 'D', value: '插入排序' },
        ],
        blankCount: 0,
        slideIndex: 12,
        limitSec: 90,
        unlockedAt: now - 20_000,
        deadlineAt: now + 70_000,
      },
      {
        problemId: 'p-77122',
        problemType: 4,
        body: '对序列 {5, 2, 9, 1} 做一趟快速排序（以首元素为枢轴），划分后枢轴左侧元素为第 1 空，右侧元素为第 2 空。',
        options: [],
        blankCount: 2,
        slideIndex: 13,
        unlockedAt: now - 12_000,
      },
      {
        problemId: 'p-77123',
        problemType: 6,
        body: '堆排序是稳定排序。',
        options: [],
        blankCount: 0,
        slideIndex: 13,
        unlockedAt: now - 8_000,
        deadlineAt: now + 52_000,
      },
      {
        problemId: 'p-77124',
        problemType: 5,
        body: '简述 Dijkstra 算法为什么不能处理带负权边的图。',
        options: [],
        blankCount: 0,
        slideIndex: 14,
        unlockedAt: now - 5_000,
        aiAnalysis:
          'Dijkstra 依赖「已确定的点不会再被更短路径更新」这一贪心前提：每次取出当前距离最小的未访问点，并认为它已是最短。负权边会让这个前提失效——先被确定的点可能通过后面发现的负权边获得更短路径，算法不会再回头修正，于是结果错误。带负权时应使用 Bellman-Ford 或 SPFA。',
      },
    ];
    this.snap.yuketang.lesson = {
      lessonId: '1024001',
      classroomId: '88021',
      lessonToken: 'demo-lesson-token',
      identityId: 'stu-9021',
      courseName: '数据结构与算法',
      startedAt: now - 6 * min,
      wsState: 'open',
      problems,
      lastEventAt: now - 5_000,
    };
    this.snap.yuketang.homework = [
      {
        platform: 'yuketang',
        id: 'hw-1',
        courseName: '数据结构与算法',
        title: '实验四：平衡二叉树的插入与删除',
        statusText: '未提交',
        leftText: '还剩 2 天',
        leftHours: 48,
      },
      {
        platform: 'yuketang',
        id: 'hw-2',
        courseName: '计算机网络',
        title: '第三章 传输层 课后习题',
        statusText: '已提交',
        leftText: '已截止',
        leftHours: null,
      },
    ];
    this.snap.yuketang.monitor = { running: true, lastPollAt: now - 12_000, lastPollOk: true, pollCount: 42 };

    this.snap.chaoxing.auth = { logged: true, userName: '演示同学', userId: 'cx-8802', checkedAt: now - 3 * min };
    this.snap.chaoxing.courses = [
      { platform: 'chaoxing', id: 'cx-1', classId: 'c-1', name: '大学英语（三）', teacher: '张倩' },
      { platform: 'chaoxing', id: 'cx-2', classId: 'c-2', name: '马克思主义基本原理', teacher: '刘洋' },
    ];
    this.snap.chaoxing.actives = [
      {
        id: 'act-9001',
        courseId: 'cx-1',
        classId: 'c-1',
        courseName: '大学英语（三）',
        title: '第 7 周 课堂签到',
        activeType: 2,
        status: 1,
        ongoing: true,
        startedAt: now - 4 * min,
        method: 'location',
      },
      {
        id: 'act-8990',
        courseId: 'cx-2',
        classId: 'c-2',
        courseName: '马克思主义基本原理',
        title: '第 6 周 签到',
        activeType: 2,
        status: 2,
        ongoing: false,
        startedAt: now - 26 * 60 * min,
        method: 'code',
      },
    ];
    this.snap.chaoxing.signs = [
      {
        id: 'sign-1',
        activeId: 'act-8990',
        courseName: '马克思主义基本原理',
        title: '第 6 周 签到',
        method: 'code',
        ok: true,
        detail: '签到码 3821 · success',
        at: now - 25.5 * 60 * min,
      },
    ];
    this.snap.chaoxing.homework = [
      {
        platform: 'chaoxing',
        id: 'cx-hw-1',
        courseName: '大学英语（三）',
        title: 'Unit 5 写作任务',
        statusText: '未提交',
        leftText: '还剩 5 小时',
        leftHours: 5,
      },
    ];
    this.snap.chaoxing.monitor = { running: true, lastPollAt: now - 20_000, lastPollOk: true, pollCount: 31 };

    this.snap.drift = {
      enabled: true,
      intervalHours: 6,
      running: false,
      lastCheckAt: now - 2 * 60 * min,
      nextCheckAt: now + 4 * 60 * min,
      results: [
        {
          probeId: 'yt-courses',
          platform: 'yuketang',
          label: '雨课堂 · 课程列表',
          ok: true,
          status: 200,
          hash: '5ec63bee3a2fe',
          pathCount: 46,
          checkedAt: now - 2 * 60 * min,
          baselineHash: '5ec63bee3a2fe',
          baselineAt: now - 26 * 60 * min,
          added: [],
          removed: [],
          changed: false,
        },
        {
          probeId: 'yt-active',
          platform: 'yuketang',
          label: '雨课堂 · 在课接口',
          ok: true,
          status: 200,
          hash: '8a4f477766d0b',
          pathCount: 31,
          checkedAt: now - 2 * 60 * min,
          baselineHash: '8a4f477766d0b',
          baselineAt: now - 26 * 60 * min,
          added: [],
          removed: [],
          changed: false,
        },
        {
          probeId: 'cx-courses',
          platform: 'chaoxing',
          label: '学习通 · 课程列表',
          ok: true,
          status: 200,
          hash: 'c1d90aa41e7f2',
          pathCount: 28,
          checkedAt: now - 2 * 60 * min,
          baselineHash: 'c1d90aa41e7f2',
          baselineAt: now - 26 * 60 * min,
          added: [],
          removed: [],
          changed: false,
        },
      ],
      unknownOps: {},
      hasDrift: false,
    };

    const evt = (
      at: number,
      platform: PlatformId,
      kind: EventKind,
      level: EventLevel,
      title: string,
      detail?: string,
    ): ClassEvent => ({ id: `demo-${at}-${title.length}`, platform, kind, level, title, detail, at });

    this.snap.events = [
      evt(now - 2 * 60 * min, 'yuketang', 'protocol', 'info', '接口基线检查完成', '3 个只读端点 · 结构一致'),
      evt(now - 25.5 * 60 * min, 'chaoxing', 'sign', 'success', '签到成功：马克思主义基本原理', '签到码 3821'),
      evt(now - 6 * min, 'yuketang', 'lesson', 'success', '检测到在课：数据结构与算法', 'lesson 1024001 · classroom 88021'),
      evt(now - 6 * min + 2_000, 'yuketang', 'lesson', 'info', '进入课堂成功（checkin source=5）', 'lessonToken 已获取，WebSocket 已连接'),
      evt(now - 4 * min, 'chaoxing', 'sign', 'success', '签到成功：大学英语（三）', '位置签到 · 使用教师坐标'),
      evt(now - 40_000, 'yuketang', 'problem', 'info', '解锁新题目：单选', 'p-77120 · 限时 120s'),
      evt(now - 20_000, 'yuketang', 'problem', 'info', '解锁新题目：多选', 'p-77121 · 限时 90s'),
    ];
  }

  /** 自动更新状态：由 updater 写，快照推给两个界面 */
  setUpdate(state: UpdateState): void {
    this.snap.update = { ...this.snap.update, ...state, checkedAt: state.checkedAt ?? this.snap.update.checkedAt };
    this.pushSoon();
  }

  /** 切换普通 / 开发者界面：原子更新，避免渲染层拼一个可能过期的对象 */
  setMode(mode: Settings['ui']['mode']): Settings {
    this.snap.settings.ui = { ...this.snap.settings.ui, mode };
    this.pushSoon();
    void this.persist();
    log.info('engine', `界面模式切换为 ${mode}`);
    return this.snap.settings;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.stopMonitors();
    this.stopDrift();
    this.sock?.close();
    this.sock = null;
    await this.persist();
    await this.store.flush();
    log.info('engine', '已停止并落盘');
  }

  async persist(): Promise<void> {
    this.store.update((d) => {
      d.settings = this.snap.settings;
      d.secrets = { ...d.secrets, aiKey: encryptSecret(this.aiKey) };
      d.events = this.snap.events.slice(-300);
      d.cache = {
        ...d.cache,
        ytCourses: this.snap.yuketang.courses,
        cxCourses: this.snap.chaoxing.courses,
        ytBearer: this.yt.bearer,
        ytUvId: this.yt.uvId,
        ytUserId: this.yt.userId,
        cxSigns: this.snap.chaoxing.signs.slice(0, 200),
        ytHomework: this.snap.yuketang.homework,
        cxHomework: this.snap.chaoxing.homework,
      };
    });
  }

  /* ---------------------------------------------------------------- 快照 / 事件 */

  snapshot(): AppSnapshot {
    return this.snap;
  }

  private pushSoon(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.broadcast(this.snap);
    }, 120);
  }

  emit(input: {
    platform: PlatformId;
    kind: EventKind;
    level: EventLevel;
    title: string;
    detail?: string;
    data?: Record<string, unknown>;
    quiet?: boolean;
  }): ClassEvent {
    const evt: ClassEvent = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      platform: input.platform,
      kind: input.kind,
      level: input.level,
      title: input.title,
      detail: input.detail,
      at: Date.now(),
      data: input.data,
    };
    this.snap.events = [...this.snap.events, evt].slice(-300);
    if (!input.quiet) {
      if (input.level === 'error') log.error(`${input.platform}/${input.kind}`, input.title, input.detail);
      else if (input.level === 'warn') log.warn(`${input.platform}/${input.kind}`, input.title, input.detail);
      else log.info(`${input.platform}/${input.kind}`, input.title, input.detail);
    }
    this.pushSoon();
    return evt;
  }

  private throttledNotify(key: string, title: string, body: string, cooldownMs = 60_000): void {
    if (!this.snap.settings.notify.system) return;
    const now = Date.now();
    const last = this.notifyThrottle.get(key) ?? 0;
    if (now - last < cooldownMs) return;
    this.notifyThrottle.set(key, now);
    notify({ title, body, silent: !this.snap.settings.notify.sound });
  }

  private setBusy(key: string, value: boolean): void {
    this.snap.busy[key] = value;
    this.pushSoon();
  }

  /* ---------------------------------------------------------------- 设置 */

  updateSettings(patch: Partial<Settings>): Settings {
    this.snap.settings = deepMerge(this.snap.settings, patch);
    if (patch.yuketang?.host) this.yt.setHost(patch.yuketang.host);
    this.snap.drift.enabled = this.snap.settings.drift.enabled;
    this.snap.drift.intervalHours = this.snap.settings.drift.intervalHours;
    this.scheduleDrift();
    this.snap.settings.ai.hasKey = Boolean(this.aiKey);
    this.restartMonitors();
    void this.persist();
    this.pushSoon();
    return this.snap.settings;
  }

  resetSettings(): Settings {
    this.snap.settings = structuredClone(DEFAULT_SETTINGS);
    this.snap.settings.ai.hasKey = Boolean(this.aiKey);
    this.yt.setHost(DEFAULT_SETTINGS.yuketang.host);
    this.restartMonitors();
    void this.persist();
    this.pushSoon();
    return this.snap.settings;
  }

  setAiKey(key: string): void {
    this.aiKey = key.trim();
    this.snap.settings.ai.hasKey = Boolean(this.aiKey);
    this.snap.settings.ai.enabled = Boolean(this.aiKey) && this.snap.settings.ai.enabled !== false;
    void this.persist();
    this.emit({
      platform: 'yuketang',
      kind: 'system',
      level: this.aiKey ? 'success' : 'info',
      title: this.aiKey ? 'AI Key 已保存（加密存储）' : 'AI Key 已清除',
    });
    this.pushSoon();
  }

  async testAi(): Promise<{ ok: boolean; detail: string }> {
    if (!this.aiKey) return { ok: false, detail: '未配置 API Key' };
    const res = await callAi(this.snap.settings.ai, this.aiKey, {
      system: '你是连通性测试助手。',
      user: '只回复两个字：可用',
    });
    this.emit({
      platform: 'yuketang',
      kind: 'system',
      level: res.ok ? 'success' : 'error',
      title: res.ok ? 'AI 连通性正常' : 'AI 连通性失败',
      detail: res.ok ? `${res.latencyMs}ms · ${res.text.slice(0, 40)}` : res.error,
    });
    return { ok: res.ok, detail: res.ok ? `${res.latencyMs}ms` : (res.error ?? '失败') };
  }

  /* ---------------------------------------------------------------- 登录态 */

  async probeAll(announce = false): Promise<void> {
    await Promise.all([this.probeYuketang(announce), this.probeChaoxing(announce)]);
    this.pushSoon();
  }

  async probeYuketang(announce = false): Promise<boolean> {
    const courses = await this.yt.courses();
    const logged = courses.length > 0;
    this.snap.yuketang.auth = {
      logged,
      userName: undefined,
      userId: this.yt.userId || undefined,
      checkedAt: Date.now(),
      error: logged ? undefined : '未探测到课程（未登录或课程为空）',
    };
    if (logged) {
      this.snap.yuketang.courses = courses;
      const leaf = courses.find((c) => c.extra?.uvId)?.extra?.uvId;
      if (leaf && this.yt.uvId === '0') this.yt.uvId = leaf;
      if (announce) {
        this.emit({
          platform: 'yuketang',
          kind: 'auth',
          level: 'success',
          title: '雨课堂已登录',
          detail: `${courses.length} 门课程`,
        });
      }
      void this.persist();
    } else if (announce) {
      this.emit({
        platform: 'yuketang',
        kind: 'auth',
        level: 'warn',
        title: '雨课堂未登录',
        detail: '点「登录雨课堂」用微信扫码，登录态会保存在本机',
      });
    }
    return logged;
  }

  async probeChaoxing(announce = false): Promise<boolean> {
    const probe = await this.cx.probe();
    this.snap.chaoxing.auth = {
      logged: probe.logged,
      userName: probe.userName,
      checkedAt: Date.now(),
      error: probe.logged ? undefined : probe.msg,
    };
    if (probe.logged) {
      const courses = await this.cx.courses();
      if (courses.length) this.snap.chaoxing.courses = courses;
      if (announce) {
        this.emit({
          platform: 'chaoxing',
          kind: 'auth',
          level: 'success',
          title: '学习通已登录',
          detail: `${courses.length} 门课程`,
        });
      }
      void this.persist();
    } else if (announce) {
      this.emit({
        platform: 'chaoxing',
        kind: 'auth',
        level: 'warn',
        title: '学习通未登录',
        detail: '可用账号密码登录，或打开登录窗口扫码',
      });
    }
    return probe.logged;
  }

  async loginChaoxing(phone: string, password: string): Promise<{ ok: boolean; msg: string }> {
    this.setBusy('cxLogin', true);
    try {
      const res = await this.cx.login(phone, password);
      if (res.ok) {
        this.emit({ platform: 'chaoxing', kind: 'auth', level: 'success', title: '学习通登录成功' });
        await this.probeChaoxing();
        await this.refreshChaoxing();
      } else {
        this.emit({ platform: 'chaoxing', kind: 'auth', level: 'error', title: '学习通登录失败', detail: res.msg });
      }
      return res;
    } finally {
      this.setBusy('cxLogin', false);
    }
  }

  async logoutYuketang(): Promise<void> {
    this.yt.bearer = '';
    this.snap.yuketang.auth = { logged: false, error: '已退出' };
    this.snap.yuketang.courses = [];
    this.snap.yuketang.onLesson = [];
    this.snap.yuketang.lesson = null;
    this.sock?.close();
    this.sock = null;
    await this.persist();
    this.emit({ platform: 'yuketang', kind: 'auth', level: 'info', title: '已清除雨课堂会话（Bearer）', detail: '如需彻底退出，请在登录窗口里退出账号' });
    this.pushSoon();
  }

  async logoutChaoxing(): Promise<void> {
    await this.cx.logout();
    this.snap.chaoxing.auth = { logged: false, error: '已退出' };
    this.snap.chaoxing.courses = [];
    this.snap.chaoxing.actives = [];
    this.emit({ platform: 'chaoxing', kind: 'auth', level: 'info', title: '已退出学习通' });
    this.pushSoon();
  }

  /* ---------------------------------------------------------------- 监控 */

  startMonitors(): void {
    this.scheduleYt();
    this.scheduleCx();
    this.snap.yuketang.monitor.running = true;
    this.snap.chaoxing.monitor.running = true;
    log.info('engine', `监控启动：雨课堂 ${this.snap.settings.yuketang.pollIntervalSec}s / 学习通 ${this.snap.settings.chaoxing.pollIntervalSec}s`);
  }

  stopMonitors(): void {
    if (this.ytTimer) clearTimeout(this.ytTimer);
    if (this.cxTimer) clearTimeout(this.cxTimer);
    this.ytTimer = null;
    this.cxTimer = null;
    this.snap.yuketang.monitor.running = false;
    this.snap.chaoxing.monitor.running = false;
    this.pushSoon();
  }

  restartMonitors(): void {
    this.stopMonitors();
    if (!this.stopped) this.startMonitors();
  }

  toggleMonitors(running: boolean): void {
    if (running) this.startMonitors();
    else this.stopMonitors();
  }

  private scheduleYt(): void {
    if (this.ytTimer) clearTimeout(this.ytTimer);
    const interval = Math.max(15, this.snap.settings.yuketang.pollIntervalSec) * 1000;
    this.ytTimer = setTimeout(() => {
      void this.pollYuketang().finally(() => {
        if (!this.stopped) this.scheduleYt();
      });
    }, interval);
  }

  private scheduleCx(): void {
    if (this.cxTimer) clearTimeout(this.cxTimer);
    const interval = Math.max(15, this.snap.settings.chaoxing.pollIntervalSec) * 1000;
    this.cxTimer = setTimeout(() => {
      void this.pollChaoxing().finally(() => {
        if (!this.stopped) this.scheduleCx();
      });
    }, interval);
  }

  private async pollYuketang(): Promise<void> {
    const m = this.snap.yuketang.monitor;
    m.pollCount += 1;
    try {
      if (!this.snap.yuketang.auth.logged) {
        // 未登录时每 10 轮才探测一次，避免每 20s 都打一次 401 把日志刷满
        if (m.pollCount % 10 === 1) await this.probeYuketang();
        if (!this.snap.yuketang.auth.logged) {
          m.lastPollAt = Date.now();
          m.lastPollOk = false;
          m.lastError = '未登录';
          this.pushSoon();
          return;
        }
      }
      const items = await this.yt.onLesson();
      m.lastPollAt = Date.now();
      m.lastPollOk = true;
      m.lastError = undefined;
      m.signature = `onLesson:${items.length}`;
      this.snap.yuketang.onLesson = items;
      this.snap.yuketang.auth.checkedAt = Date.now();

      for (const item of items) {
        if (this.seenLessons.has(item.lessonId)) continue;
        this.seenLessons.add(item.lessonId);
        this.emit({
          platform: 'yuketang',
          kind: 'lesson',
          level: 'success',
          title: `开课：${item.courseName}`,
          detail: `${item.classroomName ?? ''} · lesson ${item.lessonId} · role ${item.role}`,
          data: { lessonId: item.lessonId, classroomId: item.classroomId },
        });
        this.throttledNotify(
          `yt-lesson-${item.lessonId}`,
          '雨课堂开课',
          `${item.courseName} 正在上课，点此进入课堂`,
        );
        if (this.snap.settings.yuketang.autoEnterClass) {
          void this.enterLesson(item.lessonId, item.classroomId, item.courseName);
        }
      }
      if (!items.length) this.seenLessons.clear();
    } catch (err) {
      m.lastError = String(err);
      m.lastPollOk = false;
      m.lastPollAt = Date.now();
    }
    this.pushSoon();
  }

  private async pollChaoxing(): Promise<void> {
    const m = this.snap.chaoxing.monitor;
    m.pollCount += 1;
    try {
      if (!this.snap.chaoxing.auth.logged) {
        const ok = m.pollCount % 10 === 1 ? await this.probeChaoxing() : false;
        if (!ok) {
          m.lastPollAt = Date.now();
          m.lastPollOk = false;
          m.lastError = '未登录';
          this.pushSoon();
          return;
        }
      }
      const courses = this.snap.chaoxing.courses.slice(0, Math.max(1, this.snap.settings.chaoxing.courseScanLimit));
      const actives: ChaoxingActive[] = [];
      for (const course of courses) {
        const list = await this.cx.activeList(course).catch(() => []);
        actives.push(...list);
        // 抖动：避免固定节奏被风控标记
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
      }
      this.snap.chaoxing.actives = actives;
      m.lastPollAt = Date.now();
      m.lastPollOk = true;
      m.lastError = undefined;
      m.signature = `actives:${actives.length}`;

      for (const active of actives) {
        if (!isSignActive(active)) continue;
        const key = `${active.id}`;
        if (this.seenActives.has(key)) continue;
        this.seenActives.add(key);
        this.emit({
          platform: 'chaoxing',
          kind: 'sign',
          level: 'warn',
          title: `签到进行中：${active.courseName}`,
          detail: active.title,
          data: { activeId: active.id, activeType: active.activeType },
        });
        if (this.snap.settings.chaoxing.notifyOnNewActive) {
          this.throttledNotify(`cx-active-${active.id}`, '学习通签到', `${active.courseName}：${active.title}`);
        }
        if (this.snap.settings.chaoxing.autoSign) {
          void this.signActive(active.id, true);
        }
      }
      // 清理已结束的 active 记录，保证同一天多次签到能再次触发
      if (!actives.some(isSignActive)) this.seenActives.clear();
    } catch (err) {
      m.lastError = String(err);
      m.lastPollOk = false;
      m.lastPollAt = Date.now();
    }
    this.pushSoon();
  }

  /* ---------------------------------------------------------------- 雨课堂动作 */

  async refreshYuketang(): Promise<void> {
    this.setBusy('ytRefresh', true);
    try {
      await this.probeYuketang();
      const items = await this.yt.onLesson();
      this.snap.yuketang.onLesson = items;
      if (this.snap.settings.yuketang.homeworkWatch) await this.loadYuketangHomework();
      this.emit({
        platform: 'yuketang',
        kind: 'network',
        level: 'success',
        title: '雨课堂数据已刷新',
        detail: `${this.snap.yuketang.courses.length} 门课 · ${items.length} 个在课`,
      });
    } finally {
      this.setBusy('ytRefresh', false);
    }
  }

  private async loadYuketangHomework(): Promise<void> {
    const leaves = this.snap.yuketang.courses
      .map((c) => c.extra?.leafId)
      .filter((v): v is string => Boolean(v));
    if (!leaves.length) {
      this.snap.health.yuketang.notes = ['作业列表需要课程的 leafId，当前接口未返回，已跳过'];
      return;
    }
    const all: HomeworkItem[] = [];
    for (const leaf of leaves.slice(0, 8)) {
      all.push(...(await this.yt.exerciseList(leaf).catch(() => [])));
      await new Promise((r) => setTimeout(r, 300));
    }
    this.snap.yuketang.homework = all;
    void this.persist();
  }

  /** 进课堂：checkin 换 lessonToken，再按需建 WS / 开页面 */
  async enterLesson(lessonId: string, classroomId: string, courseName?: string): Promise<void> {
    const cfg = this.snap.settings.yuketang;
    this.setBusy('enterLesson', true);
    try {
      const res = await this.yt.checkin(lessonId, classroomId, cfg.checkinSource);
      if (!res.ok) {
        this.emit({
          platform: 'yuketang',
          kind: 'sign',
          level: 'error',
          title: '进入课堂/签到失败',
          detail: res.msg,
          data: { lessonId },
        });
        return;
      }
      const lesson: LessonSession = {
        lessonId,
        classroomId,
        lessonToken: res.lessonToken,
        identityId: res.identityId,
        courseName,
        startedAt: Date.now(),
        wsState: 'idle',
        problems: [],
      };
      this.snap.yuketang.lesson = lesson;
      this.emit({
        platform: 'yuketang',
        kind: 'sign',
        level: 'success',
        title: '已进入课堂（出勤已记录）',
        detail: `lesson ${lessonId} · source=${cfg.checkinSource}`,
        data: { lessonId, token: Boolean(res.lessonToken) },
      });
      void this.persist();

      if (res.lessonToken && res.identityId) {
        this.openSocket(lessonId, res.lessonToken, res.identityId);
      }
      if (cfg.checkinMode === 'page' || cfg.checkinMode === 'both') {
        await this.openLessonWindow(lessonId);
      }
    } finally {
      this.setBusy('enterLesson', false);
    }
  }

  private openSocket(lessonId: string, token: string, identityId: string): void {
    this.sock?.close();
    this.yt.userId = this.yt.userId || identityId;
    const sock = new YtLessonSocket({
      host: this.snap.settings.yuketang.host,
      lessonId,
      userId: identityId,
      lessonToken: token,
      handlers: {
        onState: (state, detail) => {
          if (this.snap.yuketang.lesson) {
            this.snap.yuketang.lesson.wsState = state;
            this.snap.yuketang.lesson.lastEventAt = Date.now();
          }
          if (state === 'error' || state === 'closed') {
            log.debug('engine', `WS ${state} ${detail ?? ''}`);
          }
          this.pushSoon();
        },
        onEvent: (evt) => {
          if (evt.kind === 'protocol' && evt.op) this.noteUnknownOp(evt.op);
          this.emit({
            platform: 'yuketang',
            kind: evt.kind ?? 'lesson',
            level: evt.level ?? 'info',
            title: evt.title,
            detail: evt.detail,
            data: evt.data,
          });
        },
        onProblem: (p) => void this.onProblemUnlocked(p.presentationId, p.problemId, p.limitSec, p.slideIndex),
        onPresentation: (presId) => void this.loadPresentation(presId),
      },
    });
    this.sock = sock;
    void sock.connect();
  }

  private async loadPresentation(presentationId: string): Promise<void> {
    const { problems } = await this.yt.presentation(presentationId);
    if (!problems.length) return;
    const lesson = this.snap.yuketang.lesson;
    if (!lesson) return;
    const map = new Map(lesson.problems.map((p) => [p.problemId, p]));
    for (const p of problems) {
      const existing = map.get(p.problemId);
      map.set(p.problemId, existing ? { ...existing, ...p, submitState: existing.submitState } : p);
    }
    lesson.problems = Array.from(map.values()).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
    this.emit({
      platform: 'yuketang',
      kind: 'problem',
      level: 'info',
      title: `已载入课件 ${presentationId}`,
      detail: `${problems.length} 道题`,
    });
  }

  private async onProblemUnlocked(
    presentationId: string,
    problemId: string,
    limitSec: number,
    slideIndex: number,
  ): Promise<void> {
    const lesson = this.snap.yuketang.lesson;
    if (!lesson) return;
    let problem = lesson.problems.find((p) => p.problemId === problemId);
    if (!problem) {
      // 未知题目：先刷课件，再单独查详情
      if (presentationId) await this.loadPresentation(presentationId);
      problem = lesson.problems.find((p) => p.problemId === problemId);
    }
    if (!problem) {
      const detail = await this.yt.problemDetail(problemId).catch(() => null);
      if (detail) {
        problem = detail;
        lesson.problems.push(detail);
      }
    }
    if (!problem) {
      this.emit({
        platform: 'yuketang',
        kind: 'problem',
        level: 'warn',
        title: '新题解锁但题干未知',
        detail: `problemId=${problemId}（课件与详情接口都没返回题干）`,
        data: { problemId },
      });
      return;
    }
    problem.limitSec = limitSec;
    problem.unlockedAt = Date.now();
    problem.deadlineAt = limitSec > 0 ? Date.now() + limitSec * 1000 : undefined;
    problem.slideIndex = slideIndex || problem.slideIndex;
    this.pushSoon();

    const policy = this.snap.settings.yuketang.answerPolicy;
    if (policy === 'off' || !this.snap.settings.ai.enabled || !this.aiKey) return;
    if (problem.problemType === 5) {
      void this.generateAnalysis(problem.problemId);
      return;
    }
    const res = await this.generateAnswer(problem.problemId);
    if (!res.ok) return;
    if (policy === 'auto') {
      await this.submitAnswer(problem.problemId, res.result);
    } else {
      problem.submitState = 'confirm';
      problem.answer = res.result;
      problem.submitMessage = '等待确认后提交';
      this.pushSoon();
    }
  }

  async openLessonWindow(lessonId: string): Promise<void> {
    const { host, checkinSource } = this.snap.settings.yuketang;
    this.emit({
      platform: 'yuketang',
      kind: 'lesson',
      level: 'info',
      title: '打开课堂页面',
      detail: yt.lessonPage(host, lessonId, checkinSource),
    });
    await this.requestBrowserWindow(yt.lessonPage(host, lessonId, checkinSource), '雨课堂 · 课堂');
  }

  /** 由 ipc 层注入：开一个带登录态的浏览器窗口 */
  browserWindowOpener: ((url: string, title: string) => Promise<void>) | null = null;

  private async requestBrowserWindow(url: string, title: string): Promise<void> {
    if (this.browserWindowOpener) await this.browserWindowOpener(url, title);
  }

  /* ---------------------------------------------------------------- 答题 */

  async generateAnswer(problemId: string): Promise<{ ok: boolean; result?: unknown; message: string }> {
    const lesson = this.snap.yuketang.lesson;
    const problem = lesson?.problems.find((p) => p.problemId === problemId);
    if (!problem) return { ok: false, message: '题目不存在' };
    if (!this.aiKey) return { ok: false, message: '未配置 AI Key' };

    problem.submitState = 'confirm';
    problem.submitMessage = 'AI 生成中…';
    this.pushSoon();

    const prompt = buildPrompt(problem);
    const reply = await callAi(this.snap.settings.ai, this.aiKey, prompt);
    if (!reply.ok) {
      problem.submitState = 'failed';
      problem.submitMessage = reply.error ?? 'AI 调用失败';
      this.emit({
        platform: 'yuketang',
        kind: 'answer',
        level: 'error',
        title: 'AI 作答失败',
        detail: reply.error,
        data: { problemId },
      });
      return { ok: false, message: reply.error ?? 'AI 调用失败' };
    }
    const arr = parseAnswerArray(reply.text);
    const result = buildResult(problem.problemType, arr, arr);
    problem.answer = result;
    problem.submitMessage = `AI 建议（${reply.latencyMs}ms）：${JSON.stringify(result)}`;
    this.emit({
      platform: 'yuketang',
      kind: 'answer',
      level: 'info',
      title: 'AI 已给出建议答案',
      detail: `problem ${problemId} → ${JSON.stringify(result)}`,
      data: { problemId, raw: reply.text.slice(0, 500) },
    });
    return { ok: true, result, message: problem.submitMessage };
  }

  async generateAnalysis(problemId: string): Promise<void> {
    const lesson = this.snap.yuketang.lesson;
    const problem = lesson?.problems.find((p) => p.problemId === problemId);
    if (!problem || !this.aiKey) return;
    problem.submitMessage = '生成解析中…';
    this.pushSoon();
    const prompt = buildPrompt(problem);
    const reply = await callAi(this.snap.settings.ai, this.aiKey, prompt);
    problem.aiAnalysis = reply.ok ? reply.text : `生成失败：${reply.error}`;
    problem.submitState = 'skipped';
    problem.submitMessage = '主观题不自动提交，解析供手写参考';
    this.emit({
      platform: 'yuketang',
      kind: 'answer',
      level: reply.ok ? 'success' : 'warn',
      title: '主观题解析已生成',
      detail: `${problemId}（不会自动提交）`,
      data: { problemId },
    });
  }

  async submitAnswer(problemId: string, result?: unknown): Promise<{ ok: boolean; msg: string }> {
    const lesson = this.snap.yuketang.lesson;
    const problem = lesson?.problems.find((p) => p.problemId === problemId);
    if (!problem) return { ok: false, msg: '题目不存在' };
    if (problem.problemType === 5) {
      return { ok: false, msg: '主观题不自动提交（需手写拍照）' };
    }
    const payload = result ?? problem.answer;
    if (!payload) return { ok: false, msg: '没有可提交的答案' };
    const res = await this.yt.answer(problemId, problem.problemType, payload);
    problem.submittedAt = Date.now();
    problem.submitState = res.ok ? 'submitted' : 'failed';
    problem.submitMessage = res.ok ? '已提交' : res.msg;
    this.emit({
      platform: 'yuketang',
      kind: 'answer',
      level: res.ok ? 'success' : 'error',
      title: res.ok ? '答案已提交' : '答案提交被拒',
      detail: `${problemId} → ${JSON.stringify(payload)}${res.ok ? '' : ` · ${res.msg}`}`,
      data: { problemId },
    });
    this.pushSoon();
    return { ok: res.ok, msg: res.msg };
  }

  /** 视频进度心跳（本地测试用）：按真实播放器的字段形状上报 */
  async pushVideoProgress(presentationId: string): Promise<{ ok: boolean; detail: string }> {
    const host = this.snap.settings.yuketang.host;
    const { videos } = await this.yt.presentation(presentationId);
    if (!videos.length) return { ok: false, detail: '该课件没有可上报的视频' };
    const userId = this.yt.userId;
    if (!userId) return { ok: false, detail: '缺少 user_id（先进一次课堂）' };
    const events = buildHeartbeatEvents(videos, userId);
    const res = await this.yt.videoHeartbeat(events);
    this.snap.yuketang.videoReported[presentationId] = events.length;
    this.emit({
      platform: 'yuketang',
      kind: 'video',
      level: res.ok ? 'success' : 'warn',
      title: res.ok ? '视频进度已上报' : '视频进度上报失败',
      detail: `${events.length} 条心跳 · ${presentationId} · host=${host}`,
      data: { presentationId },
    });
    this.pushSoon();
    return { ok: res.ok, detail: res.ok ? `${events.length} 条` : res.msg };
  }

  /* ---------------------------------------------------------------- 接口变更检测 */

  private scheduleDrift(delayMs?: number): void {
    this.stopDrift();
    if (!this.snap.settings.drift.enabled) {
      this.snap.drift.nextCheckAt = undefined;
      return;
    }
    const hours = Math.max(0.25, this.snap.settings.drift.intervalHours);
    const delay = delayMs ?? hours * 3600_000;
    this.snap.drift.nextCheckAt = Date.now() + delay;
    this.driftTimer = setTimeout(() => {
      void this.runDrift(false);
    }, delay);
    this.pushSoon();
  }

  private stopDrift(): void {
    if (this.driftTimer) clearTimeout(this.driftTimer);
    this.driftTimer = null;
  }

  /** 未识别 WS op 也计入变更信号 */
  private noteUnknownOp(op: string): void {
    const key = op || '(empty)';
    const next = { ...this.snap.drift.unknownOps, [key]: (this.snap.drift.unknownOps[key] ?? 0) + 1 };
    this.snap.drift.unknownOps = next;
    this.pushSoon();
  }

  /**
   * 跑一次结构检测。
   * 首次探测只建立基线（不告警）；之后指纹变化 → 事件 + 系统通知 + drift.hasDrift。
   */
  async runDrift(manual = false): Promise<{ ok: boolean; changed: number; checked: number }> {
    if (this.snap.drift.running) return { ok: false, changed: 0, checked: 0 };
    this.snap.drift.running = true;
    this.pushSoon();
    try {
      const probes: DriftProbe[] = buildProbes({
        ytHost: this.snap.settings.yuketang.host,
        ytHeaders: () => {
          const h: Record<string, string> = {
            'university-id': this.yt.universityId,
            'uv-id': this.yt.uvId,
            'X-Client': 'web',
            'Xt-Agent': 'web',
          };
          if (this.yt.bearer) h.Authorization = `Bearer ${this.yt.bearer}`;
          return h;
        },
        cxHeaders: () => ({
          'X-Requested-With': 'com.chaoxing.mobile',
          accept: 'application/json, text/plain, */*',
        }),
        ytCourses: this.snap.yuketang.courses,
        cxCourses: this.snap.chaoxing.courses,
        presentationId: this.snap.yuketang.lesson?.lessonToken ? undefined : undefined,
        activeId: this.snap.chaoxing.actives[0]?.id,
      });

      const store = this.store.get();
      const baselines = { ...(store.cache.driftBaselines ?? {}) };
      let baselineDirty = false;

      const results = await runDriftCheck(probes, {
        baselines,
        onResult: (result, paths) => {
          this.driftPaths.set(result.probeId, paths);
          if (!baselines[result.probeId] && result.ok) {
            baselines[result.probeId] = { hash: result.hash, paths, at: Date.now() };
            baselineDirty = true;
          }
        },
      });

      if (baselineDirty) {
        this.store.update((d) => {
          d.cache = { ...d.cache, driftBaselines: baselines };
        });
        void this.persist();
      }

      this.snap.drift.results = results;
      this.snap.drift.lastCheckAt = Date.now();
      this.snap.drift.enabled = this.snap.settings.drift.enabled;
      const changed = results.filter((r) => r.changed);
      const firstRun = results.every((r) => !r.baselineHash);
      this.snap.drift.hasDrift = changed.length > 0;

      if (changed.length > 0) {
        const detail = changed
          .map((r) => `${r.label}：+${r.added.length} / -${r.removed.length}`)
          .join('；');
        this.emit({
          platform: changed[0].platform,
          kind: 'protocol',
          level: 'warn',
          title: `接口结构变化：${changed.length} 项`,
          detail,
          data: { probes: changed.map((r) => r.probeId) },
        });
        if (this.snap.settings.drift.notify) {
          this.throttledNotify(
            'drift',
            '平台接口可能已更新',
            `${changed.map((r) => r.label).join('、')} 的结构与基线不一致，点开「协议检测」查看`,
            30 * 60_000,
          );
        }
      } else if (manual) {
        this.emit({
          platform: 'yuketang',
          kind: 'protocol',
          level: 'success',
          title: firstRun ? '已建立接口结构基线' : '接口结构未发现变化',
          detail: results.map((r) => `${r.label}(${r.pathCount})`).join(' · '),
        });
      }
      return { ok: true, changed: changed.length, checked: results.length };
    } finally {
      this.snap.drift.running = false;
      this.scheduleDrift();
      this.pushSoon();
    }
  }

  /** 用户确认结构变化：把当前指纹写回基线 */
  acceptDrift(probeId?: string): { ok: boolean; updated: number } {
    const store = this.store.get();
    const baselines = { ...(store.cache.driftBaselines ?? {}) };
    let updated = 0;
    for (const result of this.snap.drift.results) {
      if (probeId && result.probeId !== probeId) continue;
      const paths = this.driftPaths.get(result.probeId);
      if (!paths?.length) continue;
      baselines[result.probeId] = { hash: result.hash, paths, at: Date.now() };
      updated += 1;
    }
    if (updated) {
      this.store.update((d) => {
        d.cache = { ...d.cache, driftBaselines: baselines };
      });
      void this.persist();
      this.snap.drift.results = this.snap.drift.results.map((r) =>
        probeId && r.probeId !== probeId ? r : { ...r, changed: false, added: [], removed: [], baselineHash: r.hash, baselineAt: Date.now() },
      );
      this.snap.drift.hasDrift = this.snap.drift.results.some((r) => r.changed);
      this.emit({
        platform: 'yuketang',
        kind: 'protocol',
        level: 'info',
        title: `已接受新的接口基线（${updated} 项）`,
        detail: probeId ? probeId : '全部探测项',
      });
      this.pushSoon();
    }
    return { ok: updated > 0, updated };
  }

  /* ---------------------------------------------------------------- 学习通动作 */

  async refreshChaoxing(): Promise<void> {
    this.setBusy('cxRefresh', true);
    try {
      await this.probeChaoxing();
      await this.pollChaoxing();
      if (this.snap.settings.chaoxing.courseScanLimit > 0) await this.loadChaoxingHomework();
      this.emit({
        platform: 'chaoxing',
        kind: 'network',
        level: 'success',
        title: '学习通数据已刷新',
        detail: `${this.snap.chaoxing.courses.length} 门课 · ${this.snap.chaoxing.actives.length} 个活动`,
      });
    } finally {
      this.setBusy('cxRefresh', false);
    }
  }

  private async loadChaoxingHomework(): Promise<void> {
    const courses = this.snap.chaoxing.courses.slice(0, 5);
    const all: HomeworkItem[] = [];
    for (const c of courses) {
      all.push(...(await this.cx.workList(c).catch(() => [])));
      await new Promise((r) => setTimeout(r, 200));
    }
    this.snap.chaoxing.homework = all;
    void this.persist();
  }

  async signActive(activeId: string, automatic = false): Promise<SignRecord | null> {
    const active = this.snap.chaoxing.actives.find((a) => a.id === activeId);
    if (!active) return null;
    const cfg = this.snap.settings.chaoxing;
    const method = await this.cx.resolveMethod(active).catch(() => 'unknown' as const);
    const allowed =
      (method === 'normal' && cfg.signTypes.normal) ||
      (method === 'location' && cfg.signTypes.location) ||
      (method === 'gesture' && cfg.signTypes.gesture) ||
      (method === 'code' && cfg.signTypes.code);
    if (!allowed) {
      this.emit({
        platform: 'chaoxing',
        kind: 'sign',
        level: 'warn',
        title: `签到转人工：${active.title}`,
        detail: `方式 ${method} 未在允许清单内，或需要二维码/拍照`,
        data: { activeId },
      });
      return null;
    }
    this.setBusy(`sign:${activeId}`, true);
    try {
      const rec = await this.cx.sign(active, cfg, '');
      rec.method = method;
      this.snap.chaoxing.signs = [rec, ...this.snap.chaoxing.signs].slice(0, 200);
      this.emit({
        platform: 'chaoxing',
        kind: 'sign',
        level: rec.ok ? 'success' : 'error',
        title: rec.ok ? `签到成功：${active.courseName}` : `签到失败：${active.courseName}`,
        detail: `${rec.title} · ${method} · ${rec.detail}${automatic ? '（自动）' : ''}`,
        data: { activeId, method },
      });
      if (rec.ok) {
        this.throttledNotify(`cx-sign-${active.id}`, '学习通签到成功', `${active.courseName}：${active.title}`);
      }
      void this.persist();
      return rec;
    } finally {
      this.setBusy(`sign:${activeId}`, false);
    }
  }

  /** 学习通课程页（内嵌窗口） */
  openChaoxingCourse(courseId: string, classId: string): Promise<void> {
    const url = `https://mooc1.chaoxing.com/visit/interaction?courseId=${courseId}&clazzid=${classId}`;
    return this.requestBrowserWindow(url, '学习通 · 课程');
  }

  openYuketangHome(): Promise<void> {
    return this.requestBrowserWindow(yt.home(this.snap.settings.yuketang.host), '雨课堂 · 首页');
  }

  getCourseName(id: string): string {
    return this.snap.yuketang.courses.find((c) => c.id === id)?.name ?? '';
  }
}

/* ------------------------------------------------------------------ */
/* 纯函数                                                              */
/* ------------------------------------------------------------------ */

/**
 * 历史事件去重：同一 (platform, kind, title, detail) 在 3 分钟内只保留最新一条。
 * 目的是避免"每次启动都记一条未登录"把事件流刷成噪声。
 */
export function summarizeProblemForUi(p: Problem): string {
  return `${p.problemId} (${p.problemType}) ${str(p.body).slice(0, 60)}`;
}

export type { Course, OnLesson };

export { buildHeartbeatEvents, dedupeEvents, deepMerge } from './pure';
