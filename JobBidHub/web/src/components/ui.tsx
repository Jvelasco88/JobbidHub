// Small shared UI pieces. Everything uses the theme tokens from index.css.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { usePrefs } from '../prefs';

export const cx = (...c: any[]) => c.filter(Boolean).join(' ');

// ---------- Buttons & inputs ----------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'soft' | 'danger' | 'outline'; size?: 'sm' | 'md'; icon?: ReactNode; busy?: boolean };
export function Button({ variant = 'outline', size = 'md', icon, busy, className, children, disabled, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold whitespace-nowrap transition select-none disabled:opacity-50 disabled:pointer-events-none';
  const sizes = size === 'sm' ? 'h-8 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13.5px]';
  const v = {
    primary: 'grad shadow-sm hover:brightness-110 active:brightness-95',
    soft: 'bg-accent/10 text-accent hover:bg-accent/15',
    ghost: 'text-ink2 hover:bg-sunken hover:text-ink',
    danger: 'bg-bad/10 text-bad hover:bg-bad/15',
    outline: 'border border-line bg-card text-ink hover:bg-sunken',
  }[variant];
  return (
    <button className={cx(base, sizes, v, className)} disabled={disabled || busy} {...rest}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx('inline-grid size-8 place-items-center rounded-[9px] text-ink2 hover:bg-sunken hover:text-ink transition', className)} {...rest}>
      {children}
    </button>
  );
}

const field = 'w-full rounded-[10px] border border-line bg-card px-3 h-9 text-[13.5px] outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx(field, className)} {...p} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx(field, 'pr-8', className)} {...p}>{children}</select>;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cx(field, 'h-auto py-2 leading-relaxed', className)} {...p} />;

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5 min-w-0', className)}>
      <span className="text-[12px] font-semibold text-ink2">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-ink/15')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-[13.5px] font-medium">{label}</span>}
          {hint && <span className="block text-[12px] text-muted">{hint}</span>}
        </span>
      )}
    </label>
  );
}

// Segmented control: a few mutually exclusive options.
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: NoInfer<T>; label: ReactNode; title?: string }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-[10px] bg-sunken p-0.5 border border-line">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} onClick={() => onChange(o.value)}
          className={cx('inline-flex items-center gap-1.5 rounded-[8px] font-semibold transition', size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Free-form list of short values (skills, keywords...) as removable chips.
export function TagInput({ value, onChange, placeholder, suggestions }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const items = raw.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
    const lower = new Set(value.map((v) => v.toLowerCase()));
    const fresh = items.filter((s) => !lower.has(s.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
    setText('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-card p-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[12.5px] font-medium text-accent">
          {v}
          <button type="button" aria-label={`Remove ${v}`} className="opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((x) => x !== v))}><X className="size-3" /></button>
        </span>
      ))}
      <input list={suggestions ? 'tag-suggest' : undefined} value={text} placeholder={value.length ? '' : placeholder}
        onChange={(e) => (/[,;]/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text.trim() && add(text)}
        className="min-w-[120px] flex-1 bg-transparent px-1.5 h-7 text-[13px] outline-none placeholder:text-muted" />
      {suggestions && <datalist id="tag-suggest">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

// ---------- Layout bits ----------

export function Card({ title, actions, children, className, bodyClass, icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; icon?: ReactNode }) {
  return (
    <section className={cx('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 px-[var(--pad)] pt-[calc(var(--pad)-4px)] pb-2">
          {icon && <span className="text-accent">{icon}</span>}
          <h2 className="text-[14.5px] font-bold tracking-tight min-w-0 truncate">{title}</h2>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cx(title || actions ? 'px-[var(--pad)] pb-[var(--pad)]' : 'pad', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-[var(--gap)] flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode; className?: string; title?: string }) {
  const t = {
    neutral: 'bg-sunken text-ink2 border-line',
    accent: 'bg-accent/10 text-accent border-accent/20',
    good: 'bg-good/10 text-good border-good/20',
    warn: 'bg-warn/10 text-warn border-warn/20',
    bad: 'bg-bad/10 text-bad border-bad/20',
    info: 'bg-info/10 text-info border-info/20',
  }[tone];
  return <span title={title} className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11.5px] font-semibold whitespace-nowrap', t, className)}>{children}</span>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent">{icon}</div>}
      <div className="text-[15px] font-bold">{title}</div>
      {children && <div className="max-w-sm text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-muted"><Spinner />{label}</div>;
}

// ---------- Avatar (same colours as the extension) ----------

const AVATAR_GRADIENTS = [
  ['#4f46e5', '#7c3aed'], ['#0f6cbd', '#1d4ed8'], ['#0e7490', '#0f766e'], ['#047857', '#15803d'],
  ['#9a3412', '#c2410c'], ['#9f1239', '#be123c'], ['#7e22ce', '#a21caf'], ['#334155', '#475569'],
  ['#4338ca', '#6d28d9'], ['#166534', '#0d9488'], ['#1e40af', '#0e7490'], ['#831843', '#9d174d'],
];
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
export function initials(name: string) {
  const raw = String(name || '');
  const cjk = raw.match(CJK);
  if (cjk) return cjk.slice(0, 2).join('');
  const tokens = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/)
    .map((t) => t.replace(/['-]/g, '')).filter((t) => t && !/^(mr|mrs|ms|miss|dr|prof|sir|jr|sr|ii|iii|iv|v|phd|mba|msc|bsc|md|cpa|esq)$/i.test(t));
  if (!tokens.length) return '?';
  if (tokens.length > 1) return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
  return [...tokens[0]].slice(0, 2).join('').toUpperCase();
}
export function avatarGradient(name: string) {
  let h = 0;
  for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
export const avatarColor = (name: string) => { let h = 0; for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length][0]; };

export function Avatar({ name, size = 32, ring, className }: { name: string; size?: number; ring?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cx('inline-grid shrink-0 place-items-center rounded-full font-bold text-white select-none', ring && 'ring-2 ring-card outline outline-2 outline-accent/40', className)}
      style={{ width: size, height: size, background: avatarGradient(name), fontSize: Math.max(10, Math.round(size * 0.38)) }} title={name}>
      {initials(name)}
    </span>
  );
}

// ---------- Score ring (match %) ----------

export function ScoreRing({ score, qualified, size = 44 }: { score: number | null | undefined; qualified?: boolean | null; size?: number }) {
  const s = score ?? 0;
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  const color = qualified === false ? 'var(--bad)' : s >= 70 ? 'var(--good)' : s >= 45 ? 'var(--warn)' : 'var(--muted)';
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} title={score == null ? 'No score' : `Match ${s}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * s) / 100} ${c}`} />}
      </svg>
      <span className="absolute text-[11px] font-extrabold tnum" style={{ color: score == null ? 'var(--muted)' : color }}>{score == null ? '–' : s}</span>
    </span>
  );
}

export function Progress({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: 'accent' | 'good' | 'warn' }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={cx('h-full rounded-full transition-all', tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-accent')} style={{ width: pct + '%' }} />
    </div>
  );
}

// ---------- Modal ----------

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={cx('card fade-up flex max-h-[90vh] w-full flex-col', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <h2 className="text-[16px] font-bold">{title}</h2>
          <IconButton label="Close" className="ml-auto" onClick={onClose}><X className="size-4" /></IconButton>
        </header>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// Popover menu anchored to a button.
export function Menu({ button, children, align = 'right' }: { button: (p: { onClick: () => void; open: boolean }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {button({ onClick: () => setOpen((o) => !o), open })}
      {open && (
        <div className={cx('card fade-up absolute z-40 mt-1.5 min-w-[200px] p-1', align === 'right' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ icon, children, onClick, active, danger }: { icon?: ReactNode; children: ReactNode; onClick?: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium transition', danger ? 'text-bad hover:bg-bad/10' : 'hover:bg-sunken', active && 'bg-accent/10 text-accent')}>
      {icon}<span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

// ---------- Toasts ----------

type ToastT = { id: number; kind: 'ok' | 'err' | 'info' | 'warn'; text: ReactNode };
const ToastCtx = createContext<(kind: ToastT['kind'], text: ReactNode) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastT[]>([]);
  const push = useCallback((kind: ToastT['kind'], text: ReactNode) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  const icons = { ok: <CheckCircle2 className="size-4 text-good" />, err: <XCircle className="size-4 text-bad" />, info: <Info className="size-4 text-info" />, warn: <AlertTriangle className="size-4 text-warn" /> };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className="card fade-up pointer-events-auto flex max-w-sm items-start gap-2.5 px-3.5 py-2.5 text-[13px]">
            {icons[t.kind]}<div className="min-w-0">{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Run an async action with a toast on failure (and optionally on success).
export function useAction() {
  const toast = useToast();
  const { t } = usePrefs();
  const [busy, setBusy] = useState<string>('');
  const run = async <T,>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(key);
    try {
      const out = await fn();
      if (ok) toast('ok', t(ok));
      return out;
    } catch (e: any) {
      toast('err', e?.message || String(e));
      return undefined;
    } finally {
      setBusy('');
    }
  };
  return { busy, run };
}

// ---------- Time helpers ----------

export function ago(iso?: string, t: (s: string, v?: any) => string = (s) => s) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n}m ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n}d ago', { n: Math.floor(s / 86400) });
  return new Date(iso).toLocaleDateString();
}
export const fmtDate = (iso?: string, lang = 'en') => (iso ? new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
