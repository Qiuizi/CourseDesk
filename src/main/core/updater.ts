import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '@shared/types';
import { log } from './log';

/**
 * 自动更新：electron-updater + GitHub Releases。
 *
 * - 只有装了 NSIS 安装包才真正能升级；portable 版靠下载新文件（会明确提示）。
 * - 启动 12 秒后第一次查，之后每 4 小时一次；也可以从设置里手动查。
 * - 下载走后台，装的时候 quitAndInstall()。
 */

export interface UpdaterHandle {
  check: (manual?: boolean) => Promise<UpdateState>;
  install: () => void;
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** electron-updater 的报错带整段堆栈，界面里只留一句人话 */
function humanize(raw: string): string {
  if (/404/.test(raw) && /latest\.yml/i.test(raw)) return '这次发布缺少 latest.yml，暂时无法检查更新';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|net::/i.test(raw)) return '网络不可达，稍后再试';
  if (/sha512|checksum/i.test(raw)) return '安装包校验失败，请重新下载';
  const line = raw.split('\n')[0].replace(/^Error:\s*/, '');
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}

export function startUpdater(
  sink: (state: UpdateState) => void,
  onEvent?: (kind: 'available' | 'downloaded', state: UpdateState) => void,
): UpdaterHandle {
  const portable = Boolean(process.env['PORTABLE_EXECUTABLE_FILE']);
  let latest: string | undefined;

  const report = (state: UpdateState): void => {
    sink(state);
  };

  if (!app.isPackaged) {
    report({ status: 'unsupported', message: '开发模式：从源码跑的时候不检查更新' });
    return { check: async () => ({ status: 'unsupported', message: '开发模式不检查更新' }), install: () => undefined };
  }

  if (portable) {
    report({ status: 'unsupported', message: '便携版不支持自动更新，请到 Releases 下载新版' });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => report({ status: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    latest = info.version;
    const state: UpdateState = { status: 'available', version: info.version, percent: 0 };
    report(state);
    onEvent?.('available', state);
  });

  autoUpdater.on('update-not-available', (info) => {
    report({ status: 'none', version: info?.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    report({ status: 'downloading', version: latest, percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    latest = info.version;
    const state: UpdateState = { status: 'downloaded', version: info.version, percent: 100 };
    report(state);
    onEvent?.('downloaded', state);
  });

  autoUpdater.on('error', (err) => {
    const raw = String(err?.message ?? err);
    log.warn('update', '检查更新失败', raw);
    report({ status: 'error', message: humanize(raw) });
  });

  const check = async (manual = false): Promise<UpdateState> => {
    if (portable) {
      const state: UpdateState = { status: 'unsupported', message: '便携版不支持自动更新，请到 Releases 下载新版' };
      if (manual) report(state);
      return state;
    }
    report({ status: 'checking' });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      log.warn('update', 'checkForUpdates 抛错', message);
      report({ status: 'error', message });
      return { status: 'error', message };
    }
    return { status: 'checking' };
  };

  const install = (): void => {
    log.info('update', '开始安装更新并重启');
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  };

  setTimeout(() => void check(false), 12_000);
  const timer = setInterval(() => void check(false), CHECK_INTERVAL_MS);
  timer.unref?.();

  return { check, install };
}
