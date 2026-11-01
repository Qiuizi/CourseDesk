/**
 * 雨课堂课堂 WebSocket 客户端（wss://<host>/wsapp/）。
 *
 * 握手：`{"op":"hello","userid":"<id>","role":"student","auth":"<lessonToken>","lessonid":"<id>"}`
 * auth 来自 /api/v3/lesson/checkin 的 lessonToken。
 *
 * 与服务端 op 对齐（11 种，见 docs/协议依据.md）：
 *   hello / unlockproblem / extendtime / probleminfo / problemfinished /
 *   fetchtimeline / showpresentation / presentationcreated / slidenav /
 *   lessonfinished / callpaused
 *
 * 用 ws 库而非 undici 内置 WebSocket：握手需要带 Cookie 头，
 * 内置实现不支持自定义 header，ws 支持。
 */

import WebSocket from 'ws';
import { mainSession } from '../../core/net';
import { log } from '../../core/log';
import { yt } from './endpoints';

export interface WsHandlers {
  onEvent: (evt: {
    op: string;
    title: string;
    detail?: string;
    level?: 'info' | 'success' | 'warn' | 'error';
    kind?: 'lesson' | 'problem' | 'protocol';
    data?: Record<string, unknown>;
  }) => void;
  onState: (state: 'connecting' | 'open' | 'closed' | 'error', detail?: string) => void;
  onProblem?: (problem: { problemId: string; limitSec: number; presentationId: string; slideIndex: number }) => void;
  onPresentation?: (presentationId: string) => void;
}

export class YtLessonSocket {
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private retry = 0;
  private closedByUser = false;

  constructor(
    private readonly opts: {
      host: string;
      lessonId: string;
      userId: string;
      lessonToken: string;
      handlers: WsHandlers;
    },
  ) {}

  async connect(): Promise<void> {
    this.closedByUser = false;
    const { host, lessonId, userId, lessonToken, handlers } = this.opts;
    handlers.onState('connecting');

    const cookies = await mainSession().cookies.get({ url: `https://${host}/` });
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const url = yt.wsUrl(host);

    try {
      const ws = new WebSocket(url, {
        headers: {
          Cookie: cookieHeader,
          Origin: `https://${host}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        },
        handshakeTimeout: 12_000,
      });
      this.ws = ws;

      ws.on('open', () => {
        this.retry = 0;
        handlers.onState('open');
        const hello = {
          op: 'hello',
          userid: userId,
          role: 'student',
          auth: lessonToken,
          lessonid: lessonId,
        };
        ws.send(JSON.stringify(hello));
        log.info('yt-ws', `握手已发送 lesson=${lessonId}`);
        // 应用层保活：雨课堂服务端会主动 ping，但长时间静默仍需探活
        this.heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'fetchtimeline', lessonid: lessonId, msgid: Date.now() % 100000 }));
          }
        }, 45_000);
      });

      ws.on('message', (raw: WebSocket.RawData) => {
        const text = raw.toString();
        this.handleMessage(text);
      });

      ws.on('close', (code, reason) => {
        this.stopHeartbeat();
        handlers.onState('closed', `${code} ${reason.toString()}`.trim());
        if (!this.closedByUser) this.scheduleReconnect();
      });

      ws.on('error', (err) => {
        handlers.onState('error', err.message);
        log.warn('yt-ws', `连接错误 ${err.message}`);
      });
    } catch (err) {
      handlers.onState('error', String(err));
      log.error('yt-ws', '建立连接失败', String(err));
    }
  }

  private scheduleReconnect(): void {
    if (this.retry >= 5) {
      log.warn('yt-ws', '重连次数用尽，停止');
      return;
    }
    const delay = Math.min(30_000, 1500 * 2 ** this.retry);
    this.retry += 1;
    log.info('yt-ws', `${delay}ms 后第 ${this.retry} 次重连`);
    setTimeout(() => {
      if (!this.closedByUser) void this.connect();
    }, delay);
  }

  close(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    try {
      this.ws?.close(1000, 'client shutdown');
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private handleMessage(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      log.debug('yt-ws', '非 JSON 消息', text.slice(0, 200));
      return;
    }
    const op = String(msg.op ?? '');
    const { handlers } = this.opts;

    switch (op) {
      case 'hello': {
        handlers.onEvent({
          op,
          kind: 'lesson',
          level: 'success',
          title: '已接入课堂实时通道',
          detail: `livestatus=${String(msg.livestatus ?? '-')} 交互=${msg.interactive ? '开' : '关'}`,
        });
        break;
      }
      case 'unlockproblem': {
        const p = (msg.problem ?? {}) as Record<string, unknown>;
        const problemId = String(p.prob ?? p.problemId ?? '');
        const limit = Number(p.limit ?? -1);
        const pres = String(p.pres ?? '');
        const si = Number(p.si ?? 0);
        handlers.onEvent({
          op,
          kind: 'problem',
          level: 'warn',
          title: `新题解锁${limit > 0 ? `（限时 ${limit}s）` : ''}`,
          detail: `presentation=${pres} slide=${si}`,
          data: { problemId, limit, pres },
        });
        if (problemId) handlers.onProblem?.({ problemId, limitSec: limit, presentationId: pres, slideIndex: si });
        break;
      }
      case 'extendtime': {
        const p = (msg.problem ?? {}) as Record<string, unknown>;
        handlers.onEvent({
          op,
          kind: 'problem',
          level: 'warn',
          title: `题目延时 +${String(p.extend ?? '?')}s`,
          data: { problemId: String(p.prob ?? '') },
        });
        break;
      }
      case 'probleminfo':
      case 'problemfinished': {
        handlers.onEvent({
          op,
          kind: 'problem',
          level: 'info',
          title: op === 'probleminfo' ? '题目状态刷新' : '收题通知',
          data: msg,
        });
        break;
      }
      case 'presentationcreated':
      case 'showpresentation': {
        const pres = String(msg.presentation ?? '');
        handlers.onEvent({
          op,
          kind: 'lesson',
          level: 'info',
          title: op === 'presentationcreated' ? '开始放映课件' : '翻页',
          detail: pres ? `presentation=${pres}` : undefined,
          data: { presentation: pres, slideindex: msg.slideindex ?? msg.slideid },
        });
        if (pres) handlers.onPresentation?.(pres);
        break;
      }
      case 'slidenav':
      case 'fetchtimeline': {
        const timeline = Array.isArray(msg.timeline) ? msg.timeline : [];
        for (const item of timeline) {
          const t = item as Record<string, unknown>;
          if (t.type !== 'event') continue;
          const code = String(t.code ?? '');
          if (code === 'LESSON_START') {
            handlers.onEvent({ op, kind: 'lesson', level: 'success', title: '上课啦', detail: String(t.title ?? '') });
          } else if (code === 'RANDOM_PICK') {
            handlers.onEvent({ op, kind: 'lesson', level: 'warn', title: '随机点名', detail: String(t.title ?? '') });
          }
          handlers.onEvent({
            op,
            kind: 'lesson',
            level: 'info',
            title: String(t.title ?? code ?? '课堂事件'),
            detail: code,
            data: { timeline: true },
          });
        }
        break;
      }
      case 'callpaused': {
        handlers.onEvent({
          op,
          kind: 'lesson',
          level: 'warn',
          title: `随机点名：${String(msg.name ?? '')} ${String(msg.sid ?? '')}`,
          detail: String((msg.event as Record<string, unknown>)?.title ?? ''),
          data: { uid: msg.uid, sid: msg.sid },
        });
        break;
      }
      case 'lessonfinished': {
        handlers.onEvent({
          op,
          kind: 'lesson',
          level: 'success',
          title: '下课啦',
          detail: String((msg.event as Record<string, unknown>)?.title ?? ''),
        });
        break;
      }
      default: {
        // 未知 op = 平台可能改版，记警告供"协议漂移"面板展示
        handlers.onEvent({
          op: op || '(empty)',
          kind: 'protocol',
          level: 'warn',
          title: `未知 WS 消息 op=${op || '(empty)'}`,
          data: { keys: Object.keys(msg).slice(0, 12) },
        });
      }
    }
  }
}
