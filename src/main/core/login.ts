/**
 * 内嵌浏览器窗口。
 *
 * 用途：
 *  - 登录雨课堂（微信扫码）→ cookie 落进 persist:coursedesk 分区
 *  - 登录学习通（网页版扫码/验证码）→ 同上
 *  - 打开课堂页 / 课程页（网页端点名的出勤凭证、需要页面自身 WS 的场景）
 *
 * 关闭窗口时把最终 URL 与 cookie 数量回报，便于 UI 判断"是不是登录成功了"。
 */

import { BrowserWindow, shell } from 'electron';
import { PARTITION, DESKTOP_UA } from './net';
import { log } from './log';

const openWindows = new Set<BrowserWindow>();

export interface BrowserWindowResult {
  closed: boolean;
  url: string;
  cookieCount: number;
}

export function openBrowserWindow(
  url: string,
  title: string,
  options: { width?: number; height?: number } = {},
): Promise<BrowserWindowResult> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: options.width ?? 1180,
      height: options.height ?? 820,
      title,
      autoHideMenuBar: true,
      backgroundColor: '#0b0f0d',
      show: false,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    openWindows.add(win);
    win.webContents.setUserAgent(DESKTOP_UA);

    win.once('ready-to-show', () => win.show());

    // 站外链接交回系统浏览器，避免登录流程把窗口带到奇怪的地方
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/.test(target)) {
        void shell.openExternal(target);
      }
      return { action: 'deny' };
    });

    win.webContents.on('did-navigate', (_e, target) => {
      log.debug('browser', `→ ${target}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      log.warn('browser', `加载失败 ${code} ${desc}`, url);
    });

    win.on('closed', async () => {
      openWindows.delete(win);
      let cookieCount = 0;
      try {
        const host = new URL(url).hostname;
        const cookies = await win.webContents.session.cookies.get({ domain: host });
        cookieCount = cookies.length;
      } catch {
        cookieCount = 0;
      }
      resolve({ closed: true, url: win.webContents.getURL(), cookieCount });
    });

    void win.loadURL(url);
  });
}

export function closeAllBrowserWindows(): void {
  for (const win of openWindows) {
    if (!win.isDestroyed()) win.close();
  }
  openWindows.clear();
}
