/**
 * AI 作答（OpenAI 兼容 /chat/completions）。
 *
 * 只做"把题目变成答案字符串数组"这一件事，提交策略由 engine 决定：
 *  - auto：AI 结果直接提交（仅客观题）
 *  - confirm：填进 UI，等人点提交
 *  - off：不调 AI，纯人工
 * 主观题（type=5）永远只生成解析文本，不生成提交体。
 */

import type { AiSettings, Problem } from '@shared/types';
import { log } from './log';
import { PROBLEM_TYPE_LABEL } from '../platforms/yuketang/endpoints';

export interface AiReply {
  ok: boolean;
  text: string;
  latencyMs: number;
  error?: string;
}

const SYSTEM_PROMPT = [
  '你是一个严谨的学科助教，负责解课堂小测题。',
  '只输出结论，不要寒暄、不要解释你的解题过程。',
  '必须严格按用户要求的格式返回。',
].join('\n');

function optionsBlock(problem: Problem): string {
  if (!problem.options.length) return '';
  return `\n选项：\n${problem.options.map((o) => `${o.key}. ${o.value}`).join('\n')}`;
}

export function buildPrompt(problem: Problem): { system: string; user: string } {
  const typeLabel = PROBLEM_TYPE_LABEL[problem.problemType] ?? '未知题型';
  const isChoice = problem.problemType === 1 || problem.problemType === 2 || problem.problemType === 3;
  const isBlank = problem.problemType === 4;
  const isJudgement = problem.problemType === 6;

  if (problem.problemType === 5) {
    return {
      system: SYSTEM_PROMPT,
      user: [
        `题型：${typeLabel}（主观题）`,
        '请给出可以直接抄写到答题纸上的完整参考答案：分点、有推理步骤、关键结论加粗；数学公式用 LaTeX。',
        `\n题目：\n${problem.body}${optionsBlock(problem)}`,
      ].join('\n'),
    };
  }

  const format = isBlank
    ? `返回 JSON 数组，长度等于空数（${problem.blankCount || 1}），每项是一个空的答案文本，例如 ["答案1","答案2"]。`
    : isChoice
      ? '返回 JSON 数组，元素是选项字母（大写、去重、升序），例如 ["A"] 或 ["A","C"]。'
      : isJudgement
        ? '返回 JSON 数组，元素是 "A"（正确）或 "B"（错误），只给一个。'
        : '返回 JSON 数组，元素为答案文本。';

  return {
    system: SYSTEM_PROMPT,
    user: [
      `题型：${typeLabel}`,
      format,
      '即使信息不足也必须给出一个最可能的答案，不要留空、不要输出其它内容。',
      `\n题目：\n${problem.body}${optionsBlock(problem)}`,
    ].join('\n'),
  };
}

export async function callAi(
  settings: AiSettings,
  apiKey: string,
  messages: { system: string; user: string },
): Promise<AiReply> {
  const started = Date.now();
  if (!settings.enabled) return { ok: false, text: '', latencyMs: 0, error: 'AI 未启用' };
  if (!apiKey) return { ok: false, text: '', latencyMs: 0, error: '缺少 API Key' };

  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (settings.timeoutSec || 30) * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      log.warn('ai', `接口返回 ${res.status}`, text.slice(0, 300));
      return { ok: false, text: '', latencyMs: Date.now() - started, error: `HTTP ${res.status}` };
    }
    const json = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) {
      return { ok: false, text: '', latencyMs: Date.now() - started, error: '模型返回空内容' };
    }
    return { ok: true, text: content, latencyMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('ai', '调用失败', message);
    return { ok: false, text: '', latencyMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export { parseAnswerArray } from './pure';
