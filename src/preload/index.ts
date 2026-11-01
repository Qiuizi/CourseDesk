import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';
import type { AppSnapshot, LogLine, Settings } from '@shared/types';

const api = {
  snapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke(IPC.snapshot),
  onSnapshot: (cb: (snap: AppSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, snap: AppSnapshot) => cb(snap);
    ipcRenderer.on(IPC.push, listener);
    return () => ipcRenderer.removeListener(IPC.push, listener);
  },
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsUpdate, patch),
  resetSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsReset),

  ytLogin: (): Promise<{ ok: boolean; msg: string }> => ipcRenderer.invoke(IPC.ytLogin),
  ytLogout: (): Promise<void> => ipcRenderer.invoke(IPC.ytLogout),
  ytRefresh: (): Promise<void> => ipcRenderer.invoke(IPC.ytRefresh),
  ytEnterLesson: (lessonId: string, classroomId: string, courseName?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.ytEnterLesson, lessonId, classroomId, courseName),
  ytOpenLessonPage: (lessonId: string): Promise<unknown> => ipcRenderer.invoke(IPC.ytOpenLessonPage, lessonId),
  ytAnswer: (problemId: string, result: unknown): Promise<{ ok: boolean; msg: string }> =>
    ipcRenderer.invoke(IPC.ytAnswer, problemId, result),
  ytAskAi: (problemId: string): Promise<{ ok: boolean; result?: unknown; message: string }> =>
    ipcRenderer.invoke(IPC.ytAskAi, problemId),
  ytVideoPush: (presentationId: string): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(IPC.ytVideoPush, presentationId),

  cxLogin: (phone: string, password: string): Promise<{ ok: boolean; msg: string }> =>
    ipcRenderer.invoke(IPC.cxLogin, phone, password),
  cxLoginWindow: (): Promise<{ ok: boolean; msg: string }> => ipcRenderer.invoke(IPC.cxLoginWindow),
  cxLogout: (): Promise<void> => ipcRenderer.invoke(IPC.cxLogout),
  cxRefresh: (): Promise<void> => ipcRenderer.invoke(IPC.cxRefresh),
  cxSign: (activeId: string): Promise<unknown> => ipcRenderer.invoke(IPC.cxSign, activeId),
  cxOpenCourse: (courseId: string, classId: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.cxOpenCourse, courseId, classId),

  toggleMonitors: (running: boolean): Promise<{ ok: boolean; running: boolean }> =>
    ipcRenderer.invoke(IPC.monitorToggle, running),

  aiTest: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke(IPC.aiTest),
  aiKeySet: (key: string): Promise<{ ok: boolean; hasKey: boolean }> => ipcRenderer.invoke(IPC.aiKeySet, key),

  driftCheck: (): Promise<{ ok: boolean; changed: number; checked: number }> =>
    ipcRenderer.invoke(IPC.driftCheck),
  driftAccept: (probeId?: string): Promise<{ ok: boolean; updated: number }> =>
    ipcRenderer.invoke(IPC.driftAccept, probeId),

  logs: (limit = 200): Promise<LogLine[]> => ipcRenderer.invoke(IPC.logsTail, limit),
  clearLogs: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.logsClear),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  appInfo: (): Promise<{ version: string; dataDir: string }> => ipcRenderer.invoke(IPC.appInfo),
};

export type CourseDeskApi = typeof api;

contextBridge.exposeInMainWorld('coursedesk', api);
