/**
 * IPC 网关：把引擎能力暴露给渲染进程。
 * 渲染进程只能通过这里定义的通道调用，没有 node 权限。
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { IPC } from '@shared/ipc';
import type { AppSnapshot, Settings } from '@shared/types';
import type { Engine } from './engine';
import { log } from './log';
import { notifyTest } from './notify';
import { openBrowserWindow } from './login';
import type { UpdaterHandle } from './updater';
import { yt } from '../platforms/yuketang/endpoints';
import { cx } from '../platforms/chaoxing/endpoints';

export interface IpcContext {
  engine: Engine;
  push: (snap: AppSnapshot) => void;
  version: string;
  updater: UpdaterHandle | null;
  onSettingsApplied: (settings: Settings) => void;
  onModeChanged: (mode: Settings['ui']['mode']) => void;
}

export function registerIpc(ctx: IpcContext): void {
  const { engine } = ctx;

  const handle = <T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...(args as never[]));
      } catch (err) {
        log.error('ipc', `${channel} 调用失败`, String(err));
        return { ok: false, msg: String(err) };
      }
    });
  };

  handle(IPC.snapshot, () => engine.snapshot());

  handle(IPC.settingsUpdate, (patch: Partial<Settings>) => {
    const next = engine.updateSettings(patch);
    ctx.onSettingsApplied(next);
    return next;
  });
  handle(IPC.settingsReset, () => {
    const next = engine.resetSettings();
    ctx.onSettingsApplied(next);
    return next;
  });
  handle(IPC.setMode, (mode: Settings['ui']['mode']) => engine.setMode(mode));

  // 渲染层把新界面画好之后，再换原生标题栏色块，避免切换瞬间闪一下
  handle(IPC.chromeReady, (mode: Settings['ui']['mode']) => {
    ctx.onModeChanged(mode);
    return { ok: true };
  });

  ipcMain.handle(IPC.winMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return { ok: true };
  });
  ipcMain.handle(IPC.winToggleMax, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false };
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true };
  });
  ipcMain.handle(IPC.winClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return { ok: true };
  });

  handle(IPC.quit, () => {
    setImmediate(() => app.quit());
    return { ok: true };
  });

  handle(IPC.updateCheck, () =>
    ctx.updater?.check(true) ?? { status: 'unsupported' as const, message: '更新模块未启动' },
  );
  handle(IPC.updateInstall, () => {
    ctx.updater?.install();
    return { ok: Boolean(ctx.updater) };
  });
  handle(IPC.notifyTest, () => notifyTest());

  handle(IPC.ytLogin, async () => {
    await engine.openYuketangHome();
    const logged = await engine.probeYuketang(true);
    return { ok: logged, msg: logged ? '已登录' : '窗口已关闭，仍未探测到登录态' };
  });
  handle(IPC.ytLogout, () => engine.logoutYuketang());
  handle(IPC.ytRefresh, () => engine.refreshYuketang());
  handle(IPC.ytEnterLesson, (lessonId: string, classroomId: string, courseName?: string) =>
    engine.enterLesson(lessonId, classroomId, courseName),
  );
  handle(IPC.ytOpenLessonPage, (lessonId: string) => {
    const { host, checkinSource } = engine.snapshot().settings.yuketang;
    return openBrowserWindow(yt.lessonPage(host, lessonId, checkinSource), '雨课堂 · 课堂');
  });
  handle(IPC.ytAnswer, (problemId: string, result: unknown) => engine.submitAnswer(problemId, result));
  handle(IPC.ytAskAi, (problemId: string) => engine.generateAnswer(problemId));
  handle(IPC.ytWatchHomework, () => engine.refreshYuketang());
  handle(IPC.ytVideoStart, (presentationIds: string | string[]) => engine.startVideoFarm(presentationIds));
  handle(IPC.ytVideoPause, () => engine.pauseVideoFarm());
  handle(IPC.ytVideoResume, () => engine.resumeVideoFarm());
  handle(IPC.ytVideoStop, () => engine.stopVideoFarm());
  handle(IPC.ytVideoSkip, () => engine.skipVideoFarm());
  handle(IPC.ytVideoSpeed, (speed: number) => engine.setVideoFarmSpeed(speed));

  handle(IPC.cxLogin, (phone: string, password: string) => engine.loginChaoxing(phone, password));
  handle(IPC.cxLoginWindow, async () => {
    const result = await openBrowserWindow(cx.loginPage, '学习通 · 登录');
    const logged = await engine.probeChaoxing(true);
    return { ok: logged, msg: logged ? '已登录' : `窗口已关闭（cookies ${result.cookieCount}），未探测到登录态` };
  });
  handle(IPC.cxLogout, () => engine.logoutChaoxing());
  handle(IPC.cxRefresh, () => engine.refreshChaoxing());
  handle(IPC.cxSign, (activeId: string) => engine.signActive(activeId, false));
  handle(IPC.cxOpenCourse, (courseId: string, classId: string) => engine.openChaoxingCourse(courseId, classId));

  handle(IPC.monitorToggle, (running: boolean) => {
    engine.toggleMonitors(running);
    return { ok: true, running };
  });

  handle(IPC.aiTest, () => engine.testAi());
  handle(IPC.aiKeySet, (key: string) => {
    engine.setAiKey(key);
    return { ok: true, hasKey: Boolean(key.trim()) };
  });

  handle(IPC.driftCheck, () => engine.runDrift(true));
  handle(IPC.driftAccept, (probeId?: string) => engine.acceptDrift(probeId));

  handle(IPC.logsTail, (limit: number) => log.tail(limit ?? 200));
  handle(IPC.logsClear, () => {
    log.clear();
    return { ok: true };
  });

  handle(IPC.openExternal, (url: string) => shell.openExternal(url));
  handle(IPC.appInfo, () => ({
    version: ctx.version,
    dataDir: log.dir(),
    userData: '',
  }));
}
