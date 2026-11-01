/**
 * 双模式截图：node scripts/shoot2.mjs simple:today simple:settings dev:overview dev:drift
 * 通过预写 state.json 的 settings.ui.mode 控制初始界面。
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const exe = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const outDir = join(root, 'shots');
const statePath = join(process.env.APPDATA ?? '', 'CourseDesk', 'state.json');
await mkdir(outDir, { recursive: true });

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['simple:today'];
const delay = process.env.SHOT_DELAY ?? '6500';

for (const spec of targets) {
  const [mode, tab] = spec.split(':');
  let state = {};
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    state = { version: 1, settings: {}, secrets: {}, events: [], cache: {} };
  }
  state.settings = state.settings ?? {};
  state.settings.ui = { ...(state.settings.ui ?? {}), mode };
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

  const out = join(outDir, `${mode}-${tab}.png`);
  const started = Date.now();
  const child = spawn(exe, ['.'], {
    cwd: root,
    env: { ...process.env, COURSEDESK_TAB: tab, COURSEDESK_SHOT: out, COURSEDESK_SHOT_DELAY: delay },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (d) => (err += String(d)));
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('timeout');
    }, 45_000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c ?? 0);
    });
  });
  console.log(`[${mode}/${tab}] exit=${code} ${Date.now() - started}ms`);
  if (code !== 0 && err) console.log(err.split('\n').slice(-6).join('\n'));
}
console.log('done →', outDir);
