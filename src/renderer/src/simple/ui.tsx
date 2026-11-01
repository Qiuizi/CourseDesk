import { useEffect, useState, type ReactNode } from 'react';

/** 普通模式的浅色原语：与开发者模式（控制室深色）完全隔离，不共用 class */

type Tone = 'idle' | 'ok' | 'warn' | 'err' | 'info';

export function SDot({ tone = 'idle' }: { tone?: Tone }): ReactNode {
  return <span className={`s-dot s-dot--${tone}`} aria-hidden />;
}

export function SBadge({ tone = 'idle', children }: { tone?: Tone; children: ReactNode }): ReactNode {
  return <span className={`s-badge s-badge--${tone}`}>{children}</span>;
}

export function SCard({
  title,
  hint,
  actions,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  pad?: boolean;
}): ReactNode {
  return (
    <section className={`s-card${pad ? '' : ' s-card--flush'} ${className}`}>
      {(title || actions) && (
        <header className="s-card__head">
          <div className="s-card__titles">
            {title && <h2 className="s-card__title">{title}</h2>}
            {hint && <p className="s-card__hint">{hint}</p>}
          </div>
          {actions && <div className="s-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SBtn({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  busy = false,
  full = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  busy?: boolean;
  full?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className={`s-btn s-btn--${variant} s-btn--${size}${full ? ' s-btn--full' : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy && <span className="s-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function SEmpty({
  title,
  hint,
  compact = false,
}: {
  title: string;
  hint?: string;
  compact?: boolean;
}): ReactNode {
  return (
    <div className={`s-empty${compact ? ' s-empty--row' : ''}`}>
      <svg viewBox="0 0 48 48" className="s-empty__art" aria-hidden>
        <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 5" />
        <circle cx="24" cy="24" r="4" fill="currentColor" opacity="0.28" />
      </svg>
      <div>
        <div className="s-empty__title">{title}</div>
        {hint && <div className="s-empty__hint">{hint}</div>}
      </div>
    </div>
  );
}

export function SRow({
  leading,
  title,
  sub,
  trailing,
}: {
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <div className="s-row">
      {leading && <div className="s-row__lead">{leading}</div>}
      <div className="s-row__main">
        <div className="s-row__title">{title}</div>
        {sub && <div className="s-row__sub">{sub}</div>}
      </div>
      {trailing && <div className="s-row__trail">{trailing}</div>}
    </div>
  );
}

export function SField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="s-field">
      <span className="s-field__label">{label}</span>
      {children}
      {hint && <span className="s-field__hint">{hint}</span>}
    </label>
  );
}

export function SToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}): ReactNode {
  return (
    <label className="s-toggle">
      <span className="s-toggle__text">
        <span className="s-toggle__label">{label}</span>
        {hint && <span className="s-toggle__hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="s-switch" aria-hidden>
        <span className="s-switch__dot" />
      </span>
    </label>
  );
}

export function SInput({
  value,
  onCommit,
  placeholder,
  type = 'text',
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
}): ReactNode {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className="s-input"
      type={type}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function SSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}): ReactNode {
  return (
    <select className="s-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SMeter({ value, max = 100, tone = 'ok' }: { value: number; max?: number; tone?: Tone }): ReactNode {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <span className="s-meter">
      <span className={`s-meter__fill s-meter__fill--${tone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
