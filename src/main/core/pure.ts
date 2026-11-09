/**
 * 引擎里的纯函数（无 electron / 无网络依赖），供单元测试直接导入。
 */

import type { ClassEvent } from '@shared/types';

export function dedupeEvents(events: ClassEvent[], windowMs = 180_000): ClassEvent[] {
  const out: ClassEvent[] = [];
  for (const e of events) {
    const dup = out.find(
      (prev) =>
        prev.platform === e.platform &&
        prev.kind === e.kind &&
        prev.title === e.title &&
        prev.detail === e.detail &&
        Math.abs(e.at - prev.at) < windowMs,
    );
    if (!dup) out.push(e);
  }
  return out.slice(-300);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = Array.isArray(base) ? [...(base as unknown[])] : { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = (out as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      (out as Record<string, unknown>)[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out as T;
}

/** 从模型输出里抠 JSON 数组；容忍 ```json 包裹与前后废话 */
export function parseAnswerArray(text: string): string[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const match = cleaned.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      /* fallthrough */
    }
  }
  // 兜底：模型只回了 "A" 或 "A,C"
  const letters = cleaned.match(/\b[A-F]\b/g);
  if (letters?.length) return Array.from(new Set(letters));
  return cleaned ? [cleaned.split('\n')[0].trim()] : [];
}
