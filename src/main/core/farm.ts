/**
 * 刷课队列状态机：把"按真实经过时间推进游标"的循环从 Engine 里拆出来。
 *
 * 与 Engine 的边界只有 FarmHost：读快照、拿 user_id、发心跳、取课件、写事件/通知/持久化。
 * 计时器也可注入，单元测试里可以手动推进，不需要真的等 10 秒。
 */

import { buildHeartbeatBatch, createCursor, parsePresentationIds, resolveDuration, tickDelay } from './videofarm.ts';
import type { AppSnapshot, VideoFarmItem, YuketangSettings } from '@shared/types';

export interface FarmProgress {
  position: number;
  done: boolean;
  at: number;
}

export interface FarmEvent {
  kind: 'video';
  level: 'info' | 'success' | 'warn' | 'error';
  title: string;
  detail?: string;
  quiet?: boolean;
  data?: Record<string, unknown>;
}

export interface FarmTimerHandle {
  cancel(): void;
}

export interface FarmHost {
  /** 引擎快照：队列状态、设置、当前课堂都从这里读 */
  snapshot(): AppSnapshot;
  /** 断点表（`presentationId|videoId`） */
  savedProgress(key: string): FarmProgress | undefined;
  saveProgress(key: string, value: FarmProgress): void;
  userId(): string;
  heartbeat(events: Record<string, unknown>[]): Promise<{ ok: boolean; msg: string }>;
  presentation(id: string): Promise<{ videos: { videoId: string; duration: number; name?: string }[] }>;
  activePresentation(lessonId: string): Promise<string>;
  emit(event: FarmEvent): void;
  notify(key: string, title: string, body: string): void;
  pushSoon(): void;
  persist(): void;
  isStopped(): boolean;
  /** 注入计时器（测试用） */
  setTimer?(fn: () => void, ms: number): FarmTimerHandle;
}

export interface FarmResult {
  ok: boolean;
  detail: string;
  queued: number;
}

/** 单批心跳上限：一批太大既慢又容易被判异常 */
const BATCH_MAX = 40;
/** 连续失败几次后暂停 */
const MAX_ATTEMPTS = 3;

export class VideoFarmRunner {
  private timer: FarmTimerHandle | null = null;
  private lastTick = 0;
  private sessions = new Map<string, string>();
  private tickRunning = false;

  private readonly host: FarmHost;

  constructor(host: FarmHost) {
    this.host = host;
  }

  private get farm() {
    return this.host.snapshot().yuketang.videoFarm;
  }

  private get settings(): YuketangSettings {
    return this.host.snapshot().settings.yuketang;
  }

  private key(presentationId: string, videoId: string): string {
    return `${presentationId}|${videoId}`;
  }

  private setTimer(fn: () => void, ms: number): void {
    this.clearTimer();
    const delay = Math.max(300, ms);
    if (this.host.setTimer) {
      this.timer = this.host.setTimer(fn, delay);
      return;
    }
    const handle = setTimeout(() => {
      this.timer = null;
      fn();
    }, delay);
    this.timer = { cancel: () => clearTimeout(handle) };
  }

  private clearTimer(): void {
    this.timer?.cancel();
    this.timer = null;
  }

  stopTimer(): void {
    this.clearTimer();
  }

  /** 课件里的视频 → 队列项；断点、时长兜底、去重都在这里 */
  buildItems(
    presentationId: string,
    videos: { videoId: string; duration: number; name?: string }[],
  ): VideoFarmItem[] {
    const out: VideoFarmItem[] = [];
    const seen = new Set<string>();
    for (const video of videos) {
      if (!video.videoId || seen.has(video.videoId)) continue;
      seen.add(video.videoId);
      const duration = resolveDuration(video.duration);
      const saved = this.host.savedProgress(this.key(presentationId, video.videoId));
      const position = Math.min(duration, Math.max(0, saved?.position ?? 0));
      const done = Boolean(saved?.done) || position >= duration - 0.05;
      out.push({
        presentationId,
        videoId: video.videoId,
        name: video.name?.trim() || `视频 ${video.videoId.slice(-6)}`,
        duration,
        position,
        percent: done ? 100 : Math.min(99, Math.round((position / Math.max(1, duration)) * 100)),
        seq: 0,
        done,
        skipped: false,
        attempts: 0,
        sentTicks: 0,
        lastError: done ? '已刷完' : undefined,
        updatedAt: Date.now(),
      });
    }
    return out;
  }

  /** 启动被拒时把原因写回状态，界面才看得见 */
  private refuse(detail: string, queued = 0): FarmResult {
    const farm = this.farm;
    farm.lastError = detail;
    farm.updatedAt = Date.now();
    this.host.pushSoon();
    return { ok: false, detail, queued };
  }

  /**
   * 开始/重建队列。接受一个或多个 presentationId（逗号、换行都行）。
   * 留空时用当前课堂正在放的课件。
   */
  async start(raw: string | string[]): Promise<FarmResult> {
    const farm = this.farm;
    if (farm.status === 'collecting' || farm.status === 'running') {
      return this.refuse('刷课已在运行，先暂停或停止', farm.items.length);
    }
    if (!this.settings.videoHeartbeat) {
      return this.refuse('先在设置里打开「允许上报视频进度」');
    }
    if (!this.host.userId()) return this.refuse('缺少 user_id（先进一次课堂）');

    let ids = parsePresentationIds(raw);
    if (!ids.length) {
      const lesson = this.host.snapshot().yuketang.lesson;
      if (lesson) {
        const active = await this.host.activePresentation(lesson.lessonId).catch(() => '');
        if (active) ids = [active];
      }
    }
    if (!ids.length) {
      return this.refuse('没取到课件：填 presentationId，或等老师开始放课件');
    }

    farm.status = 'collecting';
    farm.items = [];
    farm.currentIndex = 0;
    farm.startedAt = Date.now();
    farm.updatedAt = Date.now();
    farm.lastError = undefined;
    farm.lastReply = undefined;
    farm.autoStarted = false;
    farm.speed = this.settings.video.speed;
    farm.tickSec = this.settings.video.tickSec;
    this.sessions.clear();
    this.host.pushSoon();

    const items: VideoFarmItem[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      try {
        const { videos } = await this.host.presentation(id);
        if (!videos.length) {
          skipped.push(`${id}（无视频）`);
          continue;
        }
        items.push(...this.buildItems(id, videos));
      } catch (err) {
        skipped.push(`${id}（${String(err)}）`);
      }
    }

    // 收集期间被停止：不要再把状态改回 running
    if (farm.status !== 'collecting') return { ok: false, detail: '已取消', queued: 0 };

    if (!items.length) {
      farm.status = 'error';
      farm.lastError = skipped.length ? `没有可刷的视频：${skipped.join('、')}` : '没有可刷的视频';
      farm.updatedAt = Date.now();
      this.host.emit({ kind: 'video', level: 'warn', title: '刷课未启动', detail: farm.lastError });
      this.host.persist();
      return { ok: false, detail: farm.lastError, queued: 0 };
    }

    farm.items = items;
    const first = items.findIndex((item) => !item.done);
    if (first < 0) {
      farm.status = 'done';
      farm.currentIndex = items.length;
      farm.updatedAt = Date.now();
      this.host.emit({
        kind: 'video',
        level: 'info',
        title: '这些视频都已刷完',
        detail: `${items.length} 个视频都有断点`,
      });
      this.host.persist();
      return { ok: true, detail: '这些视频都已刷完', queued: 0 };
    }

    farm.currentIndex = first;
    farm.status = 'running';
    this.lastTick = Date.now();
    this.host.emit({
      kind: 'video',
      level: 'info',
      title: '开始刷课',
      detail: `${items.length} 个视频 · ${farm.speed}× · 每 ${farm.tickSec}s 一批${skipped.length ? ` · 跳过 ${skipped.length} 个课件` : ''}`,
    });
    this.host.persist();
    this.setTimer(() => void this.tick(), 600);
    return { ok: true, detail: `已排队 ${items.length} 个视频`, queued: items.length };
  }

  pause(reason = '手动暂停'): { ok: boolean; detail: string } {
    const farm = this.farm;
    if (farm.status !== 'running') return { ok: false, detail: '当前没有在刷课' };
    this.clearTimer();
    farm.status = 'paused';
    farm.lastError = undefined;
    farm.updatedAt = Date.now();
    this.host.emit({
      kind: 'video',
      level: 'info',
      title: '刷课已暂停',
      detail: `${reason} · 断点 ${this.currentItem()?.percent ?? 0}%`,
    });
    this.host.persist();
    return { ok: true, detail: '已暂停（断点保留）' };
  }

  resume(): { ok: boolean; detail: string } {
    const farm = this.farm;
    if (farm.status === 'running' || farm.status === 'collecting') return { ok: false, detail: '已经在运行' };
    if (!farm.items.length) return { ok: false, detail: '队列是空的，先添加课件' };
    if (!this.settings.videoHeartbeat) return { ok: false, detail: '先在设置里打开「允许上报视频进度」' };
    if (!this.host.userId()) return { ok: false, detail: '缺少 user_id（先进一次课堂）' };
    const first = farm.items.findIndex((item) => !item.done);
    if (first < 0) {
      farm.status = 'done';
      return { ok: false, detail: '队列里的视频都已刷完' };
    }
    farm.currentIndex = first;
    farm.status = 'running';
    farm.lastError = undefined;
    farm.updatedAt = Date.now();
    this.lastTick = Date.now();
    farm.speed = this.settings.video.speed;
    farm.tickSec = this.settings.video.tickSec;
    this.host.emit({
      kind: 'video',
      level: 'info',
      title: '继续刷课',
      detail: `续跑 ${farm.items[first].name} · 从 ${Math.round(farm.items[first].position)}s 开始`,
    });
    this.setTimer(() => void this.tick(), 400);
    return { ok: true, detail: '已继续' };
  }

  stop(): { ok: boolean; detail: string } {
    const farm = this.farm;
    this.clearTimer();
    const count = farm.items.length;
    farm.status = 'idle';
    farm.items = [];
    farm.currentIndex = 0;
    farm.startedAt = undefined;
    farm.lastError = undefined;
    farm.updatedAt = Date.now();
    this.lastTick = Date.now();
    farm.autoStarted = false;
    this.host.emit({
      kind: 'video',
      level: 'info',
      title: '刷课已停止',
      detail: count ? `清空 ${count} 个视频的队列（断点已保留）` : '队列已是空的',
    });
    this.host.persist();
    return { ok: true, detail: '已停止' };
  }

  /** 跳过当前视频（不标记服务端完成，只把它移出本轮队列） */
  skip(): { ok: boolean; detail: string } {
    const farm = this.farm;
    const item = this.currentItem();
    if (!item) return { ok: false, detail: '当前没有在刷的视频' };
    if (farm.status === 'running') this.clearTimer();
    item.done = true;
    item.skipped = true;
    item.lastError = '已跳过';
    item.updatedAt = Date.now();
    this.host.emit({
      kind: 'video',
      level: 'warn',
      title: '已跳过视频',
      detail: `${item.name} · 停在 ${Math.round(item.position)}s`,
    });
    if (farm.status === 'running') {
      this.advance();
    } else {
      this.host.pushSoon();
      this.host.persist();
    }
    return { ok: true, detail: '已跳过' };
  }

  setSpeed(speed: number): number {
    const next = Math.min(8, Math.max(1, Number(speed) || 1));
    this.farm.speed = next;
    this.farm.updatedAt = Date.now();
    this.host.persist();
    this.host.pushSoon();
    return next;
  }

  currentItem(): VideoFarmItem | null {
    const farm = this.farm;
    return farm.items[farm.currentIndex] ?? null;
  }

  /** 一次 tick = 一批心跳；失败重试 3 次后暂停，成功则按计划继续 */
  async tick(): Promise<void> {
    if (this.host.isStopped()) return;
    const farm = this.farm;
    if (farm.status !== 'running') return;
    if (!this.settings.videoHeartbeat) {
      this.pause('设置里关闭了视频上报');
      return;
    }
    const item = this.currentItem();
    if (!item) {
      this.finish();
      return;
    }
    if (item.done) {
      this.advance();
      return;
    }

    const userId = this.host.userId();
    if (!userId) {
      this.clearTimer();
      farm.status = 'error';
      farm.lastError = '缺少 user_id（登录态可能已失效）';
      farm.updatedAt = Date.now();
      this.host.emit({ kind: 'video', level: 'error', title: '刷课已暂停', detail: farm.lastError });
      this.host.persist();
      return;
    }

    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      await this.runTick(item, farm.speed, userId);
    } finally {
      this.tickRunning = false;
    }
  }

  private async runTick(item: VideoFarmItem, speed: number, userId: string): Promise<void> {
    const farm = this.farm;
    const now = Date.now();
    // 休眠/长时间挂起后不要把整段空档一次性补上；但间隔设得大时要允许对应跨度
    const elapsedCap = Math.min(300, Math.max(45, farm.tickSec * 1.5));
    const elapsed =
      this.lastTick > 0
        ? Math.min(elapsedCap, Math.max(0.5, (now - this.lastTick) / 1000))
        : Math.min(elapsedCap, farm.tickSec);
    this.lastTick = now;

    const key = this.key(item.presentationId, item.videoId);
    let session = this.sessions.get(key);
    if (!session) {
      session = createCursor(item.videoId, now).session;
      this.sessions.set(key, session);
    }
    const batch = buildHeartbeatBatch(
      { videoId: item.videoId, duration: item.duration, presentationId: item.presentationId },
      { position: item.position, seq: item.seq, session },
      { userId, at: now, elapsedSec: elapsed, speed, intervalSec: 15, batchMax: BATCH_MAX },
    );

    if (!batch.events.length) {
      item.done = true;
      item.percent = 100;
      item.updatedAt = now;
      this.advance();
      return;
    }

    let res: { ok: boolean; msg: string };
    try {
      res = await this.host.heartbeat(batch.events);
    } catch (err) {
      res = { ok: false, msg: String(err) };
    }
    if (this.host.isStopped()) return;

    if (res.ok) {
      item.position = batch.cursor.position;
      item.seq = batch.cursor.seq;
      item.sentTicks += batch.events.length;
      item.percent = batch.done
        ? 100
        : Math.min(99, Math.round((item.position / Math.max(1, item.duration)) * 100));
      item.attempts = 0;
      item.lastError = undefined;
      item.updatedAt = Date.now();
      farm.lastReply = res.msg;
      farm.updatedAt = item.updatedAt;
      this.host.saveProgress(key, { position: item.position, done: batch.done, at: item.updatedAt });
      this.host.pushSoon();

      if (batch.done) {
        item.done = true;
        this.host.emit({
          kind: 'video',
          level: 'success',
          title: '视频已刷完',
          detail: `${item.name} · ${item.sentTicks} 条心跳 · ${item.duration}s`,
          data: { presentationId: item.presentationId, videoId: item.videoId },
        });
        this.advance();
      } else {
        this.setTimer(() => void this.tick(), tickDelay(farm.tickSec));
      }
      this.host.persist();
      return;
    }

    item.attempts += 1;
    item.lastError = res.msg;
    farm.lastReply = res.msg;
    farm.updatedAt = Date.now();
    this.host.pushSoon();
    if (item.attempts >= MAX_ATTEMPTS) {
      this.clearTimer();
      farm.status = 'error';
      farm.lastError = `上报失败：${res.msg}`;
      this.host.emit({
        kind: 'video',
        level: 'error',
        title: '刷课已暂停',
        detail: `${item.name} · 连续 ${item.attempts} 次失败 · ${res.msg}`,
        data: { presentationId: item.presentationId, videoId: item.videoId },
      });
      this.host.notify('video-farm-error', '刷课已暂停', `${item.name}：${res.msg}`);
      this.host.persist();
      return;
    }
    this.host.emit({
      kind: 'video',
      level: 'warn',
      title: '视频心跳失败，准备重试',
      detail: `${item.name} · 第 ${item.attempts} 次 · ${res.msg}`,
      quiet: true,
    });
    this.setTimer(() => void this.tick(), Math.min(30_000, 4_000 * item.attempts));
  }

  private advance(): void {
    const farm = this.farm;
    let next = farm.currentIndex;
    while (next < farm.items.length && farm.items[next].done) next += 1;
    farm.currentIndex = next;
    farm.updatedAt = Date.now();
    if (next >= farm.items.length) {
      this.finish();
      return;
    }
    this.lastTick = Date.now();
    this.host.pushSoon();
    this.setTimer(() => void this.tick(), 400);
  }

  private finish(): void {
    this.clearTimer();
    const farm = this.farm;
    farm.status = 'done';
    farm.updatedAt = Date.now();
    const done = farm.items.filter((item) => item.done && !item.skipped).length;
    this.host.emit({
      kind: 'video',
      level: 'success',
      title: '刷课完成',
      detail: `${done}/${farm.items.length} 个视频已上报到片尾`,
    });
    this.host.notify('video-farm-done', '刷课完成', `${done}/${farm.items.length} 个视频`);
    this.host.persist();
    this.host.pushSoon();
  }

  /** 自动模式：课件一出现就把视频加进队列（已存在的不重复加） */
  maybeAuto(presentationId: string, videos: { videoId: string; duration: number; name?: string }[]): void {
    const cfg = this.settings;
    if (!cfg.videoHeartbeat || !cfg.video.autoStart || !videos.length || !this.host.userId()) return;
    const farm = this.farm;
    const existing = new Set(farm.items.map((item) => this.key(item.presentationId, item.videoId)));
    const fresh = this.buildItems(presentationId, videos).filter(
      (item) => !existing.has(this.key(item.presentationId, item.videoId)),
    );
    if (!fresh.length) return;

    farm.items.push(...fresh);
    farm.speed = cfg.video.speed;
    farm.tickSec = cfg.video.tickSec;
    farm.updatedAt = Date.now();
    if (farm.status === 'idle' || farm.status === 'done' || farm.status === 'error') {
      farm.currentIndex = farm.items.findIndex((item) => !item.done);
      if (farm.currentIndex < 0) {
        farm.status = 'done';
        this.host.pushSoon();
        this.host.persist();
        return;
      }
      farm.status = 'running';
      farm.autoStarted = true;
      farm.lastError = undefined;
      farm.startedAt = Date.now();
      this.lastTick = Date.now();
      this.host.emit({
        kind: 'video',
        level: 'info',
        title: '自动开始刷课',
        detail: `课件 ${presentationId} · 新增 ${fresh.length} 个视频`,
      });
      this.setTimer(() => void this.tick(), 800);
    } else {
      this.host.pushSoon();
      this.host.emit({
        kind: 'video',
        level: 'info',
        title: `已加入刷课队列 +${fresh.length}`,
        detail: `课件 ${presentationId} · 当前${farm.status === 'paused' ? '暂停中，继续后生效' : '运行中'}`,
      });
    }
    this.host.persist();
  }

  /** 关停：停表；正在跑就落成"已暂停"，下次启动可续 */
  shutdown(): void {
    this.clearTimer();
    if (this.farm.status === 'running') this.farm.status = 'paused';
  }
}
