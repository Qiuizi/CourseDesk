/**
 * 落盘缓存校验：state.json 可能来自旧版本、手改或异常退出，
 * 这里把"看起来对但会把 NaN / undefined 带进运行态"的值挡在引擎之外。
 */

import { resolveDuration } from './videofarm.ts';
import type { Course, HomeworkItem, SignRecord, VideoFarmItem } from '@shared/types';

export interface FarmProgress {
  position: number;
  done: boolean;
  at: number;
}

const PROGRESS_TTL_MS = 60 * 86_400_000;
const MAX_PROGRESS = 2000;
const MAX_QUEUE = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface DriftBaseline {
  hash: string;
  paths: string[];
  at: number;
}

/** 接口基线：hash/paths/at 形状不对就丢掉，避免 diffPaths 拿到非数组直接抛 */
export function normalizeBaselines(raw: unknown): Record<string, DriftBaseline> {
  const out: Record<string, DriftBaseline> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (key.length > 200 || !isRecord(value)) continue;
    const hash = text(value.hash);
    const at = num(value.at);
    if (!hash || at === null || at <= 0) continue;
    const paths = Array.isArray(value.paths) ? value.paths.filter((p): p is string => typeof p === 'string') : [];
    out[key] = { hash, paths: paths.slice(0, 4000), at };
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 断点表：丢掉过期、时间/位置非法、key 形状不对的项，并限制总条数 */
export function normalizeProgress(raw: unknown, now = Date.now()): Record<string, FarmProgress> {
  const out: Record<string, FarmProgress> = {};
  if (!isRecord(raw)) return out;
  const cutoff = now - PROGRESS_TTL_MS;

  for (const [key, value] of Object.entries(raw)) {
    if (!key.includes('|') || key.length > 200 || !isRecord(value)) continue;
    const position = num(value.position);
    const at = num(value.at);
    if (position === null || at === null || position < 0 || at < cutoff) continue;
    out[key] = {
      position: Math.min(position, 86_400),
      done: value.done === true,
      at,
    };
  }

  const keys = Object.keys(out);
  if (keys.length > MAX_PROGRESS) {
    keys
      .sort((a, b) => out[a].at - out[b].at)
      .slice(0, keys.length - MAX_PROGRESS)
      .forEach((key) => delete out[key]);
  }
  return out;
}

/** 队列项：字段逐个校验，坏项直接丢；位置/进度不允许越界 */
export function normalizeFarmItem(raw: unknown, now = Date.now()): VideoFarmItem | null {
  if (!isRecord(raw)) return null;
  const presentationId = text(raw.presentationId);
  const videoId = text(raw.videoId);
  if (!presentationId || !videoId) return null;

  const duration = resolveDuration(num(raw.duration) ?? 0);
  const done = raw.done === true;
  const position = Math.min(duration, Math.max(0, num(raw.position) ?? 0));
  const percent = done ? 100 : Math.min(99, Math.max(0, num(raw.percent) ?? Math.round((position / duration) * 100)));
  const updatedAt = num(raw.updatedAt) ?? now;

  return {
    presentationId,
    videoId,
    name: text(raw.name) || `视频 ${videoId.slice(-6)}`,
    duration,
    position,
    percent,
    seq: Math.max(0, Math.floor(num(raw.seq) ?? 0)),
    done,
    skipped: raw.skipped === true,
    attempts: 0,
    sentTicks: Math.max(0, Math.floor(num(raw.sentTicks) ?? 0)),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined,
    updatedAt,
  };
}

/** 未刷完的队列：坏项丢弃、下标夹紧；重启后一律回到"暂停" */
export function normalizeQueue(
  raw: unknown,
  now = Date.now(),
): { items: VideoFarmItem[]; currentIndex: number; at: number } | null {
  if (!isRecord(raw)) return null;
  const items = Array.isArray(raw.items)
    ? raw.items
        .slice(0, MAX_QUEUE)
        .map((item) => normalizeFarmItem(item, now))
        .filter((item): item is VideoFarmItem => item !== null)
    : [];
  if (!items.length) return null;

  const index = Math.floor(num(raw.currentIndex) ?? 0);
  return {
    items,
    currentIndex: Math.min(Math.max(0, index), Math.max(0, items.length - 1)),
    at: num(raw.at) ?? now,
  };
}

/** 通用列表校验：只保留对象，限制长度，避免坏数组让渲染层整页崩掉 */
export function normalizeList<T>(raw: unknown, max = 500): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).slice(0, max) as T[];
}

export function normalizeCourses(raw: unknown): Course[] {
  return normalizeList<Course>(raw, 200).filter(
    (course) => typeof course.id === 'string' && typeof course.name === 'string',
  );
}

export function normalizeHomework(raw: unknown): HomeworkItem[] {
  return normalizeList<HomeworkItem>(raw, 300).filter((item) => typeof item.id === 'string');
}

export function normalizeSigns(raw: unknown): SignRecord[] {
  return normalizeList<SignRecord>(raw, 300).filter((item) => typeof item.activeId === 'string');
}

export { PROGRESS_TTL_MS, MAX_PROGRESS, MAX_QUEUE };
