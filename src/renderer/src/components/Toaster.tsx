import { useEffect, useState, type ReactNode } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from '../lib/toast';

/** 全局提示层：固定在右下角，两种界面共用（样式在 styles.css） */
export function Toaster(): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`toast toast--${item.tone}`}
          onClick={() => dismissToast(item.id)}
          title="点击关闭"
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}
