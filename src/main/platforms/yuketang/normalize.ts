/**
 * 雨课堂响应的纯归一化函数。
 *
 * 单独成文件的目的：不 import electron / ws / 网络层，
 * 这样 Node 原生 type-stripping 能直接跑单元测试（node --test tests/*.test.mjs）。
 */

import type { Course, Problem, ProblemType } from '@shared/types';

export interface VideoRef {
  presentationId: string;
  slideIndex: number;
  slideId: string;
  videoId: string;
  url: string;
  duration: number;
  name: string;
}

/* 归一化（纯函数，供单测）                                             */
/* ------------------------------------------------------------------ */

export function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(str(v));
  return Number.isFinite(n) ? n : fallback;
}

/** 课程列表结构随学期变化，递归兜底收集 courseId/classroomId */
export function normalizeCourseList(payload: unknown): Course[] {
  const out: Course[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const course = (o.course as Record<string, unknown>) || o;
    const id = str(course.courseId ?? course.course_id ?? course.id);
    const classroomId = str(o.classroomId ?? o.classroom_id ?? course.classroomId);
    const name = str(course.courseName ?? course.course_name ?? course.name ?? o.name);
    if (id && name && !seen.has(id)) {
      seen.add(id);
      out.push({
        platform: 'yuketang',
        id,
        classId: classroomId || undefined,
        name,
        teacher: str(course.teacherName ?? course.teacher_name ?? (course.teacher as Record<string, unknown>)?.name),
        extra: {
          leafId: str(o.leafId ?? o.leaf_id ?? course.leafId),
          uvId: str(o.uvId ?? o.uv_id ?? course.uvId),
        },
      });
      return;
    }
    for (const key of ['list', 'data', 'courses', 'courseList', 'items']) {
      if (o[key]) walk(o[key], depth + 1);
    }
  };
  walk(payload, 0);
  return out;
}

export function normalizeProblem(raw: Record<string, unknown>, slideIndex: number): Problem {
  const problemId = str(raw.problemId ?? raw.problem_id ?? raw.id);
  const problemType = num(raw.problemType ?? raw.problem_type ?? raw.type, 1) as ProblemType;
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions.map((o) => {
    const obj = o as Record<string, unknown>;
    return { key: str(obj.key ?? obj.optionKey ?? obj.option_key ?? obj.value), value: str(obj.value ?? obj.content ?? obj.text) };
  });
  const rawBlanks = Array.isArray(raw.blanks) ? raw.blanks : [];
  return {
    problemId,
    problemType,
    body: str(raw.body ?? raw.content ?? raw.title ?? '').trim(),
    options: options.filter((o) => o.value),
    blankCount: rawBlanks.length || (problemType === 4 ? Math.max(1, inferBlankCount(str(raw.body))) : 0),
    slideIndex,
    submitState: 'pending',
  };
}

export function inferBlankCount(body: string): number {
  const matches = body.match(/_{2,}|（\s*）|\(\s*\)/g);
  return matches ? Math.max(1, matches.length) : 1;
}

/** 把 AI 回复解析成提交用的 result 结构 */
export function buildResult(problemType: number, answer: string[], blanks: string[]): unknown {
  if (problemType === 5) {
    return { content: answer.join('\n'), pics: [{ pic: '' }], videos: [] };
  }
  if (problemType === 4) {
    return blanks.length ? blanks : answer;
  }
  // 单选/多选/投票/判断 → 选项字母（排序去重）
  const letters = answer
    .map((a) => a.trim().toUpperCase())
    .filter((a) => /^[A-Z]$/.test(a));
  return Array.from(new Set(letters)).sort();
}
