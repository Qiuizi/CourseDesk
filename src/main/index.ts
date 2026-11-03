import { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Engine } from './core/engine';
import { registerIpc } from './core/ipc';
import { log } from './core/log';
import { closeAllBrowserWindows, openBrowserWindow } from './core/login';
import { configureNotificationPolicy, initNotifications, notify, setNotificationClickHandler } from './core/notify';
import { startUpdater, type UpdaterHandle } from './core/updater';
import { PARTITION } from './core/net';
import type { AppSnapshot } from '@shared/types';

const APP_NAME = 'CourseDesk';
const version = app.getVersion();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: Engine | null = null;
let updater: UpdaterHandle | null = null;
let quitting = false;
let quittingToastShown = false;

app.setName(APP_NAME);

// 自检 / 探针：用独立的 userData 目录并跳过单实例锁，避免和用户正在跑的实例打架
const ISOLATED = process.env['COURSEDESK_ISOLATED'] === '1';
if (ISOLATED) {
  app.setPath('userData', join(app.getPath('temp'), `coursedesk-probe-${process.pid}`));
}

function resourcePath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', file)
    : join(app.getAppPath(), 'resources', file);
}

function push(snap: AppSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:push', snap);
  }
  updateTray(snap);
}

function createMainWindow(): void {
  // 自检/截图时可以固定窗口尺寸：COURSEDESK_WINDOW=1280x860
  const [w, h] = (process.env['COURSEDESK_WINDOW'] ?? '').split('x').map((n) => Number(n));
  const width = Number.isFinite(w) && w >= 960 ? w : 1440;
  const height = Number.isFinite(h) && h >= 600 ? h : 920;

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0d0b',
    title: APP_NAME,
    icon: resourcePath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0d0b',
      symbolColor: '#9ae66e',
      height: 40,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    maybeScreenshot();
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    const closeToTray = engine?.snapshot().settings.behavior.closeToTray ?? true;
    if (!closeToTray) {
      // 用户在设置里关掉了「关闭到托盘」：直接退出
      quitting = true;
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
    log.info('app', '主窗口已隐藏到托盘（托盘菜单可退出）');
    if (!quittingToastShown) {
      quittingToastShown = true;
      notify({
        title: 'CourseDesk 还在后台',
        body: '窗口已收到托盘，开课 / 签到提醒照常推送；要退出请用托盘菜单。',
        silent: true,
      });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const initialTab = process.env['COURSEDESK_TAB'] ?? '';
  if (devUrl) {
    void mainWindow.loadURL(initialTab ? `${devUrl}#${initialTab}` : devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), initialTab ? { hash: initialTab } : {});
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

/** 开机自启由系统设置决定，改设置后立刻生效 */
function applyBehavior(settings: AppSnapshot['settings']): void {
  try {
    app.setLoginItemSettings({ openAtLogin: settings.behavior.launchAtLogin, args: ['--hidden'] });
  } catch (err) {
    log.warn('app', '设置开机自启失败', String(err));
  }
}

function buildTray(): void {
  try {
    tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')));
    tray.setToolTip(`${APP_NAME} · 双平台课程工作台`);
    tray.on('click', () => showWindow());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示工作台', click: () => showWindow() },
        { type: 'separator' },
        {
          label: '重新探测登录态',
          click: () => void engine?.probeAll(true),
        },
        {
          label: '检查更新',
          click: () => void updater?.check(true),
        },
        {
          label: '立即刷新双平台',
          click: () => {
            void engine?.refreshYuketang();
            void engine?.refreshChaoxing();
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  } catch (err) {
    log.warn('app', '托盘创建失败（继续运行）', String(err));
  }
}

function updateTray(snap: AppSnapshot): void {
  if (!tray || tray.isDestroyed()) return;
  const onLesson = snap.yuketang.onLesson.length;
  const signs = snap.chaoxing.actives.filter((a) => a.ongoing).length;
  tray.setToolTip(
    `${APP_NAME}\n雨课堂在课 ${onLesson} · 学习通活动 ${signs}\n监控 ${snap.yuketang.monitor.running ? '运行中' : '已暂停'}`,
  );
}

/** 开发自检：设置 COURSEDESK_SHOT 后启动→截图→退出，用于验证渲染结果 */
async function maybeScreenshot(): Promise<void> {
  const target = process.env['COURSEDESK_SHOT'];
  if (!target || !mainWindow) return;
  const delay = Number(process.env['COURSEDESK_SHOT_DELAY'] ?? 3500);
  setTimeout(async () => {
    try {
      const image = await mainWindow!.webContents.capturePage();
      await writeFile(target, image.toPNG());
      log.info('app', `截图已保存 ${target}`);
    } catch (err) {
      log.error('app', '截图失败', String(err));
    } finally {
      // 自检路径直接硬退出：避免 shutdown 的异步清理把进程吊在半空
      app.exit(0);
    }
  }, delay);
}

const gotLock = ISOLATED ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    initNotifications();
    engine = new Engine(push);
    engine.browserWindowOpener = async (url, title) => {
      await openBrowserWindow(url, title);
    };
    await engine.init(version);

    setNotificationClickHandler(() => showWindow());
    updater = startUpdater(
      (state) => engine?.setUpdate(state),
      (kind, state) => {
        if (!engine?.snapshot().settings.notify.system) return;
        if (kind === 'available') {
          notify({ title: `发现新版本 ${state.version}`, body: '正在后台下载，完成后可以从设置里重启安装。' });
        }
        if (kind === 'downloaded') {
          notify({ title: `新版本 ${state.version} 已就绪`, body: '打开设置 → 更新 → 重启安装即可。' });
        }
      },
    );
    configureNotificationPolicy({
      isHidden: () => !mainWindow?.isVisible(),
      allowWhenHidden: () => engine?.snapshot().settings.behavior.notifyWhenHidden ?? true,
    });
    applyBehavior(engine.snapshot().settings);
    registerIpc({ engine, push, version, updater, onSettingsApplied: applyBehavior });
    createMainWindow();
    buildTray();

    try {
      globalShortcut.register('CommandOrControl+Shift+Y', () => showWindow());
    } catch {
      /* 快捷键被占用时忽略 */
    }

    // 页面里若有未捕获错误，写日志便于排错
    app.on('web-contents-created', (_e, contents) => {
      contents.on('render-process-gone', (_evt, details) => {
        log.error('app', '渲染进程崩溃', details.reason);
      });
    });

    log.info('app', `${APP_NAME} ${version} 已启动`, { partition: PARTITION });
  });

  app.on('activate', () => showWindow());

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    // 不做 preventDefault：退出必须立刻完成，否则单实例锁会让下一个实例挂住。
    // 状态每 250ms 防抖落盘，这里只做尽力而为的收尾。
    globalShortcut.unregisterAll();
    closeAllBrowserWindows();
    try {
      void engine?.shutdown();
    } catch (err) {
      log.error('app', '退出清理失败', String(err));
    }
  });

  app.on('window-all-closed', () => {
    // 常驻托盘：不自动退出
  });

  process.on('uncaughtException', (err) => {
    log.error('app', 'uncaughtException', err.stack ?? String(err));
  });
  process.on('unhandledRejection', (reason) => {
    log.error('app', 'unhandledRejection', String(reason));
  });
}
