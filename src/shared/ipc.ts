/** 主进程 ↔ 渲染进程 通道定义（单一事实源） */

export const IPC = {
  snapshot: 'app:snapshot',
  push: 'app:push',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',

  ytLogin: 'yt:login',
  ytLogout: 'yt:logout',
  ytRefresh: 'yt:refresh',
  ytEnterLesson: 'yt:enter-lesson',
  ytOpenLessonPage: 'yt:open-lesson-page',
  ytAnswer: 'yt:answer',
  ytAskAi: 'yt:ask-ai',
  ytWatchHomework: 'yt:watch-homework',
  ytVideoPush: 'yt:video-push',

  cxLogin: 'cx:login',
  cxLoginWindow: 'cx:login-window',
  cxLogout: 'cx:logout',
  cxRefresh: 'cx:refresh',
  cxSign: 'cx:sign',
  cxOpenCourse: 'cx:open-course',

  monitorToggle: 'monitor:toggle',
  aiTest: 'ai:test',
  aiKeySet: 'ai:key-set',
  driftCheck: 'drift:check',
  driftAccept: 'drift:accept',
  logsTail: 'logs:tail',
  logsClear: 'logs:clear',
  openExternal: 'shell:open',
  appInfo: 'app:info',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface CxLoginPayload {
  phone: string;
  password: string;
}

export interface YtAnswerPayload {
  problemId: string;
  result: unknown;
}
