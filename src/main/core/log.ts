import { app } from 'electron';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLine } from '@shared/types';

const RING_SIZE = 600;

let ring: LogLine[] = [];
let logDir = '';
let initPromise: Promise<void> | null = null;
let chain: Promise<void> = Promise.resolve();

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      logDir = join(app.getPath('userData'), 'logs');
      await mkdir(logDir, { recursive: true });
    })();
  }
  return initPromise;
}

function dayFile(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return join(logDir, `coursedesk-${y}${m}${day}.jsonl`);
}

function shortData(data: unknown): unknown {
  if (data === undefined) return undefined;
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    if (text.length <= 4000) return data;
    return `${text.slice(0, 4000)}…(${text.length} chars)`;
  } catch {
    return '[unserializable]';
  }
}

function record(level: LogLine['level'], scope: string, message: string, data?: unknown): LogLine {
  const line: LogLine = { at: Date.now(), level, scope, message, data: shortData(data) };
  ring.push(line);
  if (ring.length > RING_SIZE) ring = ring.slice(-RING_SIZE);
  void ensureInit().then(() => {
    chain = chain
      .then(async () => {
        await appendFile(dayFile(), `${JSON.stringify(line)}\n`, 'utf8');
      })
      .catch(() => undefined);
  });
  if (level === 'error') console.error(`[${scope}] ${message}`, data ?? '');
  else if (level === 'warn') console.warn(`[${scope}] ${message}`, data ?? '');
  return line;
}

export const log = {
  debug: (scope: string, message: string, data?: unknown) => record('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown) => record('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => record('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) => record('error', scope, message, data),
  tail: (limit = 200): LogLine[] => ring.slice(-limit),
  clear: (): void => {
    ring = [];
  },
  dir: () => logDir,
};

/* ------------------------------------------------------------------ */
/* 状态持久化：JSON + 原子写 + safeStorage 加密敏感值                   */
/* ------------------------------------------------------------------ */

export interface PersistShape {
  version: number;
  settings?: unknown;
  secrets?: Record<string, string>;
  events?: unknown;
  cache?: Record<string, unknown>;
}

export class JsonStore<T extends { version: number }> {
  private data: T;
  private readonly file: string;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(fileName: string, private readonly defaults: T) {
    this.file = join(app.getPath('userData'), fileName);
    this.data = structuredClone(defaults);
  }

  async load(): Promise<T> {
    try {
      if (!existsSync(this.file)) return this.data;
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<T>;
      this.data = { ...structuredClone(this.defaults), ...parsed } as T;
    } catch (err) {
      log.warn('store', `读取 ${this.file} 失败，回退默认值`, String(err));
      this.data = structuredClone(this.defaults);
    }
    return this.data;
  }

  get(): T {
    return this.data;
  }

  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch };
    this.schedule();
    return this.data;
  }

  update(mutator: (draft: T) => void): T {
    mutator(this.data);
    this.schedule();
    return this.data;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 250);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    const tmp = `${this.file}.tmp`;
    this.writing = this.writing
      .then(async () => {
        await mkdir(app.getPath('userData'), { recursive: true });
        await writeFile(tmp, payload, 'utf8');
        await rename(tmp, this.file);
      })
      .catch((err) => {
        log.warn('store', '写入失败', String(err));
      });
    await this.writing;
  }
}
