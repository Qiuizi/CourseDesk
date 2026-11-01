import type { Problem, SignMethod } from '@shared/types';

export function hhmmss(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function hhmm(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function ago(ts?: number, now = Date.now()): string {
  if (!ts) return '从未';
  const diff = Math.max(0, now - ts);
  if (diff < 5_000) return '刚刚';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function countdown(deadlineAt?: number, now = Date.now()): string {
  if (!deadlineAt) return '不限时';
  const left = deadlineAt - now;
  if (left <= 0) return '已截止';
  const s = Math.ceil(left / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}′${String(s % 60).padStart(2, '0')}″`;
}

export const PROBLEM_TYPE: Record<number, string> = {
  1: '单选',
  2: '多选',
  3: '投票',
  4: '填空',
  5: '主观',
  6: '判断',
};

export function problemBrief(p: Problem): string {
  return p.body || `题目 ${p.problemId}`;
}

export function answerPreview(p: Problem): string {
  if (p.aiAnalysis) return '已生成解析（不提交）';
  if (p.answer === undefined || p.answer === null) return '—';
  const a = p.answer;
  if (Array.isArray(a)) return a.join('、');
  if (typeof a === 'object') {
    const obj = a as Record<string, unknown>;
    return String(obj.content ?? JSON.stringify(a));
  }
  return String(a);
}

export const SIGN_METHOD_LABEL: Record<SignMethod, string> = {
  normal: '普通签到',
  location: '位置签到',
  gesture: '手势签到',
  code: '签到码',
  qr: '二维码（人工）',
  photo: '拍照（人工）',
  unknown: '未知',
};

export function roleLabel(role: number): string {
  if (role === 1) return '教师';
  if (role === 5) return '学生';
  if (role === 6) return '旁听';
  return `role ${role}`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
