import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '@shared/types';
import { toast } from './toast';

const FALLBACK: AppSnapshot = {
  version: '—',
  startedAt: Date.now(),
  settings: {
    yuketang: {
      host: 'www.yuketang.cn',
      pollIntervalSec: 20,
      notifyOnLesson: true,
      autoEnterClass: false,
      checkinSource: 5,
      checkinMode: 'both',
      answerPolicy: 'off',
      videoHeartbeat: false,
      video: { speed: 2, tickSec: 10, autoStart: false },
      homeworkWatch: true,
    },
    chaoxing: {
      pollIntervalSec: 30,
      autoSign: false,
      notifyOnNewActive: true,
      location: { latitude: '30.5560', longitude: '103.9890', address: '校园默认位置' },
      signTypes: { normal: true, location: true, gesture: true, code: true },
      courseScanLimit: 8,
    },
    ai: { enabled: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', temperature: 0.2, timeoutSec: 40 },
    notify: { system: true, sound: false },
    ui: { accent: 'lime', density: 'comfortable', mode: 'simple' },
    drift: { enabled: true, intervalHours: 6, notify: true },
    behavior: { closeToTray: true, launchAtLogin: false, notifyWhenHidden: true },
    startMinimized: false,
  },
  yuketang: {
    auth: { logged: false },
    courses: [],
    onLesson: [],
    lesson: null,
    homework: [],
    monitor: { running: false, pollCount: 0 },
    videoFarm: {
      status: 'idle',
      speed: 2,
      tickSec: 10,
      items: [],
      currentIndex: 0,
      autoStarted: false,
    },
  },
  chaoxing: {
    auth: { logged: false },
    courses: [],
    actives: [],
    signs: [],
    homework: [],
    monitor: { running: false, pollCount: 0 },
  },
  events: [],
  health: { yuketang: { ok: true, notes: [] }, chaoxing: { ok: true, notes: [] } },
  drift: { enabled: true, intervalHours: 6, running: false, results: [], unknownOps: {}, hasDrift: false },
  update: { status: 'idle' },
  busy: {},
};

export type Call = <T>(fn: (api: Window['coursedesk']) => Promise<T>) => Promise<T | undefined>;

export interface PageProps {
  snap: AppSnapshot;
  call: Call;
}

export function useEngine(): {
  snap: AppSnapshot;
  ready: boolean;
  call: <T = unknown>(fn: (api: Window['coursedesk']) => Promise<T>) => Promise<T | undefined>;
} {
  const [snap, setSnap] = useState<AppSnapshot>(FALLBACK);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const api = window.coursedesk;
    if (!api) return;
    void api
      .snapshot()
      .then((s) => {
        if (mounted.current) {
          setSnap(s);
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        toast(`读取状态失败：${err instanceof Error ? err.message : String(err)}`);
      });
    const off = api.onSnapshot((next) => {
      if (mounted.current) setSnap(next);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, []);

  const call = useCallback(async <T,>(fn: (api: Window['coursedesk']) => Promise<T>): Promise<T | undefined> => {
    const api = window.coursedesk;
    if (!api) {
      toast('界面与主进程的连接还没建立好，请稍后重试');
      return undefined;
    }
    try {
      const result = await fn(api);
      // 主进程统一用 { ok:false, msg } 表达失败：这里兜底提示，避免"点了没反应"
      const failure = result as { ok?: unknown; msg?: unknown; detail?: unknown } | null;
      if (failure && typeof failure === 'object' && failure.ok === false) {
        const text = [failure.msg, failure.detail].find((v): v is string => typeof v === 'string' && v.trim() !== '');
        toast(text ?? '操作没有成功');
      }
      return result;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, []);

  return { snap, ready, call };
}

export function useTick(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let timer = 0;
    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
    };
    const start = (): void => {
      stop();
      timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else {
        setNow(Date.now());
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
  return now;
}
