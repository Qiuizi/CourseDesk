import { useEffect, useState, type ReactNode } from 'react';

type Tone = 'idle' | 'ok' | 'warn' | 'err' | 'info';

export function Lamp({ tone = 'idle', pulse = false }: { tone?: Tone; pulse?: boolean }): ReactNode {
  return <span className={`lamp lamp--${tone}${pulse ? ' lamp--pulse' : ''}`} aria-hidden />;
}

export function Pill({
  children,
  tone = 'idle',
  mono = false,
}: {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
}): ReactNode {
  return <span className={`pill pill--${tone}${mono ? ' pill--mono' : ''}`}>{children}</span>;
}

export function Panel({
  eyebrow,
  title,
  meta,
  actions,
  children,
  className = '',
  dense = false,
}: {
  eyebrow?: string;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  dense?: boolean;
}): ReactNode {
  return (
    <section className={`panel ${dense ? 'panel--dense' : ''} ${className}`}>
      <span className="panel__notch panel__notch--tl" />
      <span className="panel__notch panel__notch--br" />
      {(eyebrow || title || actions) && (
        <header className="panel__head">
          <div className="panel__titles">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="panel__title">{title}</h2>}
            {meta && <div className="panel__meta">{meta}</div>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  title,
  busy = false,
  full = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'quiet';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  busy?: boolean;
  full?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size}${full ? ' btn--full' : ''}${busy ? ' is-busy' : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
    >
      {busy && <span className="btn__spin" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'idle',
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  hint?: string;
}): ReactNode {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className={`stat__value stat__value--${tone}`}>
        {value}
        {unit && <span className="stat__unit">{unit}</span>}
      </div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}): ReactNode {
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({
  label,
  hint,
  children,
  inline = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  inline?: boolean;
}): ReactNode {
  return (
    <div className={`field${inline ? ' field--inline' : ''}`}>
      <div className="field__label">
        <span>{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </div>
      <div className="field__control">{children}</div>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  width?: number;
}): ReactNode {
  return (
    <input
      className="input"
      type={type}
      value={value}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

/**
 * 设置项输入框：值先存在本地，失焦 / 回车才提交。
 * 避免"每次按键都走一趟 IPC，回包把光标位置冲掉"的经典问题。
 */
export function LocalInput({
  value,
  onCommit,
  placeholder,
  type = 'text',
  hint,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'password';
  hint?: string;
}): ReactNode {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className="input"
      type={type}
      value={draft}
      placeholder={placeholder ?? hint}
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

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  width,
}: {
  value: T;
  onChange: (v: string) => void;
  options: readonly { value: T; label: string }[];
  width?: number;
}): ReactNode {
  return (
    <select
      className="select"
      value={String(value)}
      style={width ? { width } : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div className="empty">
      <div className="empty__glyph" aria-hidden>
        ⌀
      </div>
      <div className="empty__title">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
    </div>
  );
}

export function Row({ children, className = '' }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={`row ${className}`}>{children}</div>;
}

export function KeyVal({
  k,
  v,
  mono = true,
  wrap = false,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
  wrap?: boolean;
}): ReactNode {
  return (
    <div className="kv">
      <span className="kv__k">{k}</span>
      <span className={`kv__v${mono ? ' kv__v--mono' : ''}${wrap ? ' is-wrap' : ''}`}>{v}</span>
    </div>
  );
}
