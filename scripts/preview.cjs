/**
 * 任意 URL 的 Electron 预览/截图（不需要跑 App 主进程）。
 *
 *   node_modules/electron/dist/electron.exe scripts/preview.cjs -- <url> <out.png> [width] [height] [waitMs]
 *
 * 会打印 console 消息、页面尺寸，并可选执行 `PREVIEW_EXEC` 里的表达式。
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');

const argv = process.argv.slice(2).filter((a) => a !== '--');
const url = argv[0];
const out = argv[1];
const width = Number(argv[2] ?? 1440);
const height = Number(argv[3] ?? 1000);
const waitMs = Number(argv[4] ?? 1800);
const exec = process.env.PREVIEW_EXEC ?? '';

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: true,
    frame: false,
    backgroundColor: '#f6f7f3',
    webPreferences: { offscreen: false, sandbox: false, contextIsolation: true },
  });

  const logs = [];
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    logs.push({ level, message, line, source });
  });
  win.webContents.on('render-process-gone', (_e, details) => logs.push({ level: 'gone', message: details.reason }));

  try {
    await win.loadURL(url);
    await new Promise((r) => setTimeout(r, waitMs));
    if (exec) {
      const value = await win.webContents.executeJavaScript(exec, true);
      console.log(JSON.stringify({ exec: value }, null, 2));
    }
    const scroll = Number(process.env.PREVIEW_SCROLL ?? 0);
    if (scroll) {
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${scroll}); 1`, true);
      await new Promise((r) => setTimeout(r, 350));
    }
    const image = await win.capturePage();
    if (out) writeFileSync(out, image.toPNG());
    const [w, h] = win.getContentSize();
    console.log(JSON.stringify({ url, title: win.getTitle(), size: [w, h], out, logs }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ url, error: String(err), logs }, null, 2));
  } finally {
    app.exit(0);
  }
});
