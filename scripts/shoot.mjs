/**
 * 截图自检脚本：逐页启动 Electron → capturePage → 退出。
 * 用于验证渲染结果（不需要人工点窗口）。
 *
 *   node scripts/shoot.mjs overview yuketang chaoxing events settings
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const exe = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const outDir = join(root, 'shots');
await mkdir(outDir, { recursive: true });

const tabs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['overview', 'yuketang', 'chaoxing', 'events', 'settings'];
const delay = process.env.SHOT_DELAY ?? '6000';
const perTabTimeout = 45_000;

for (const tab of tabs) {
  const out = join(outDir, `${tab}.png`);
  const started = Date.now();
  const child = spawn(exe, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      COURSEDESK_TAB: tab,
      COURSEDESK_SHOT: out,
      COURSEDESK_SHOT_DELAY: delay,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('timeout');
    }, perTabTimeout);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c ?? 0);
    });
  });
  console.log(`[${tab}] exit=${code} in ${Date.now() - started}ms`);
  if (code !== 0 && stderr) console.log(stderr.split('\n').slice(-8).join('\n'));
}
console.log('shots dir:', outDir);
