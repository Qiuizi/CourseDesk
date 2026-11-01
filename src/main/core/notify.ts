import { Notification } from 'electron';
import { log } from './log';

/**
 * 桌面通知。Electron 的 Notification 在 Windows 上走系统 Toast，
 * 点击回调用于把窗口拉到前台并切到对应面板。
 */

let onClickHandler: (() => void) | null = null;

export function setNotificationClickHandler(fn: () => void): void {
  onClickHandler = fn;
}

export interface NotifyOptions {
  title: string;
  body: string;
  silent?: boolean;
  urgency?: 'normal' | 'critical';
}

export function notify(options: NotifyOptions): void {
  if (!Notification.isSupported()) {
    log.debug('notify', `系统不支持通知，丢弃：${options.title}`);
    return;
  }
  try {
    const n = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? true,
      urgency: options.urgency ?? 'normal',
    });
    n.on('click', () => onClickHandler?.());
    n.show();
    log.debug('notify', `${options.title} — ${options.body}`);
  } catch (err) {
    log.warn('notify', '通知发送失败', String(err));
  }
}
