/**
 * 接口变更检测（drift detection）。
 *
 * 思路：把一次响应的"结构路径集合"（data.list[].courseId 这种）抽出来，排序后算指纹，
 * 存在本地当基线。下一次检测指纹不同 → 说明平台改了字段/层级，立刻提醒。
 *
 * 为什么不用 JSON diff：字段值千变万化，只有结构才是协议的一部分。
 * 为什么只探只读端点：检测本身绝不能产生副作用（不签到、不提交答案）。
 */

import { createHash } from 'node:crypto';
import type { Course, DriftProbeResult, PlatformId } from '@shared/types';
import { request } from './net';
import { cx } from '../platforms/chaoxing/endpoints';
import { yt } from '../platforms/yuketang/endpoints';

export interface DriftProbe {
  probeId: string;
  platform: PlatformId;
  label: string;
  url: string;
  headers: () => Record<string, string>;
  /** 可选：把响应体裁成关心的子树（例如只关心 data） */
  pick?: (json: unknown) => unknown;
}

/* ------------------------------------------------------------------ */
/* 纯函数：结构路径提取与指纹                                           */
/* ------------------------------------------------------------------ */

const MAX_PATHS = 400;
const MAX_DEPTH = 4;

/**
 * 收集结构路径。数组统一用 `[]` 后缀，并聚合前 N 个元素的键（不同元素可能结构不同）。
 */
export function collectPaths(value: unknown, maxPaths = MAX_PATHS, maxDepth = MAX_DEPTH): string[] {
  const paths = new Set<string>();
  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (paths.size >= maxPaths || depth > maxDepth || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      const arrPath = `${prefix}[]`;
      paths.add(arrPath);
      // 取前两个元素，覆盖"列表里混了不同结构"的情况
      for (const item of node.slice(0, 2)) walk(item, arrPath, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      if (paths.size >= maxPaths) return;
      const path = prefix ? `${prefix}.${key}` : key;
      paths.add(path);
      const child = (node as Record<string, unknown>)[key];
      if (child && typeof child === 'object') walk(child, path, depth + 1);
    }
  };
  walk(value, '', 0);
  return [...paths].sort();
}

export function fingerprint(paths: string[]): string {
  return createHash('sha1').update(paths.join('|')).digest('hex').slice(0, 12);
}

export interface DriftDiff {
  added: string[];
  removed: string[];
  changed: boolean;
}

export function diffPaths(baseline: string[], current: string[]): DriftDiff {
  const base = new Set(baseline);
  const next = new Set(current);
  const added = current.filter((p) => !base.has(p)).slice(0, 60);
  const removed = baseline.filter((p) => !next.has(p)).slice(0, 60);
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

/* ------------------------------------------------------------------ */
/* 探测清单                                                            */
/* ------------------------------------------------------------------ */

export interface ProbeContext {
  ytHost: string;
  ytHeaders: () => Record<string, string>;
  cxHeaders: () => Record<string, string>;
  ytCourses: Course[];
  cxCourses: Course[];
  /** 最近一次课堂的 presentationId，用于探课件结构 */
  presentationId?: string;
  /** 最近一个活动 id，用于探活动详情结构 */
  activeId?: string;
}

/** 只读探测：任何一项都不改变服务端状态 */
export function buildProbes(ctx: ProbeContext): DriftProbe[] {
  const probes: DriftProbe[] = [
    {
      probeId: 'yt.courses',
      platform: 'yuketang',
      label: '雨课堂 · 课程列表',
      url: yt.courseList(ctx.ytHost),
      headers: ctx.ytHeaders,
    },
    {
      probeId: 'yt.onLesson',
      platform: 'yuketang',
      label: '雨课堂 · 在课接口',
      url: yt.onLesson(ctx.ytHost),
      headers: ctx.ytHeaders,
    },
    {
      probeId: 'cx.courseList',
      platform: 'chaoxing',
      label: '学习通 · 课程列表',
      url: cx.courseList,
      headers: ctx.cxHeaders,
    },
  ];

  if (ctx.presentationId) {
    probes.push({
      probeId: 'yt.presentation',
      platform: 'yuketang',
      label: '雨课堂 · 课件与题目结构',
      url: yt.presentation(ctx.ytHost, ctx.presentationId),
      headers: ctx.ytHeaders,
    });
  }

  const course = ctx.cxCourses.find((c) => c.classId);
  if (course?.classId) {
    probes.push({
      probeId: 'cx.activeList',
      platform: 'chaoxing',
      label: '学习通 · 活动列表',
      url: cx.activeList(course.id, course.classId),
      headers: ctx.cxHeaders,
    });
    probes.push({
      probeId: 'cx.workList',
      platform: 'chaoxing',
      label: '学习通 · 作业列表（HTML）',
      url: cx.workTaskList({ courseId: course.id, classId: course.classId, cpi: course.extra?.cpi ?? '0' }),
      headers: ctx.cxHeaders,
    });
  }

  if (ctx.activeId) {
    probes.push({
      probeId: 'cx.activeInfo',
      platform: 'chaoxing',
      label: '学习通 · 活动详情',
      url: cx.activeInfo(ctx.activeId),
      headers: ctx.cxHeaders,
    });
  }

  return probes;
}

/** HTML 端点没有 JSON 结构，退化成"关键 class/属性"集合 */
export function htmlSignature(html: string): string[] {
  const keys = new Set<string>();
  for (const match of html.matchAll(/class="([^"]{1,60})"/g)) keys.add(`class:${match[1].trim()}`);
  for (const match of html.matchAll(/data-([a-zA-Z-]{2,30})=/g)) keys.add(`data:${match[1]}`);
  if (html.includes('taskrefId')) keys.add('attr:taskrefId');
  if (html.includes('workId')) keys.add('attr:workId');
  return [...keys].sort().slice(0, 400);
}

/* ------------------------------------------------------------------ */
/* 执行一次检测                                                        */
/* ------------------------------------------------------------------ */

export interface RunOptions {
  baselines: Record<string, { hash: string; paths: string[]; at: number }>;
  onResult: (result: DriftProbeResult, paths: string[]) => void;
  timeoutMs?: number;
}

export async function runDriftCheck(probes: DriftProbe[], opts: RunOptions): Promise<DriftProbeResult[]> {
  const out: DriftProbeResult[] = [];
  for (const probe of probes) {
    const res = await request(probe.url, { headers: probe.headers(), timeoutMs: opts.timeoutMs ?? 15_000 });
    const isHtml = (res.headers['content-type'] ?? '').includes('html') || res.text.trimStart().startsWith('<');
    let paths: string[] = [];
    let ok = res.ok;
    let note: string | undefined;

    if (res.status === 0) {
      note = `网络不可达：${res.error ?? 'unknown'}`;
      ok = false;
    } else if (isHtml) {
      paths = htmlSignature(res.text);
      const head = res.text.slice(0, 4000);
      if (/passport2\.chaoxing\.com|fanyalogin|<title>\s*登录|用户登录/i.test(head)) {
        ok = false;
        note = '返回登录页（未登录）';
      } else if (!paths.length) {
        note = 'HTML 端点没有任何可识别结构';
      }
    } else if (res.json && typeof res.json === 'object') {
      const payload = probe.pick ? probe.pick(res.json) : res.json;
      paths = collectPaths(payload);
      const body = res.json as Record<string, unknown>;
      const bizCode = body.code;
      const bizFailed =
        (typeof bizCode === 'number' && bizCode !== 0) ||
        body.status === false ||
        body.success === false;
      if (bizFailed) {
        ok = false;
        note = `业务码 ${String(bizCode ?? '失败')}（未登录或无权限），不建立基线`;
      }
    } else {
      note = `响应不是 JSON（HTTP ${res.status}）`;
      ok = false;
    }

    if (!note && res.status !== 200) {
      note = res.status === 401 || res.status === 403 ? `HTTP ${res.status}（未登录或无权限）` : `HTTP ${res.status}`;
    }
    const hash = paths.length ? fingerprint(paths) : '—';
    const base = opts.baselines[probe.probeId];
    const diff = base && paths.length ? diffPaths(base.paths, paths) : { added: [], removed: [], changed: false };

    const result: DriftProbeResult = {
      probeId: probe.probeId,
      platform: probe.platform,
      label: probe.label,
      // 只有"HTTP 200 + 业务成功 + 有结构"才算一次可信探测，才允许建基线
      ok: ok && paths.length > 0 && res.status === 200,
      status: res.status,
      hash,
      pathCount: paths.length,
      checkedAt: Date.now(),
      baselineHash: base?.hash,
      baselineAt: base?.at,
      added: diff.added,
      removed: diff.removed,
      changed: Boolean(base) && diff.changed,
      note,
    };
    out.push(result);
    opts.onResult(result, paths);
  }
  return out;
}
