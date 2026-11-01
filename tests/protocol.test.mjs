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
  buildHeartbeatEvents,
  dedupeEvents,
  deepMerge,
  parseAnswerArray,
} from '../src/main/core/pure.ts';

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

test('buildHeartbeatEvents 生成完整播放器事件序列', () => {
  const events = buildHeartbeatEvents(
    [{ videoId: 'v1', duration: 60, presentationId: 'p1', slideIndex: 0 }],
    'u1',
    15,
  );
  // 6 条状态事件 + 3 条 interval 心跳（15/30/45）+ 1 条片尾
  assert.equal(events.length, 10);
  assert.equal(events[0].et, 'loadstart');
  assert.equal(events[0].i, 20);
  assert.equal(events[0].p, 'web');
  assert.equal(events[0].u, 'u1');
  assert.equal(events.at(-1).cp, 60, '最后一条应到片尾');
  const cps = events.map((e) => e.cp);
  assert.deepEqual(cps, [...cps].sort((a, b) => a - b), 'cp 必须单调不减');
});

test('buildHeartbeatEvents 时长缺失时回落到 600s', () => {
  const events = buildHeartbeatEvents(
    [{ videoId: 'v2', duration: 0, presentationId: 'p2', slideIndex: 1 }],
    'u2',
    30,
  );
  assert.equal(events.at(-1).cp, 600);
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
