/**
 * CDP 探针：跑一次真实 Electron 窗口，执行表达式并抓 console / 截图。
 *
 *   node scripts/probe.mjs --mode simple --tab today --expr "document.title"
 *   node scripts/probe.mjs --mode simple --tab log --shot shots/probe.png --width 1280 --height 860
 *
 * 用途：验证样式真的生效（比如 CSS 注释写坏会导致整段规则被吞）、
 * 确认渲染进程没有 console error、量出具体元素尺寸。
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const exe = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const statePath = join(process.env.APPDATA ?? '', 'CourseDesk', 'state.json');

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const mode = arg('mode', 'simple');
const tab = arg('tab', 'today');
const expr = arg('expr', '({ url: location.href, title: document.title })');
const shot = arg('shot', '');
const width = Number(arg('width', '1440'));
const height = Number(arg('height', '920'));
const port = Number(arg('port', '9333'));
const waitMs = Number(arg('wait', '1600'));
const demo = arg('demo', '') === '1' || argv.includes('--demo');

await mkdir(dirname(resolve(shot || 'shots/x.png')), { recursive: true });

let state = { version: 1, settings: {}, secrets: {}, events: [], cache: {} };
try {
  state = JSON.parse(await readFile(statePath, 'utf8'));
} catch {
  /* 首次运行没有 state.json，用最小骨架 */
}
state.settings = state.settings ?? {};
state.settings.ui = { ...(state.settings.ui ?? {}), mode };
await mkdir(dirname(statePath), { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

const customExe = arg('exe', '');
const child = spawn(customExe || exe, customExe ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`], {
  cwd: root,
  env: {
    ...process.env,
    COURSEDESK_TAB: tab,
    COURSEDESK_WINDOW: `${width}x${height}`,
    COURSEDESK_ISOLATED: '1',
    ...(demo ? { COURSEDESK_DEMO: '1' } : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => (stderr += String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 端口还没起来 */
    }
    await sleep(150);
  }
  throw new Error('CDP target 未出现');
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(new Error(`ws error ${e?.message ?? ''}`));
  });
}

const page = await target();
const ws = await connect(page.webSocketDebuggerUrl);

let seq = 0;
const pending = new Map();
const logs = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: ok, reject: bad } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) bad(new Error(msg.error.message));
    else ok(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push({
      type: msg.params.type,
      text: msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
    });
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push({ type: 'exception', text: msg.params.exceptionDetails?.text ?? 'exception' });
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push({ type: `log:${msg.params.entry.level}`, text: msg.params.entry.text });
  }
};

const send = (method, params = {}) =>
  new Promise((ok, bad) => {
    const id = ++seq;
    pending.set(id, { resolve: ok, reject: bad });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await sleep(waitMs);

let value;
let evalError = null;
try {
  const res = await send('Runtime.evaluate', {
    expression: `(() => { ${expr.includes('return') ? expr : `return (${expr});`} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  value = res.result?.value;
  if (res.exceptionDetails) evalError = res.exceptionDetails.text ?? 'evaluate failed';
} catch (err) {
  evalError = String(err);
}

if (shot) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(shot), Buffer.from(png.data, 'base64'));
  console.log(`[shot] ${resolve(shot)}`);
}

console.log(JSON.stringify({ url: page.url, value, evalError, logs }, null, 2));

ws.close();
child.kill('SIGKILL');
await sleep(300);
if (stderr.trim()) console.log('[stderr]', stderr.trim().split('\n').slice(-5).join('\n'));
process.exit(0);
