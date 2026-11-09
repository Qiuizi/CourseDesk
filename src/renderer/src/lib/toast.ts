/**
 * 极简 toast：不引第三方库，模块级状态 + 订阅。
 * 主进程返回 { ok:false, msg } 时由 store.call 统一弹一条，避免"点了没反应"。
 */

export type ToastTone = 'error' | 'info' | 'success';

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

type Listener = (items: ToastItem[]) => void;

const MAX_ITEMS = 3;
const listeners = new Set<Listener>();

let items: ToastItem[] = [];
let seq = 0;
let lastText = '';
let lastAt = 0;

function emit(): void {
  for (const listener of listeners) listener(items);
}

export function dismissToast(id: number): void {
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

export function toast(text: string, tone: ToastTone = 'error'): void {
  const clean = text.trim();
  if (!clean) return;
  // 同一个错误 3 秒内只弹一次（轮询/连点不刷屏）
  const now = Date.now();
  if (clean === lastText && now - lastAt < 3000) return;
  lastText = clean;
  lastAt = now;

  const id = ++seq;
  items = [...items, { id, text: clean, tone }].slice(-MAX_ITEMS);
  emit();
  window.setTimeout(() => dismissToast(id), tone === 'error' ? 6000 : 3200);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
