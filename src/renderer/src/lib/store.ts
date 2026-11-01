import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSnapshot } from '@shared/types';

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
      confirmTimeoutSec: 60,
      videoHeartbeat: false,
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
    startMinimized: false,
  },
  yuketang: {
    auth: { logged: false },
    courses: [],
    onLesson: [],
    lesson: null,
    homework: [],
    monitor: { running: false, pollCount: 0 },
    videoReported: {},
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
  pending: Record<string, boolean>;
} {
  const [snap, setSnap] = useState<AppSnapshot>(FALLBACK);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const api = window.coursedesk;
    if (!api) return;
    void api.snapshot().then((s) => {
      if (mounted.current) {
        setSnap(s);
        setReady(true);
      }
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
    if (!api) return undefined;
    const key = fn.toString().slice(0, 40);
    setPending((p) => ({ ...p, [key]: true }));
    try {
      return await fn(api);
    } catch {
      return undefined;
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }, []);

  const memoPending = useMemo(() => pending, [pending]);
  return { snap, ready, call, pending: memoPending };
}

export function useTick(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
