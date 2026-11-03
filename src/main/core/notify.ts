import { app, Notification } from 'electron';
import { log } from './log';

/** Windows Toast 需要一个稳定的 AppUserModelID，和安装包 appId 保持一致 */
export const APP_USER_MODEL_ID = 'com.coursedesk.app';

export function initNotifications(): void {
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  } catch (err) {
    log.warn('notify', '设置 AppUserModelID 失败', String(err));
  }
}

/**
 * 桌面通知。Electron 的 Notification 在 Windows 上走系统 Toast，
 * 点击回调用于把窗口拉到前台并切到对应面板。
 */

let onClickHandler: (() => void) | null = null;
let hiddenResolver: () => boolean = () => false;
let hiddenAllowed: () => boolean = () => true;

/** 主窗口是否收起来了 / 后台是否仍然允许弹通知，由主进程注入 */
export function configureNotificationPolicy(opts: {
  isHidden: () => boolean;
  allowWhenHidden: () => boolean;
}): void {
  hiddenResolver = opts.isHidden;
  hiddenAllowed = opts.allowWhenHidden;
}

export function setNotificationClickHandler(fn: () => void): void {
  onClickHandler = fn;
}

export interface NotifyOptions {
  title: string;
  body: string;
  silent?: boolean;
  urgency?: 'normal' | 'critical';
  onClick?: () => void;
}

export function notify(options: NotifyOptions): void {
  if (hiddenResolver() && !hiddenAllowed()) {
    log.debug('notify', '窗口在后台且已关闭后台提醒，跳过');
    return;
  }
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
    n.on('click', () => {
      options.onClick?.();
      onClickHandler?.();
    });
    n.show();
    log.debug('notify', `${options.title} — ${options.body}`);
  } catch (err) {
    log.warn('notify', '通知发送失败', String(err));
  }
}

/** 设置页的「发一条测试通知」 */
export function notifyTest(): { ok: boolean; message: string } {
  if (!Notification.isSupported()) return { ok: false, message: '当前系统不支持系统通知' };
  notify({
    title: 'CourseDesk 通知测试',
    body: '能看到这条，说明关掉窗口后也能收到开课 / 签到提醒。',
    silent: false,
  });
  return { ok: true, message: '已发送，若没看到请检查 Windows 通知设置' };
}
