/**
 * 刷课状态机 + 落盘校验的单元测试。
 *
 * 运行：npm test（node --test，Node ≥ 22 原生剥离 TS 类型）
 * 计时器由测试注入，不需要真的等 10 秒。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { VideoFarmRunner } from '../src/main/core/farm.ts';
import { normalizeBaselines, normalizeFarmItem, normalizeProgress, normalizeQueue } from '../src/main/core/state.ts';
import { normalizeHost } from '../src/main/platforms/yuketang/normalize.ts';

function harness(options = {}) {
  const videos = options.videos ?? [{ videoId: 'v1', duration: 60, name: '第一段' }];
  const ok = options.ok ?? true;
  const events = [];
  const saved = new Map();
  const timers = [];
  const snap = {
    yuketang: {
      lesson: null,
      videoFarm: {
        status: 'idle',
        speed: 2,
        tickSec: 10,
        items: [],
        currentIndex: 0,
        autoStarted: false,
      },
    },
    settings: {
      yuketang: {
        videoHeartbeat: true,
        video: { speed: 2, tickSec: 10, autoStart: false },
      },
    },
  };

  const host = {
    snapshot: () => snap,
    savedProgress: (key) => saved.get(key),
    saveProgress: (key, value) => saved.set(key, value),
    userId: () => 'u-1',
    heartbeat: async (batch) => {
      events.push(...batch);
      return { ok, msg: ok ? 'ok' : '服务端拒绝' };
    },
    presentation: async () => ({ videos }),
    activePresentation: async () => '',
    emit: (event) => events.push({ emit: event.title }),
    notify: () => {},
    pushSoon: () => {},
    persist: () => {},
    isStopped: () => false,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return { cancel: () => {} };
    },
  };

  return { snap, host, runner: new VideoFarmRunner(host), events, saved, timers };
}

test('start：拉课件建队列，留空时用当前课堂的课件', async () => {
  const active = [];
  const { snap, host, runner } = harness();
  host.activePresentation = async (lessonId) => {
    active.push(lessonId);
    return 'p-active';
  };
  snap.yuketang.lesson = { lessonId: 'L1' };

  const res = await runner.start('');
  assert.equal(res.ok, true);
  assert.equal(res.queued, 1);
  assert.deepEqual(active, ['L1']);
  assert.equal(snap.yuketang.videoFarm.status, 'running');
  assert.equal(snap.yuketang.videoFarm.items[0].presentationId, 'p-active');
});

test('start：开关关闭 / 没有 user_id 时只写回原因，不建队列', async () => {
  const { snap, runner } = harness();
  snap.settings.yuketang.videoHeartbeat = false;
  const off = await runner.start('p1');
  assert.equal(off.ok, false);
  assert.match(snap.yuketang.videoFarm.lastError, /允许上报视频进度/);

  snap.settings.yuketang.videoHeartbeat = true;
  const noUser = await harness();
  noUser.host.userId = () => '';
  const res = await noUser.runner.start('p1');
  assert.equal(res.ok, false);
  assert.match(noUser.snap.yuketang.videoFarm.lastError, /user_id/);
});

test('tick：一批心跳推进游标，cp 单调且位置落盘', async () => {
  const { snap, runner, saved } = harness();
  await runner.start('p1');
  await runner.tick();

  const item = snap.yuketang.videoFarm.items[0];
  assert.ok(item.position > 0, '位置应前进');
  assert.ok(item.sentTicks > 0, '应记录已发条数');
  assert.ok(saved.get('p1|v1').position > 0, '断点应写入');
  assert.ok(item.percent > 0 && item.percent < 100);
});

test('tick：反复推进直到片尾，队列标记完成', async () => {
  const { snap, runner } = harness();
  await runner.start('p1');
  for (let i = 0; i < 200 && snap.yuketang.videoFarm.status === 'running'; i += 1) {
    await runner.tick();
  }
  const farm = snap.yuketang.videoFarm;
  assert.equal(farm.status, 'done');
  assert.equal(farm.items[0].done, true);
  assert.equal(farm.items[0].percent, 100);
});

test('tick：连续失败 3 次后暂停并记错误', async () => {
  const { snap, runner } = harness({ ok: false });
  await runner.start('p1');
  for (let i = 0; i < 3; i += 1) await runner.tick();

  const farm = snap.yuketang.videoFarm;
  assert.equal(farm.status, 'error');
  assert.match(farm.lastError, /上报失败/);
  assert.equal(farm.items[0].attempts, 3);
});

test('skip：跳过当前视频后队列前进', async () => {
  const { snap, runner } = harness({
    videos: [
      { videoId: 'v1', duration: 60, name: '第一段' },
      { videoId: 'v2', duration: 60, name: '第二段' },
    ],
  });
  await runner.start('p1');
  runner.skip();
  const farm = snap.yuketang.videoFarm;
  assert.equal(farm.items[0].skipped, true);
  assert.equal(farm.currentIndex, 1);
  assert.equal(farm.status, 'running');
});

test('maybeAuto：自动开刷只在开关都打开时生效，重复课件不重复入队', async () => {
  const { snap, host, runner } = harness();
  runner.maybeAuto('p1', [{ videoId: 'v1', duration: 60 }]);
  assert.equal(snap.yuketang.videoFarm.items.length, 0, 'autoStart 关闭时不应入队');

  snap.settings.yuketang.video.autoStart = true;
  host.snapshot = () => snap;
  runner.maybeAuto('p1', [{ videoId: 'v1', duration: 60 }]);
  assert.equal(snap.yuketang.videoFarm.items.length, 1);
  assert.equal(snap.yuketang.videoFarm.status, 'running');

  runner.maybeAuto('p1', [{ videoId: 'v1', duration: 60 }]);
  assert.equal(snap.yuketang.videoFarm.items.length, 1, '同一视频不重复加');
});

test('normalizeProgress：丢掉过期与坏值，限制总条数', () => {
  const now = Date.now();
  const out = normalizeProgress({
    'p1|v1': { position: 12.5, done: false, at: now },
    'p2|v2': { position: Number.NaN, done: false, at: now },
    'p3|v3': { position: 10, done: false, at: now - 90 * 86_400_000 },
    bad: { position: 1, done: false, at: now },
    'p4|v4': 'nope',
  });
  assert.deepEqual(Object.keys(out), ['p1|v1']);
  assert.equal(out['p1|v1'].position, 12.5);
});

test('normalizeQueue：坏项丢弃、下标夹紧、重启回到暂停可用的形状', () => {
  const queue = normalizeQueue({
    currentIndex: 99,
    at: 123,
    items: [
      { presentationId: 'p1', videoId: 'v1', duration: 60, position: 30, percent: 50, done: false },
      { presentationId: '', videoId: 'v2' },
      null,
    ],
  });
  assert.ok(queue);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.currentIndex, 0);
  assert.equal(queue.at, 123);
});

test('normalizeFarmItem：时长缺失回落 600，位置不越界', () => {
  const item = normalizeFarmItem({ presentationId: 'p1', videoId: 'v1', duration: 0, position: 9999 });
  assert.ok(item);
  assert.equal(item.duration, 600);
  assert.equal(item.position, 600);
  assert.equal(item.attempts, 0);
});

test('normalizeHost：只留主机名，脏输入回落到默认域', () => {
  assert.equal(normalizeHost('https://Pro.YuKeTang.cn/api/x?y=1'), 'pro.yuketang.cn');
  assert.equal(normalizeHost('school.edu.cn:8443'), 'school.edu.cn:8443');
  assert.equal(normalizeHost('https://www.yuketang.cn:443'), 'www.yuketang.cn');
  assert.equal(normalizeHost(''), 'www.yuketang.cn');
  assert.equal(normalizeHost('localhost'), 'www.yuketang.cn');
  assert.equal(normalizeHost('http://127.0.0.1/'), 'www.yuketang.cn');
});

test('normalizeBaselines：脏值不进运行态，paths 一定是数组', () => {
  const out = normalizeBaselines({
    ok: { hash: 'h1', paths: ['a', 1, 'b'], at: 123 },
    noHash: { paths: [], at: 123 },
    noAt: { hash: 'h2', paths: [] },
    bad: 'x',
  });
  assert.deepEqual(Object.keys(out), ['ok']);
  assert.deepEqual(out.ok.paths, ['a', 'b']);
  assert.deepEqual(normalizeBaselines(null), {});
});
