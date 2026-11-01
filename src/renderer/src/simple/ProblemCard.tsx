import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Problem } from '@shared/types';
import type { PageProps } from '../lib/store';
import { answerPreview, countdown, PROBLEM_TYPE } from '../lib/format';
import { SBadge, SBtn } from './ui';

/** 判断题在部分学校部署里不下发选项，这里补一对固定选项 */
const JUDGE_OPTIONS = [
  { key: 'A', value: '正确' },
  { key: 'B', value: '错误' },
];

const CHOICE_TYPES = new Set([1, 2, 3, 6]);

function lettersOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').map((v) => v.toUpperCase());
  if (typeof value === 'string') return Array.from(new Set(value.toUpperCase().match(/[A-F]/g) ?? []));
  return [];
}

function blanksOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value) return [value];
  return [];
}

/**
 * 普通模式的题目卡：选项直接点选，填空按空输入，主观题只出解析。
 * 提交体与开发者模式一致（单选 ["A"]、多选去重升序、填空按空序），
 * 但这里把「选什么」变成可见的交互，而不是让用户手打字母。
 */
export function ProblemCard({
  problem,
  call,
  now,
}: {
  problem: Problem;
  call: PageProps['call'];
  now: number;
}): ReactNode {
  const isChoice = CHOICE_TYPES.has(problem.problemType);
  const isMulti = problem.problemType === 2;
  const isBlank = problem.problemType === 4;
  const isEssay = problem.problemType === 5;
  const options = problem.options.length > 0 ? problem.options : problem.problemType === 6 ? JUDGE_OPTIONS : [];

  // 快照每 120ms 推一次，answer 的引用每次都变；用内容做 key，避免 AI 建议把用户手选覆盖掉
  const answerKey = useMemo(() => JSON.stringify(problem.answer ?? null), [problem.answer]);
  const suggested = useMemo(() => {
    if (problem.answer === undefined || problem.answer === null) return [];
    return isChoice ? lettersOf(problem.answer) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerKey, isChoice]);
  const suggestedKey = suggested.join(',');

  const [picked, setPicked] = useState<string[]>(() => lettersOf(problem.answer));
  const [blanks, setBlanks] = useState<string[]>(() => {
    const init = blanksOf(problem.answer);
    return Array.from({ length: Math.max(1, problem.blankCount || init.length || 1) }, (_, i) => init[i] ?? '');
  });
  const [text, setText] = useState(() => {
    const a = problem.answer as { content?: string } | undefined;
    return typeof a?.content === 'string' ? a.content : '';
  });
  const [busy, setBusy] = useState(false);

  // AI 给出建议答案时（confirm 档）把建议值填进交互控件；内容没变就不动用户的选择
  useEffect(() => {
    if (isChoice && suggestedKey) setPicked(suggestedKey.split(','));
    if (isBlank) {
      const s = blanksOf(problem.answer);
      if (s.length) {
        setBlanks(Array.from({ length: Math.max(1, problem.blankCount || s.length) }, (_, i) => s[i] ?? ''));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerKey, suggestedKey, isChoice, isBlank, problem.blankCount]);

  const live = problem.deadlineAt ? problem.deadlineAt - now > 0 : Boolean(problem.unlockedAt);
  const submitted = problem.submitState === 'submitted';
  const failed = problem.submitState === 'failed';

  const orderIndex = (key: string): number => {
    const i = options.findIndex((o) => o.key === key);
    return i < 0 ? 99 : i;
  };
  const ordered = [...picked].sort((a, b) => orderIndex(a) - orderIndex(b));
  const filled = blanks.map((b) => b.trim()).filter(Boolean);
  const payload = isChoice ? ordered : isBlank ? filled : undefined;
  const ready = isChoice ? ordered.length > 0 : isBlank ? filled.length > 0 : false;

  const toggle = (key: string): void => {
    if (submitted) return;
    setPicked((prev) => {
      if (!isMulti) return prev[0] === key ? [] : [key];
      return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    });
  };

  const submit = async (): Promise<void> => {
    if (!ready || busy || submitted) return;
    setBusy(true);
    try {
      await call((api) => api.ytAnswer(problem.problemId, payload));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`s-problem${live && !submitted ? ' is-live' : ''}`}>
      <div className="s-problem__top">
        <SBadge tone={submitted ? 'ok' : live ? 'warn' : 'idle'}>
          {PROBLEM_TYPE[problem.problemType] ?? `题型 ${problem.problemType}`}
        </SBadge>
        {problem.deadlineAt && <SBadge tone={live ? 'warn' : 'idle'}>{countdown(problem.deadlineAt, now)}</SBadge>}
        {problem.submitState === 'confirm' && <SBadge tone="info">待确认</SBadge>}
        {submitted && <SBadge tone="ok">已提交</SBadge>}
        {failed && <SBadge tone="err">提交失败</SBadge>}
        <span style={{ flex: 1 }} />
        <SBtn size="sm" variant="ghost" onClick={() => void call((api) => api.ytAskAi(problem.problemId))}>
          {isEssay ? '生成解析' : 'AI 帮助'}
        </SBtn>
      </div>

      <div className="s-problem__body">{problem.body || '题干加载中…'}</div>

      {isChoice && options.length > 0 && (
        <div className="s-problem__opts">
          {options.map((o) => {
            const isPicked = picked.includes(o.key);
            const isSuggested = !isPicked && suggested.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                className={`s-opt s-opt--pick${isPicked ? ' is-picked' : ''}${isSuggested ? ' is-suggested' : ''}`}
                onClick={() => toggle(o.key)}
                disabled={submitted}
                aria-pressed={isPicked}
              >
                <span className="s-opt__key">{o.key}</span>
                <span>{o.value}</span>
                {isSuggested && <span className="s-opt__tag">AI</span>}
              </button>
            );
          })}
        </div>
      )}

      {isBlank && (
        <div className="s-blanks">
          {blanks.map((v, i) => (
            <label className="s-blank" key={i}>
              <span className="s-blank__no">第 {i + 1} 空</span>
              <input
                className="s-input"
                value={v}
                disabled={submitted}
                spellCheck={false}
                placeholder={`填入第 ${i + 1} 空的答案`}
                onChange={(e) => setBlanks((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
            </label>
          ))}
        </div>
      )}

      {isEssay && (
        <textarea
          className="s-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="主观题需要手写或拍照提交；这里可以记下你的作答草稿，或点右上角生成解析"
        />
      )}

      {problem.answer !== undefined && problem.answer !== null && !isChoice && (
        <div className="s-problem__answer">参考答案 · {answerPreview(problem)}</div>
      )}

      {problem.aiAnalysis && <div className="s-problem__analysis">{problem.aiAnalysis}</div>}

      <div className="s-problem__foot">
        {isEssay ? (
          <span className="s-problem__hint">主观题不会自动提交 —— 需要在课堂里手写拍照</span>
        ) : submitted ? (
          <span className="s-problem__state s-problem__state--ok">已提交 · {problem.submitMessage ?? '成功'}</span>
        ) : (
          <>
            <SBtn size="sm" variant="primary" busy={busy} disabled={!ready} onClick={() => void submit()}>
              提交答案
            </SBtn>
            {suggested.length > 0 && !isMulti && (
              <SBtn size="sm" variant="soft" onClick={() => setPicked(suggested)}>
                采用 AI 答案
              </SBtn>
            )}
            <span className="s-problem__hint">
              {ready
                ? `将提交 ${isChoice ? ordered.join('') || '—' : payload?.join(' / ')}`
                : isChoice
                  ? isMulti
                    ? '可多选，选好后提交'
                    : '选一项后提交'
                  : '填空后提交'}
            </span>
          </>
        )}
        {failed && problem.submitMessage && (
          <span className="s-problem__state s-problem__state--err">{problem.submitMessage}</span>
        )}
      </div>
    </div>
  );
}
