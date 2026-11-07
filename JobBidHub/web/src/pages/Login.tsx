import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, User as UserIcon, IdCard, LogIn, UserPlus, AlertCircle, CheckCircle2, Languages, Sun, Moon, Monitor, ArrowLeft } from 'lucide-react';
import { api, setToken } from '../api';
import { usePrefs } from '../prefs';
import { Button, IconButton, cx } from '../components/ui';
import GetExtension from '../components/GetExtension';

const field = 'h-11 w-full rounded-[12px] border border-line bg-card pl-10 pr-3 text-[14px] outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20';

function Labeled({ label, icon, hint, children }: { label: string; icon: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink2">{label}</span>
      <span className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{icon}</span>
        {children}
      </span>
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}

function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const { t } = usePrefs();
  const [show, setShow] = useState(false);
  return (
    <>
      <input type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className={cx(field, 'pr-11')} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? t('Hide') : t('Show')}
        className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[8px] text-muted hover:bg-sunken hover:text-ink">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </>
  );
}

// Sign in and sign up. After either, the page reloads so everything starts fresh for that account.
export default function Login() {
  const { t, prefs, set } = usePrefs();
  const opts = useQuery({ queryKey: ['authOptions'], queryFn: () => api<{ signup: 'approval' | 'open' | 'off' }>('/auth/options'), retry: false });
  const signupMode = opts.data?.signup || 'approval';
  const [mode, setMode] = useState<'in' | 'up'>(location.hash === '#signup' ? 'up' : 'in');
  const [f, setF] = useState({ username: '', password: '', name: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const go = (m: 'in' | 'up') => { setMode(m); setError(''); setDone(''); history.replaceState(null, '', m === 'up' ? '#signup' : location.pathname); };

  const signIn = async () => {
    if (!f.username.trim() || !f.password) return setError(t('Enter your username and password.'));
    const r = await api<{ token: string }>('/auth/login', { body: { username: f.username.trim(), password: f.password } });
    setToken(r.token);
    location.replace('/');
  };
  const signUp = async () => {
    if (!f.username.trim() || !f.password) return setError(t('Enter your username and password.'));
    if (f.password.length < 6) return setError(t('Password must be at least 6 characters.'));
    if (f.password !== f.again) return setError(t('The two passwords are different.'));
    const r = await api<{ pending?: boolean; token?: string }>('/auth/signup', { body: { username: f.username.trim(), name: f.name.trim(), password: f.password } });
    if (r.token) { setToken(r.token); location.replace('/'); return; }
    setDone(t('Account requested. An admin must approve it before you can sign in.'));
    setF({ username: f.username, password: '', name: '', again: '' });
    setMode('in');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await (mode === 'in' ? signIn() : signUp()); } catch (err: any) { setError(t(err.message)); up({ password: '', again: '' }); } finally { setBusy(false); }
  };

  const ThemeIcon = prefs.theme === 'dark' ? Moon : prefs.theme === 'light' ? Sun : Monitor;
  const canSignUp = signupMode !== 'off';

  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[780px] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <button onClick={() => set({ lang: ({ en: 'ko', ko: 'zh', zh: 'en' } as const)[prefs.lang] })}
          className="inline-flex h-8 items-center gap-1 rounded-[9px] px-2 text-[12px] font-bold text-ink2 hover:bg-sunken">
          <Languages className="size-4" />{{ en: 'EN', ko: '한', zh: '中' }[prefs.lang]}
        </button>
        <IconButton label={t('Theme')} onClick={() => set({ theme: ({ system: 'light', light: 'dark', dark: 'system' } as const)[prefs.theme] })}><ThemeIcon className="size-4" /></IconButton>
      </div>

      <div className="fade-up relative w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/icon.png" alt="" className="mb-4 size-16 drop-shadow-lg" />
          <h1 className="text-[24px] font-extrabold tracking-tight">JobBid <span className="text-accent">Hub</span></h1>
          <p className="mt-1 text-[13.5px] text-muted">{mode === 'in' ? t('Sign in to continue') : t('Create your account')}</p>
        </div>

        {canSignUp && (
          <div className="mb-3 grid grid-cols-2 rounded-[12px] border border-line bg-sunken p-1">
            {(['in', 'up'] as const).map((m) => (
              <button key={m} type="button" onClick={() => go(m)}
                className={cx('h-9 rounded-[9px] text-[13.5px] font-semibold transition', mode === m ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                {m === 'in' ? t('Sign in') : t('Sign up')}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="card flex flex-col gap-4 p-6" noValidate>
          {done && (
            <div role="status" className="flex items-start gap-2 rounded-[10px] border border-good/25 bg-good/10 px-3 py-2.5 text-[13px] text-good">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />{done}
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-bad/25 bg-bad/10 px-3 py-2.5 text-[13px] text-bad">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />{error}
            </div>
          )}
          {mode === 'up' && (
            <Labeled label={t('Your name')} icon={<IdCard className="size-4" />}>
              <input autoComplete="name" value={f.name} onChange={(e) => up({ name: e.target.value })} className={field} autoFocus />
            </Labeled>
          )}
          <Labeled label={t('Username')} icon={<UserIcon className="size-4" />} hint={mode === 'up' ? t('3-40 letters, numbers or . _ @ -') : undefined}>
            <input autoFocus={mode === 'in'} autoComplete="username" value={f.username} onChange={(e) => up({ username: e.target.value })} className={field} />
          </Labeled>
          <Labeled label={t('Password')} icon={<Lock className="size-4" />} hint={mode === 'up' ? t('At least 6 characters') : undefined}>
            <PasswordField value={f.password} onChange={(v) => up({ password: v })} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
          </Labeled>
          {mode === 'up' && (
            <Labeled label={t('Password again')} icon={<Lock className="size-4" />}>
              <PasswordField value={f.again} onChange={(v) => up({ again: v })} autoComplete="new-password" />
            </Labeled>
          )}
          <Button type="submit" variant="primary" busy={busy} icon={mode === 'in' ? <LogIn className="size-4" /> : <UserPlus className="size-4" />} className="!h-11 w-full !text-[14.5px]">
            {mode === 'in' ? t('Sign in') : t('Create account')}
          </Button>
          {mode === 'up' && signupMode === 'approval' && <p className="-mt-1 text-center text-[12px] text-muted">{t('An admin approves new accounts before they can sign in.')}</p>}
        </form>

        <p className="mt-5 text-center text-[12.5px] text-muted">
          {mode === 'in'
            ? (canSignUp ? <>{t('No account yet?')} <button className="font-semibold text-accent hover:underline" onClick={() => go('up')}>{t('Sign up')}</button></> : t('Forgot your password? Ask the admin to reset it.'))
            : <button className="inline-flex items-center gap-1 font-semibold text-accent hover:underline" onClick={() => go('in')}><ArrowLeft className="size-3.5" />{t('Back to sign in')}</button>}
        </p>
        <GetExtension className="mt-5" />
      </div>
    </div>
  );
}
