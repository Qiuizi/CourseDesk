/**
 * 刷课（视频进度）纯逻辑：无 electron / 无网络依赖，单元测试直接导入。
 *
 * 设计要点（相对旧的"一次性灌完整段"）：
 *  - 游标推进：每次只上报"真实经过时间 × 倍速"覆盖的媒体区间，cp 单调递增；
 *  - 可恢复：position / seq 落盘，重启后从断点继续，不会把 cp 倒回去；
 *  - 时间戳真实：ts 落在 [at - elapsed, at] 内，不再指向未来；
 *  - 会话稳定：同一个视频一整轮共用一个 pg，而不是每次上报都换；
 *  - 可限流：单批最多 batchMax 条，配合 tickDelay 的抖动降低机械感。
 */

export interface FarmVideo {
  videoId: string;
  /** 媒体时长（秒），0 / 负数表示未知 */
  duration: number;
  presentationId?: string;
}

export interface FarmCursor {
  /** 已上报到的媒体位置（秒） */
  position: number;
  /** 该视频已发出的事件序号（n / sq 共用） */
  seq: number;
  /** 播放会话 id：真实播放器用 `videoId_时间戳` */
  session: string;
}

export interface HeartbeatContext {
  /** 雨课堂 user_id */
  userId: string;
  /** 本批事件的墙钟时间（毫秒） */
  at: number;
  /** 距上次上报真实经过的秒数 */
  elapsedSec: number;
  /** 倍速：1 / 1.5 / 2 / 4 */
  speed: number;
  /** 心跳粒度（媒体秒），真实播放器约 15s */
  intervalSec?: number;
  /** 单批事件上限，防止一次请求过大 */
  batchMax?: number;
  /** 时长缺失时的兜底（秒） */
  fallbackDuration?: number;
}

export interface HeartbeatBatch {
  events: Record<string, unknown>[];
  cursor: FarmCursor;
  done: boolean;
  /** 本批推进的媒体秒数 */
  advanced: number;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export function resolveDuration(duration: number, fallback = 600): number {
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : fallback;
}

export function createCursor(videoId: string, at = Date.now()): FarmCursor {
  return { position: 0, seq: 0, session: `${videoId}_${at}` };
}

/** 剩余媒体秒数（按倍速折算成真实秒） */
export function estimateRemainingSec(duration: number, position: number, speed: number, fallback = 600): number {
  const total = resolveDuration(duration, fallback);
  const left = Math.max(0, total - clamp(position, 0, total));
  return Math.ceil(left / clamp(speed || 1, 1, 16));
}

/** 下一次上报的间隔：tickSec 上下浮动 15%，避免秒表一样整齐 */
export function tickDelay(tickSec: number, rand: () => number = Math.random): number {
  const base = clamp(tickSec, 3, 120) * 1000;
  return Math.round(base * (0.85 + rand() * 0.3));
}

/** 允许粘贴一串 presentationId：逗号 / 分号 / 顿号 / 空白都行，去重保序 */
export function parsePresentationIds(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;，；、|]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = String(item).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * 构造一批 video-log 心跳事件。
 * 字段形状取自真实播放器（FkRain/new.ps1）：i=20、p=web、lob=ykt、source=ks ……
 * `cp` 是可验证的播放位置，`d` 沿用旧实现写位置；`ts` 只会落在过去。
 */
export function buildHeartbeatBatch(
  video: FarmVideo,
  cursor: FarmCursor,
  ctx: HeartbeatContext,
): HeartbeatBatch {
  const duration = resolveDuration(video.duration, ctx.fallbackDuration ?? 600);
  const interval = clamp(Math.round(ctx.intervalSec ?? 15), 5, 120);
  const batchMax = Math.floor(clamp(ctx.batchMax ?? 40, 2, 200));
  const speed = clamp(ctx.speed || 1, 1, 16);
  const elapsed = clamp(ctx.elapsedSec || interval, 0.2, 300);
  const position = clamp(cursor.position, 0, duration);
  const target = Math.min(duration, position + elapsed * speed);
  const at = ctx.at;
  const tsStart = at - Math.min(elapsed, 120) * 1000;

  const events: Record<string, unknown>[] = [];
  let seq = Math.max(0, Math.floor(cursor.seq));
  let lead = 0;

  const push = (pos: number, et: string, ts: number): void => {
    events.push({
      ts: Math.round(clamp(ts, tsStart, at)),
      i: 20,
      et,
      p: 'web',
      t: 'ykt_playback',
      u: ctx.userId,
      c: '',
      classroomid: '',
      lob: 'ykt',
      v: video.videoId,
      f: 0,
      fp: '',
      tp: 'ykt',
      d: Math.round(pos),
      pg: cursor.session,
      n: seq,
      lesson_id: '',
      source: 'ks',
      sp: 1,
      sq: seq,
      cp: Math.round(pos * 10) / 10,
    });
    seq += 1;
  };

  // 新一轮播放的第一批：补齐真实播放器开播时必发的状态事件
  // 续跑时从断点位置开播，避免先把 cp 打回 0
  if (cursor.seq === 0) {
    lead = Math.min(400, Math.max(60, (at - tsStart) * 0.2));
    push(position, 'loadstart', tsStart);
    push(position, 'loadeddata', tsStart + lead * 0.3);
    push(position, 'play', tsStart + lead * 0.6);
    push(position, 'playing', tsStart + lead);
  }

  // 跨过的 15s 边界各补一条，末尾再补一条到本批目标位置
  const room = Math.max(1, batchMax - events.length);
  const points: number[] = [];
  const firstBeat = Math.min(duration, Math.ceil((position + 1e-3) / interval) * interval);
  for (let p = firstBeat; p < target - 1e-6; p += interval) {
    points.push(p);
  }
  points.push(target);
  // 超过单批上限时截断媒体推进，剩下的留给下一批，保证 events 与游标一致
  const beats = points.slice(0, room);

  const lastPos = beats[beats.length - 1] ?? position;
  const span = Math.max(0.001, lastPos - position);
  const beatStart = Math.min(at, tsStart + lead);
  for (const p of beats) {
    push(p, 'heartbeat', beatStart + ((p - position) / span) * (at - beatStart));
  }

  return {
    events,
    cursor: { position: lastPos, seq, session: cursor.session },
    done: lastPos >= duration - 0.05,
    advanced: Math.max(0, lastPos - position),
  };
}
