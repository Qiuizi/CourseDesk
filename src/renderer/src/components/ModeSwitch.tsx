import type { ReactNode } from 'react';

/**
 * 普通 / 开发者切换：拨动开关的样子，两个模式都能在顶栏一键切。
 * 样式在 styles.css（深色）与 simple.css（浅色）里各有一份。
 */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: 'simple' | 'dev';
  onChange: (mode: 'simple' | 'dev') => void;
}): ReactNode {
  const dev = mode === 'dev';
  return (
    <div className={`mode-switch${dev ? ' is-dev' : ''}`} role="group" aria-label="界面模式">
      <span className="mode-switch__thumb" aria-hidden />
      <button type="button" className={dev ? '' : 'is-on'} aria-pressed={!dev} onClick={() => onChange('simple')}>
        普通
      </button>
      <button type="button" className={dev ? 'is-on' : ''} aria-pressed={dev} onClick={() => onChange('dev')}>
        开发者
      </button>
    </div>
  );
}
