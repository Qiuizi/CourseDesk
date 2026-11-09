/**
 * 双平台统一数据模型。
 * 字段命名对齐两家原始响应，尽量保留 raw 便于排错。
 */

export type PlatformId = 'yuketang' | 'chaoxing';

export type EventLevel = 'info' | 'success' | 'warn' | 'error';

export type EventKind =
  | 'system'
  | 'auth'
  | 'lesson'
  | 'problem'
  | 'answer'
  | 'sign'
  | 'homework'
  | 'video'
  | 'protocol'
  | 'network';

export interface ClassEvent {
  id: string;
  platform: PlatformId;
  kind: EventKind;
  level: EventLevel;
  title: string;
  detail?: string;
  at: number;
  /** 附加结构化载荷（题目、签到结果、漂移告警等） */
  data?: Record<string, unknown>;
}

export interface Course {
  platform: PlatformId;
  /** 雨课堂 courseId / 学习通 courseId */
  id: string;
  /** 雨课堂 classroomId / 学习通 classId */
  classId?: string;
  name: string;
  teacher?: string;
  /** 学习通 cpi，作业列表需要 */
  extra?: Record<string, string>;
}

export interface OnLesson {
  lessonId: string;
  classroomId: string;
  courseId?: string;
  courseName: string;
  classroomName?: string;
  /** 1=教师 5=学生 6=旁听 */
  role: number;
  detectedAt: number;
}

/* ------------------------------------------------------------------ */
/* 雨课堂随堂题                                                         */
/* ------------------------------------------------------------------ */

export type ProblemType = 1 | 2 | 3 | 4 | 5 | 6;

export interface ProblemOption {
  key: string;
  value: string;
}

export interface Problem {
  problemId: string;
  problemType: ProblemType;
  body: string;
  options: ProblemOption[];
  /** 填空题目：第几空 */
  blankCount: number;
  slideIndex?: number;
  /** 限时秒数，-1 = 不限时 */
  limitSec?: number;
  unlockedAt?: number;
  deadlineAt?: number;
  /** 已提交答案（本地记录） */
  answer?: unknown;
  submittedAt?: number;
  submitState?: 'pending' | 'confirm' | 'submitted' | 'failed' | 'skipped';
  submitMessage?: string;
  /** AI 生成的解析（主观题只给解析不提交） */
  aiAnalysis?: string;
}

export interface LessonSession {
  lessonId: string;
  classroomId: string;
  lessonToken?: string;
  identityId?: string;
  courseName?: string;
  startedAt: number;
  wsState: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  problems: Problem[];
  lastEventAt?: number;
}

/* ------------------------------------------------------------------ */
/* 学习通                                                              */
/* ------------------------------------------------------------------ */

export type SignMethod = 'normal' | 'location' | 'gesture' | 'code' | 'qr' | 'photo' | 'unknown';

export interface ChaoxingActive {
  id: string;
  courseId: string;
  classId: string;
  courseName: string;
  title: string;
  activeType: number;
  status: number;
  /** 1 = 进行中 */
  ongoing: boolean;
  startedAt?: number;
  method: SignMethod;
}

export interface SignRecord {
  id: string;
  activeId: string;
  courseName: string;
  title: string;
  method: SignMethod;
  ok: boolean;
  detail: string;
  at: number;
}

/* ------------------------------------------------------------------ */
/* 作业                                                                */
/* ------------------------------------------------------------------ */

export interface HomeworkItem {
  platform: PlatformId;
  id: string;
  courseName: string;
  title: string;
  statusText: string;
  /** 剩余时间原始文本 */
  leftText?: string;
  /** 解析出的剩余小时数，null = 未知 */
  leftHours?: number | null;
  url?: string;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

export type AnswerPolicy = 'off' | 'confirm' | 'auto';
export type CheckinMode = 'page' | 'api' | 'both';

/** 刷课（视频进度）节奏设置 */
export interface VideoSettings {
  /** 倍速：上报速度按这个倍数折算成媒体时间 */
  speed: number;
  /** 每批上报间隔（秒，真实时间） */
  tickSec: number;
  /** 收到课件/进入课堂时自动加入队列并开刷 */
  autoStart: boolean;
}

export interface YuketangSettings {
  /** 学校域名，如 www.yuketang.cn / pro.yuketang.cn / 学校自建子域 */
  host: string;
  pollIntervalSec: number;
  notifyOnLesson: boolean;
  /** 检测到开课自动打开课堂页（网页端点名的出勤凭证） */
  autoEnterClass: boolean;
  /** 进入课堂的 source 指纹：5=网页端"正在上课"，25=上课提醒，21=APP扫码 */
  checkinSource: number;
  checkinMode: CheckinMode;
  answerPolicy: AnswerPolicy;
  /** 视频进度心跳上报（本地测试用，默认关） */
  videoHeartbeat: boolean;
  /** 刷课节奏 */
  video: VideoSettings;
  homeworkWatch: boolean;
}

export interface ChaoxingSettings {
  pollIntervalSec: number;
  autoSign: boolean;
  notifyOnNewActive: boolean;
  location: { latitude: string; longitude: string; address: string };
  /** 允许自动完成的签到类型 */
  signTypes: { normal: boolean; location: boolean; gesture: boolean; code: boolean };
  /** 活动列表里同时扫描多少门课（学习通课程多，限制并发） */
  courseScanLimit: number;
}

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** API Key 存于加密存储，不回传渲染进程 */
  hasKey?: boolean;
  temperature: number;
  timeoutSec: number;
}

/* ------------------------------------------------------------------ */
/* 接口变更检测（refresh / drift）                                      */
/* ------------------------------------------------------------------ */

export interface DriftProbeResult {
  probeId: string;
  platform: PlatformId;
  label: string;
  ok: boolean;
  status: number;
  /** 结构路径集合的指纹 */
  hash: string;
  /** 路径数量（规模突变也是信号） */
  pathCount: number;
  checkedAt: number;
  baselineHash?: string;
  baselineAt?: number;
  /** 相对基线新增的字段路径 */
  added: string[];
  /** 相对基线消失的字段路径 */
  removed: string[];
  changed: boolean;
  /** 跳过/失败原因 */
  note?: string;
}

export interface DriftState {
  enabled: boolean;
  intervalHours: number;
  running: boolean;
  lastCheckAt?: number;
  nextCheckAt?: number;
  /** 最近一次检测的所有探测项 */
  results: DriftProbeResult[];
  /** 未识别的 WS op 计数（op → 次数） */
  unknownOps: Record<string, number>;
  /** 是否有未确认的结构变化 */
  hasDrift: boolean;
}

/** 自动更新状态（主进程 → 渲染进程） */
export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error' | 'unsupported';
  /** 远端版本号 */
  version?: string;
  /** 下载进度 0-100 */
  percent?: number;
  message?: string;
  checkedAt?: number;
}

export interface BehaviorSettings {
  /** 点关闭时缩到托盘继续跑（而不是退出） */
  closeToTray: boolean;
  /** 开机自启 */
  launchAtLogin: boolean;
  /** 窗口在后台时也弹系统通知 */
  notifyWhenHidden: boolean;
}

export interface Settings {
  yuketang: YuketangSettings;
  chaoxing: ChaoxingSettings;
  ai: AiSettings;
  notify: { system: boolean; sound: boolean };
  /** simple = 普通模式（简洁浅色），dev = 开发者模式（控制室深色） */
  ui: { accent: 'lime' | 'amber' | 'cyan'; density: 'comfortable' | 'compact'; mode: 'simple' | 'dev' };
  /** 接口变更检测 */
  drift: { enabled: boolean; intervalHours: number; notify: boolean };
  /** 关闭 / 自启 / 后台通知 */
  behavior: BehaviorSettings;
  startMinimized: boolean;
}

/* ------------------------------------------------------------------ */
/* 运行时快照（主进程 → 渲染进程）                                      */
/* ------------------------------------------------------------------ */

export interface MonitorState {
  running: boolean;
  lastPollAt?: number;
  lastPollOk?: boolean;
  lastError?: string;
  pollCount: number;
  /** 接口结构签名，用于平台改版漂移检测 */
  signature?: string;
}

export interface AuthState {
  logged: boolean;
  userName?: string;
  userId?: string;
  checkedAt?: number;
  error?: string;
}

export type VideoFarmStatus = 'idle' | 'collecting' | 'running' | 'paused' | 'done' | 'error';

export interface VideoFarmItem {
  presentationId: string;
  videoId: string;
  name: string;
  /** 媒体时长（秒） */
  duration: number;
  /** 已上报到的媒体位置（秒） */
  position: number;
  /** 0-100 */
  percent: number;
  seq: number;
  done: boolean;
  skipped: boolean;
  attempts: number;
  sentTicks: number;
  lastError?: string;
  updatedAt: number;
}

/** 刷课队列的运行时状态 */
export interface VideoFarmState {
  status: VideoFarmStatus;
  /** 本次运行使用的倍速（设置里改了也会同步） */
  speed: number;
  tickSec: number;
  items: VideoFarmItem[];
  currentIndex: number;
  startedAt?: number;
  updatedAt?: number;
  lastError?: string;
  lastReply?: string;
  /** 这一轮是否由自动开课/课件事件触发 */
  autoStarted: boolean;
}

export interface YuketangState {
  auth: AuthState;
  courses: Course[];
  onLesson: OnLesson[];
  lesson: LessonSession | null;
  homework: HomeworkItem[];
  monitor: MonitorState;
  /** 刷课队列 */
  videoFarm: VideoFarmState;
}

export interface ChaoxingState {
  auth: AuthState;
  courses: Course[];
  actives: ChaoxingActive[];
  signs: SignRecord[];
  homework: HomeworkItem[];
  monitor: MonitorState;
}

export interface HealthReport {
  ok: boolean;
  checkedAt?: number;
  /** 结构签名漂移说明 */
  drift?: string;
  notes: string[];
}

export interface AppSnapshot {
  version: string;
  startedAt: number;
  settings: Settings;
  yuketang: YuketangState;
  chaoxing: ChaoxingState;
  events: ClassEvent[];
  health: { yuketang: HealthReport; chaoxing: HealthReport };
  drift: DriftState;
  /** 自动更新 */
  update: UpdateState;
  busy: Record<string, boolean>;
}

export interface LogLine {
  at: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  data?: unknown;
}
