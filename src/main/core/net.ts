import { app, safeStorage, session, type Session } from 'electron';

/**
 * 统一的网络会话。
 *
 * 设计要点：登录态完全交给 Electron 的 persist 分区管理（cookie 落盘、重启复用），
 * 主进程通过 `ses.fetch` 发请求 → 自动携带该分区 cookie，与内嵌登录窗口共享。
 * 这样"扫码登录一次，协议层永久可用"，不需要在业务代码里搬运 cookie。
 */

export const PARTITION = 'persist:coursedesk';

/** 现代 Chrome UA：雨课堂/学习通都会按 UA 走不同分支，桌面端用桌面 UA。 */
export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

let configured = false;

export function mainSession(): Session {
  const ses = session.fromPartition(PARTITION);
  if (!configured) {
    configured = true;
    ses.setUserAgent(DESKTOP_UA);
    // 雨课堂/学习通都有埋点与第三方统计，测试环境里直接拦掉，减少噪声与卡顿。
    ses.webRequest.onBeforeRequest({ urls: ['*://*.google-analytics.com/*', '*://*.sentry.io/*'] }, (_d, cb) =>
      cb({ cancel: true }),
    );
  }
  return ses;
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | URLSearchParams;
  timeoutMs?: number;
  /** true = 不抛错，返回 status */
  allowError?: boolean;
}

export interface HttpResult {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  setCookies: string[];
  text: string;
  json: unknown;
  ms: number;
  error?: string;
}

const DEFAULT_TIMEOUT = 20_000;

export async function request(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const ses = mainSession();
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'user-agent': DESKTOP_UA,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...opts.headers,
  };
  try {
    const body =
      opts.body instanceof URLSearchParams ? opts.body.toString() : (opts.body as string | Buffer | undefined);
    const res = await ses.fetch(url, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
      credentials: 'include',
      redirect: 'follow',
    });
    const text = await res.text();
    const headerMap: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headerMap[key.toLowerCase()] = value;
    });
    const setCookies =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : headerMap['set-cookie']
          ? [headerMap['set-cookie']]
          : [];
    let json: unknown = null;
    const trimmed = text.trim();
    if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        json = JSON.parse(trimmed);
      } catch {
        json = null;
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || url,
      headers: headerMap,
      setCookies,
      text,
      json,
      ms: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return {
      ok: false,
      status: 0,
      url,
      headers: {},
      setCookies: [],
      text: '',
      json: null,
      ms: Date.now() - started,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 带指数退避的重试（只对网络错误/5xx/429 生效） */
export async function requestWithRetry(
  url: string,
  opts: HttpOptions = {},
  attempts = 3,
): Promise<HttpResult> {
  let last: HttpResult | null = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await request(url, opts);
    const retryable = !last.ok && (last.status === 0 || last.status === 429 || last.status >= 500);
    if (!retryable) return last;
    await new Promise((r) => setTimeout(r, 400 * 2 ** i + Math.random() * 200));
  }
  return last as HttpResult;
}

/** 从分区里取某个域名的 cookie 明细（诊断/排错用） */
export async function cookiesFor(url: string) {
  return mainSession().cookies.get({ url });
}

export async function clearAllCookies(origin: string): Promise<void> {
  const ses = mainSession();
  const list = await ses.cookies.get({ url: origin });
  await Promise.all(
    list.map((c) => {
      const rawHost = c.domain ?? '';
      const host = rawHost.startsWith('.') ? rawHost.slice(1) : rawHost;
      const scheme = c.secure ? 'https' : 'http';
      return ses.cookies.remove(`${scheme}://${host}${c.path}`, c.name).catch(() => undefined);
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 敏感值加密（AI Key / 学习通密码）                                    */
/* ------------------------------------------------------------------ */

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `v1:${safeStorage.encryptString(plain).toString('base64')}`;
    }
  } catch {
    /* 落到明文兜底 */
  }
  return `raw:${Buffer.from(plain, 'utf8').toString('base64')}`;
}

export function decryptSecret(stored: string | undefined): string {
  if (!stored) return '';
  try {
    if (stored.startsWith('v1:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(3), 'base64'));
    }
    if (stored.startsWith('raw:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8');
    }
  } catch {
    return '';
  }
  return '';
}

/** 请求失败原因的可读化（给 UI 看，不暴露堆栈） */
export function describeHttpFailure(res: HttpResult): string {
  if (res.status === 0) return `网络不可达：${res.error ?? 'unknown'}`;
  if (res.status === 401 || res.status === 403) return `未登录或无权限（HTTP ${res.status}）`;
  if (res.status === 404) return `接口不存在（HTTP 404），可能已改版`;
  if (res.status === 429) return '请求过于频繁（HTTP 429），已自动退避';
  if (res.status >= 500) return `服务端错误（HTTP ${res.status}）`;
  return `HTTP ${res.status}`;
}

export function dataDir(): string {
  return app.getPath('userData');
}
