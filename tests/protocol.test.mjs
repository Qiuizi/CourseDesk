/**
 * 协议层纯函数单元测试。
 *
 * 运行：npm test（内部走 node --test，Node ≥ 22 原生剥离 TS 类型，无需编译）
 * 覆盖点都是"改错了会静默失败"的地方：签到加密、答案提交体、心跳字段、课程归一化。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';

import { aesEncrypt, CHAOXING_AES_KEY } from '../src/main/platforms/chaoxing/crypto.ts';
import {
  buildResult,
  inferBlankCount,
  normalizeCourseList,
  normalizeProblem,
} from '../src/main/platforms/yuketang/normalize.ts';
import {
  dedupeEvents,
  deepMerge,
  parseAnswerArray,
} from '../src/main/core/pure.ts';
import {
  buildHeartbeatBatch,
  createCursor,
  estimateRemainingSec,
  parsePresentationIds,
  tickDelay,
} from '../src/main/core/videofarm.ts';

/* ------------------------------------------------------------ 学习通登录加密 */

test('AES-128-CBC 与独立实现（Python cryptography）一致', () => {
  // 期望值由 Python cryptography 独立算出，不是自证
  assert.equal(aesEncrypt('13800138000'), 'yYcVatS+4J+JGnm88UM56A==');
});

test('AES 可逆且使用 PKCS7 填充', () => {
  const plain = 'p@ssw0rd-中文';
  const enc = aesEncrypt(plain);
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(CHAOXING_AES_KEY, 'utf8'),
    Buffer.from(CHAOXING_AES_KEY, 'utf8'),
  );
  const out = Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
  assert.equal(out, plain);
});

/* ------------------------------------------------------------ 答案提交体 */

test('单选/多选/投票：字母去重升序', () => {
  assert.deepEqual(buildResult(1, ['a'], []), ['A']);
  assert.deepEqual(buildResult(2, ['C', 'a', 'C'], []), ['A', 'C']);
  assert.deepEqual(buildResult(3, ['B'], []), ['B']);
  assert.deepEqual(buildResult(6, ['a'], []), ['A']);
});

test('填空题按空顺序提交文本数组', () => {
  assert.deepEqual(buildResult(4, ['牛顿'], ['牛顿']), ['牛顿']);
  assert.deepEqual(buildResult(4, ['A', 'B'], []), ['A', 'B']);
});

test('主观题提交对象结构（content/pics/videos）', () => {
  const r = buildResult(5, ['第一行', '第二行'], []);
  assert.equal(typeof r, 'object');
  assert.equal(r.content, '第一行\n第二行');
  assert.deepEqual(r.pics, [{ pic: '' }]);
  assert.deepEqual(r.videos, []);
});

/* ------------------------------------------------------------ 模型输出解析 */

test('parseAnswerArray 容忍 ```json 包裹', () => {
  assert.deepEqual(parseAnswerArray('```json\n["A","B"]\n```'), ['A', 'B']);
});

test('parseAnswerArray 容忍纯字母回答', () => {
  assert.deepEqual(parseAnswerArray('A, C'), ['A', 'C']);
  assert.deepEqual(parseAnswerArray('A'), ['A']);
});

test('parseAnswerArray 无 JSON 时退化取首行', () => {
  assert.deepEqual(parseAnswerArray('牛顿第二定律'), ['牛顿第二定律']);
});

/* ------------------------------------------------------------ 课程归一化 */

test('normalizeCourseList 从嵌套结构里提取课程', () => {
  const payload = {
    code: 0,
    data: {
      list: [
        { course_id: '1001', course_name: '高等数学', classroom_id: '2001', teacher_name: '张老师' },
        { course: { courseId: '1002', courseName: '大学物理' }, classroomId: '2002' },
        { course_id: '1001', course_name: '重复课程' },
      ],
    },
  };
  const out = normalizeCourseList(payload);
  assert.equal(out.length, 2, '重复 course_id 应被去重');
  assert.equal(out[0].id, '1001');
  assert.equal(out[0].name, '高等数学');
  assert.equal(out[0].classId, '2001');
  assert.equal(out[1].id, '1002');
  assert.equal(out[1].name, '大学物理');
});

test('normalizeCourseList 空载荷返回空数组', () => {
  assert.deepEqual(normalizeCourseList(null), []);
  assert.deepEqual(normalizeCourseList({}), []);
});

/* ------------------------------------------------------------ 题目归一化 */

test('normalizeProblem 提取题干、选项、题型', () => {
  const p = normalizeProblem(
    {
      problemId: '9001',
      problemType: 1,
      body: '1+1=?',
      options: [
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
      ],
    },
    3,
  );
  assert.equal(p.problemId, '9001');
  assert.equal(p.problemType, 1);
  assert.equal(p.body, '1+1=?');
  assert.equal(p.slideIndex, 3);
  assert.equal(p.options.length, 2);
  assert.equal(p.submitState, 'pending');
});

test('inferBlankCount 按下划线/空括号估算空数', () => {
  assert.equal(inferBlankCount('____ 与 ______'), 2);
  assert.equal(inferBlankCount('没有空的题干'), 1);
});

/* ------------------------------------------------------------ 视频心跳 */

/** 固定时钟：所有时间断言都相对它，避免受本机时间影响 */
const AT = Date.UTC(2025, 0, 1, 8, 0, 0);

test('buildHeartbeatBatch 首批：开播状态事件 + 边界心跳，cp 单调', () => {
  const cursor = createCursor('v1', AT);
  const batch = buildHeartbeatBatch(
    { videoId: 'v1', duration: 60 },
    cursor,
    { userId: 'u1', at: AT, elapsedSec: 10, speed: 2 },
  );
  // 2× × 10s = 推进 20s：4 条开播事件 + 15s + 20s
  assert.equal(batch.events.length, 6);
  assert.equal(batch.events[0].et, 'loadstart');
  assert.equal(batch.events[0].i, 20);
  assert.equal(batch.events[0].p, 'web');
  assert.equal(batch.events[0].u, 'u1');
  assert.equal(batch.events[0].pg, cursor.session);
  assert.equal(batch.cursor.position, 20);
  assert.equal(batch.done, false);
  assert.equal(batch.advanced, 20);
  const cps = batch.events.map((e) => e.cp);
  assert.deepEqual(cps, [...cps].sort((a, b) => a - b), 'cp 必须单调不减');
  assert.ok(
    batch.events.every((e) => e.ts <= AT),
    'ts 不得指向未来',
  );
  const tss = batch.events.map((e) => e.ts);
  assert.deepEqual(tss, [...tss].sort((a, b) => a - b), 'ts 必须单调不减');
});

test('buildHeartbeatBatch 续跑：不回到 0，序号继续', () => {
  const cursor = { position: 20, seq: 6, session: 'v1_1' };
  const batch = buildHeartbeatBatch(
    { videoId: 'v1', duration: 60 },
    cursor,
    { userId: 'u1', at: AT, elapsedSec: 10, speed: 1 },
  );
  assert.equal(batch.events[0].et, 'heartbeat', '续跑不应重发 loadstart');
  assert.ok(batch.events[0].cp >= 20);
  assert.ok(batch.events.every((e) => e.cp >= 20));
  assert.equal(batch.events[0].n, 6);
  assert.equal(batch.cursor.position, 30);
});

test('buildHeartbeatBatch 到片尾即 done，且 cp 恰好等于时长', () => {
  const batch = buildHeartbeatBatch(
    { videoId: 'v3', duration: 60 },
    { position: 55, seq: 9, session: 'v3_1' },
    { userId: 'u3', at: AT, elapsedSec: 10, speed: 2 },
  );
  assert.equal(batch.done, true);
  assert.equal(batch.cursor.position, 60);
  assert.equal(batch.events.at(-1).cp, 60);
});

test('buildHeartbeatBatch 单批上限生效，剩余留给下一批', () => {
  const batch = buildHeartbeatBatch(
    { videoId: 'v4', duration: 3600 },
    createCursor('v4', AT),
    { userId: 'u4', at: AT, elapsedSec: 120, speed: 8, batchMax: 10 },
  );
  assert.equal(batch.events.length, 10);
  assert.ok(batch.cursor.position < 960, '被截断时游标只推进到本批最后一条');
  assert.ok(batch.cursor.position > 0);
});

test('buildHeartbeatBatch 时长缺失回落到 600s', () => {
  const batch = buildHeartbeatBatch(
    { videoId: 'v5', duration: 0 },
    createCursor('v5', AT),
    { userId: 'u5', at: AT, elapsedSec: 10, speed: 1 },
  );
  assert.equal(batch.cursor.position, 10);
  const last = buildHeartbeatBatch(
    { videoId: 'v5', duration: 0 },
    { position: 595, seq: 40, session: 'v5_1' },
    { userId: 'u5', at: AT, elapsedSec: 10, speed: 1 },
  );
  assert.equal(last.done, true);
  assert.equal(last.events.at(-1).cp, 600);
});

test('连续 tick 覆盖整段视频，cp 不回退也不跳空', () => {
  let cursor = createCursor('v6', AT);
  const all = [];
  let at = AT;
  for (let i = 0; i < 10; i += 1) {
    const batch = buildHeartbeatBatch(
      { videoId: 'v6', duration: 60 },
      cursor,
      { userId: 'u6', at, elapsedSec: 10, speed: 2 },
    );
    all.push(...batch.events);
    cursor = batch.cursor;
    if (batch.done) break;
    at += 10_000;
  }
  assert.equal(cursor.position, 60);
  assert.equal(cursor.seq, all.length);
  const cps = all.map((e) => e.cp);
  assert.deepEqual(cps, [...cps].sort((a, b) => a - b));
  assert.equal(cps.at(-1), 60);
  // 相邻心跳的媒体间隔不超过 15s
  const beats = all.filter((e) => e.et === 'heartbeat').map((e) => e.cp);
  for (let i = 1; i < beats.length; i += 1) {
    assert.ok(beats[i] - beats[i - 1] <= 15, `心跳间隔过大：${beats[i - 1]} → ${beats[i]}`);
  }
});

test('estimateRemainingSec 按倍速折算', () => {
  assert.equal(estimateRemainingSec(600, 0, 1), 600);
  assert.equal(estimateRemainingSec(600, 0, 2), 300);
  assert.equal(estimateRemainingSec(600, 500, 4), 25);
});

test('tickDelay 带 ±15% 抖动且有下限', () => {
  assert.equal(tickDelay(10, () => 0), 8500);
  assert.equal(tickDelay(10, () => 1), 11500);
  assert.equal(tickDelay(1, () => 0), 2550);
});

test('parsePresentationIds 支持多种分隔符并去重', () => {
  assert.deepEqual(parsePresentationIds('a1, b2\nc3，a1、d4；e5'), ['a1', 'b2', 'c3', 'd4', 'e5']);
  assert.deepEqual(parsePresentationIds(['p1', 'p1', ' p2 ']), ['p1', 'p2']);
  assert.deepEqual(parsePresentationIds('   '), []);
});

/* ------------------------------------------------------------ 事件去重 */

test('dedupeEvents 合并 3 分钟内的重复事件', () => {
  const base = { platform: 'yuketang', kind: 'auth', level: 'warn', title: '未登录', detail: 'x' };
  const events = [
    { ...base, id: 'a', at: 1_000 },
    { ...base, id: 'b', at: 2_000 },
    { ...base, id: 'c', at: 10_000_000 },
  ];
  const out = dedupeEvents(events);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[1].id, 'c');
});

/* ------------------------------------------------------------ 设置合并 */

test('deepMerge 递归合并对象、数组整体替换', () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] };
  const out = deepMerge(base, { nested: { y: 9 }, list: [3] });
  assert.equal(out.a, 1);
  assert.equal(out.nested.x, 1);
  assert.equal(out.nested.y, 9);
  assert.deepEqual(out.list, [3]);
});

test('deepMerge 忽略 undefined 字段', () => {
  const out = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 5 });
  assert.equal(out.a, 1);
  assert.equal(out.b, 5);
});
