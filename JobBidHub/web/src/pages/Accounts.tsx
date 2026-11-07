import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, UserCheck, UserX, Clock, ShieldCheck, User as UserIcon, KeyRound, LogOut, Trash2, Pencil, Search as SearchIcon, CheckCircle2, XCircle, MonitorSmartphone, History, Users, Ban, Eye, EyeOff, Wand2, Network, Server, Chrome } from 'lucide-react';
import { api, refresh, useBoot, useMe, profileName, type User } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Card, Empty, Field, IconButton, Input, Loading, Modal, PageHeader, Segmented, Select, Textarea, Toggle, ago, cx, fmtDate, useAction, useToast } from '../components/ui';

type Session = { id: string; userId: string; username: string; name: string; createdAt: string; lastSeen: string; ip: string; ua: string };
type LoginRow = { id: number; at: string; username: string; userId: string; ok: boolean; reason: string; ip: string; ua: string };

// "Chrome on Windows" from a user-agent string.
function device(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [b, os].filter(Boolean).join(' · ') || ua.slice(0, 40) || '—';
}
const online = (iso?: string) => !!iso && Date.now() - new Date(iso).getTime() < 5 * 60e3;

// Easy-to-type random password, e.g. "kite-plum-4827".
function randomPassword() {
  const w = ['sun', 'kite', 'plum', 'wolf', 'lake', 'mint', 'rock', 'jade', 'fox', 'reef', 'oak', 'nova', 'pine', 'bolt', 'wave', 'iris'];
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  return `${w[r(w.length)]}-${w[r(w.length)]}-${1000 + r(9000)}`;
}

export default function Accounts() {
  const { t, prefs } = usePrefs();
  const { data: me } = useMe();
  const [tab, setTab] = useState<'accounts' | 'sessions' | 'logins'>('accounts');
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<User[]>('/admin/users'), refetchInterval: 20000 });
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api<Session[]>('/admin/sessions'), refetchInterval: 20000 });
  const logins = useQuery({ queryKey: ['admin', 'logins'], queryFn: () => api<LoginRow[]>('/admin/logins?limit=300'), refetchInterval: 20000 });
  const signup = useQuery({ queryKey: ['admin', 'signup'], queryFn: () => api<{ mode: string }>('/admin/signup') });
  const proxies = useQuery({ queryKey: ['proxies'], queryFn: () => api<ProxyData>('/admin/proxies'), refetchInterval: 30000 });
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [q, setQ] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const { run } = useAction();
  const list = users.data || [];

  const filtered = useMemo(() => {
    const w = q.toLowerCase().trim();
    return list.filter((u) => !w || `${u.username} ${u.name} ${u.note}`.toLowerCase().includes(w));
  }, [list, q]);
  const stats = {
    total: list.length,
    admins: list.filter((u) => u.role === 'admin').length,
    online: list.filter((u) => online(u.lastSeen)).length,
    failed24: (logins.data || []).filter((l) => !l.ok && Date.now() - new Date(l.at).getTime() < 864e5).length,
  };

  const reload = () => refresh('admin');
  const toggleDisabled = (u: User) => run('d' + u.id, async () => { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } }); reload(); }, u.disabled ? 'Account enabled' : 'Account disabled');
  const signOut = (u: User) => run('s' + u.id, async () => { await api(`/admin/users/${u.id}/signout`, { method: 'POST' }); reload(); }, 'Signed out everywhere');
  const remove = (u: User) => confirm(t('Delete the account "{name}"? This cannot be undone.', { name: u.username })) && run('x' + u.id, async () => { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); reload(); }, 'Account deleted');
  const approve = (u: User) => run('a' + u.id, async () => { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { approve: true } }); reload(); setEditing({ ...u, pending: false }); }, 'Account approved - now choose its profiles');
  const reject = (u: User) => confirm(t('Reject the sign-up of "{name}"? The request is deleted.', { name: u.username })) && run('r' + u.id, async () => { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); reload(); }, 'Request rejected');
  const setSignup = (mode: string) => run('m', async () => { await api('/admin/signup', { method: 'PUT', body: { mode } }); reload(); }, 'Saved');
  const pending = list.filter((u) => u.pending);
  const endSession = (s: Session) => run('e' + s.id, async () => { await api(`/admin/sessions/${s.id}`, { method: 'DELETE' }); reload(); }, 'Signed out');

  return (
    <div className="fade-up">
      <PageHeader title={t('Accounts')} sub={t('Who can sign in to JobBid Hub, who is signed in now, and every sign-in attempt.')}
        actions={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setEditing({ role: 'user' })}>{t('New account')}</Button>} />

      <div className="mb-[var(--gap)] grid grid-cols-2 gap-d lg:grid-cols-4">
        {[
          { icon: <Users className="size-5" />, label: t('Accounts'), value: stats.total, tone: 'bg-accent/10 text-accent' },
          { icon: <ShieldCheck className="size-5" />, label: t('Admins'), value: stats.admins, tone: 'bg-info/10 text-info' },
          { icon: <MonitorSmartphone className="size-5" />, label: t('Online now'), value: stats.online, tone: 'bg-good/10 text-good' },
          { icon: <XCircle className="size-5" />, label: t('Failed sign-ins (24h)'), value: stats.failed24, tone: stats.failed24 ? 'bg-bad/10 text-bad' : 'bg-sunken text-muted' },
        ].map((k) => (
          <div key={k.label} className="card pad flex items-center gap-3.5">
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-[12px]', k.tone)}>{k.icon}</span>
            <div><div className="text-[12px] font-semibold text-muted">{k.label}</div><div className="text-[22px] font-extrabold leading-tight tnum">{k.value}</div></div>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <Card className="mb-[var(--gap)] !border-warn/40" title={t('Waiting for approval ({n})', { n: pending.length })} icon={<Clock className="size-4" />}>
          <ul className="flex flex-col divide-y divide-line">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Avatar name={u.name || u.username} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{u.name} <span className="font-normal text-muted">@{u.username}</span></div>
                  <div className="text-[12px] text-muted">{t('signed up {when}', { when: ago(u.createdAt, t) })}</div>
                </div>
                <Button size="sm" variant="primary" icon={<UserCheck className="size-3.5" />} onClick={() => approve(u)}>{t('Approve')}</Button>
                <Button size="sm" variant="danger" icon={<UserX className="size-3.5" />} onClick={() => reject(u)}>{t('Reject')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="card mb-[var(--gap)] flex flex-wrap items-center gap-3 px-4 py-3">
        <UserPlus className="size-4 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">{t('Sign-up page')}</div>
          <div className="text-[12px] text-muted">{signup.data?.mode === 'open' ? t('Anyone can create an account and use it at once.') : signup.data?.mode === 'off' ? t('Only admins can create accounts.') : t('People can request an account; you approve it here.')}</div>
        </div>
        <Segmented size="sm" value={signup.data?.mode || 'approval'} onChange={setSignup} options={[
          { value: 'approval', label: t('Needs approval') }, { value: 'open', label: t('Open') }, { value: 'off', label: t('Off') },
        ]} />
      </div>

      <div className="mb-[var(--gap)] flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={(v) => setTab(v as any)} options={[
          { value: 'accounts', label: <><Users className="size-4" />{t('Accounts')}</> },
          { value: 'sessions', label: <><MonitorSmartphone className="size-4" />{t('Signed in now')}<Badge className="!px-1">{sessions.data?.length ?? 0}</Badge></> },
          { value: 'logins', label: <><History className="size-4" />{t('Login history')}</> },
        ]} />
        {tab === 'accounts' && (
          <div className="relative ml-auto w-full max-w-[280px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search accounts…')} className="pl-9" />
          </div>
        )}
        {tab === 'logins' && <div className="ml-auto"><Toggle checked={failedOnly} onChange={setFailedOnly} label={<span className="text-[13px]">{t('Failed only')}</span>} /></div>}
      </div>

      {tab === 'accounts' && (users.isLoading ? <Loading /> : (
        <div className="card scroll-thin overflow-x-auto">
          <table className="w-full min-w-[1060px] text-[13px]">
            <thead className="text-left text-[11.5px] font-bold uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5">{t('Account')}</th><th className="px-3">{t('Role')}</th><th className="px-3">{t('Status')}</th>
                <th className="px-3">{t('Proxy')}</th><th className="px-3">{t('Last sign-in')}</th><th className="px-3">{t('Sign-ins')}</th><th className="px-3">{t('Created')}</th><th className="w-48 px-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className={cx('border-b border-line last:border-0 hover:bg-sunken/60', u.disabled && 'opacity-60')}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="relative">
                        <Avatar name={u.name || u.username} size={34} />
                        {online(u.lastSeen) && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-good" title={t('Online')} />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{u.name}{u.id === me?.id && <span className="ml-1.5 text-[11.5px] font-medium text-muted">({t('you')})</span>}</div>
                        <div className="truncate text-[12px] text-muted">@{u.username}{u.note ? ` · ${u.note}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3">{u.role === 'admin' ? <Badge tone="info"><ShieldCheck className="size-3" />{t('Admin')}</Badge> : <Badge><UserIcon className="size-3" />{t('User')}</Badge>}</td>
                  <td className="px-3">{u.pending ? <Badge tone="warn"><Clock className="size-3" />{t('Waiting')}</Badge> : u.disabled ? <Badge tone="bad"><Ban className="size-3" />{t('Disabled')}</Badge> : online(u.lastSeen) ? <Badge tone="good">{t('Online')}</Badge> : <Badge tone="neutral">{t('Active')}</Badge>}</td>
                  <td className="px-3"><ProxyCell data={proxies.data} userId={u.id} t={t} /></td>
                  <td className="whitespace-nowrap px-3 text-ink2">{u.lastLogin ? ago(u.lastLogin, t) : <span className="text-muted">{t('never')}</span>}</td>
                  <td className="px-3 tnum text-ink2">{u.loginCount}</td>
                  <td className="whitespace-nowrap px-3 text-muted">{fmtDate(u.createdAt, prefs.lang)}</td>
                  <td className="px-3">
                    <div className="flex justify-end gap-0.5">
                      <IconButton label={t('Edit')} onClick={() => setEditing(u)}><Pencil className="size-4" /></IconButton>
                      <IconButton label={t('Reset password')} onClick={() => setResetFor(u)}><KeyRound className="size-4" /></IconButton>
                      <IconButton label={t('Sign out everywhere')} disabled={!u.activeSessions} onClick={() => signOut(u)} className="disabled:opacity-30"><LogOut className="size-4" /></IconButton>
                      {u.id !== me?.id && <IconButton label={u.disabled ? t('Enable') : t('Disable')} onClick={() => toggleDisabled(u)}>{u.disabled ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}</IconButton>}
                      {u.id !== me?.id && <IconButton label={t('Delete')} onClick={() => remove(u)}><Trash2 className="size-4" /></IconButton>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <Empty title={t('No accounts found')} />}
        </div>
      ))}

      {tab === 'sessions' && (
        <Card>
          {sessions.data?.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Avatar name={s.name || s.username} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{s.name} <span className="font-normal text-muted">@{s.username}</span></div>
                    <div className="truncate text-[12px] text-muted">{device(s.ua)} · {s.ip || '—'} · {t('signed in {when}', { when: ago(s.createdAt, t) })}</div>
                  </div>
                  <Badge tone={online(s.lastSeen) ? 'good' : 'neutral'}>{online(s.lastSeen) ? t('Online') : t('active {when}', { when: ago(s.lastSeen, t) })}</Badge>
                  <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => endSession(s)}>{t('Sign out')}</Button>
                </li>
              ))}
            </ul>
          ) : <Empty icon={<MonitorSmartphone className="size-5" />} title={t('Nobody is signed in')} />}
        </Card>
      )}

      {tab === 'logins' && (
        <div className="card scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="text-left text-[11.5px] font-bold uppercase tracking-wide text-muted">
              <tr className="border-b border-line"><th className="px-4 py-2.5">{t('When')}</th><th className="px-3">{t('Username')}</th><th className="px-3">{t('Result')}</th><th className="px-3">{t('Device')}</th><th className="px-3">IP</th></tr>
            </thead>
            <tbody>
              {(logins.data || []).filter((l) => !failedOnly || !l.ok).map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-2"><div className="font-medium">{new Date(l.at).toLocaleString(prefs.lang === 'en' ? 'en-US' : prefs.lang)}</div><div className="text-[11.5px] text-muted">{ago(l.at, t)}</div></td>
                  <td className="px-3 font-semibold">{l.username || '—'}</td>
                  <td className="px-3">{l.ok ? <Badge tone="good"><CheckCircle2 className="size-3" />{t('Signed in')}</Badge> : <Badge tone="bad"><XCircle className="size-3" />{t(l.reason)}</Badge>}</td>
                  <td className="px-3 text-ink2">{device(l.ua)}</td>
                  <td className="px-3 font-mono text-[12px] text-muted">{l.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(logins.data || []).filter((l) => !failedOnly || !l.ok).length && <Empty title={t('No sign-ins yet')} />}
        </div>
      )}

      <AccountEditor value={editing} onClose={() => setEditing(null)} onSaved={reload} isSelf={editing?.id === me?.id} />
      <ResetPassword user={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}

function PasswordInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { t } = usePrefs();
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <Input type={show ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} className="font-mono" />
      <IconButton label={show ? t('Hide') : t('Show')} onClick={() => setShow(!show)}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconButton>
      <Button type="button" icon={<Wand2 className="size-4" />} onClick={() => { onChange(randomPassword()); setShow(true); }}>{t('Generate')}</Button>
    </div>
  );
}

function AccountEditor({ value, onClose, onSaved, isSelf }: { value: Partial<User> | null; onClose: () => void; onSaved: () => void; isSelf: boolean }) {
  const { t } = usePrefs();
  const profiles = useBoot().data?.profiles || [];
  const toast = useToast();
  const { busy, run } = useAction();
  const [f, setF] = useState<any>({});
  const [openId, setOpenId] = useState<string | null>(null);
  if (value && (value.id || 'new') !== openId) { setOpenId(value.id || 'new'); setF({ username: '', name: '', role: 'user', note: '', password: '', profileIds: [], ...value }); }
  if (!value && openId !== null) setOpenId(null);
  const up = (p: any) => setF((x: any) => ({ ...x, ...p }));
  const isNew = !value?.id;
  const save = () => run('save', async () => {
    if (isNew) {
      await api('/admin/users', { body: { username: f.username, name: f.name, role: f.role, note: f.note, password: f.password, profileIds: f.profileIds || [] } });
      toast('ok', <span>{t('Account created.')} <b>{f.username}</b> / <span className="font-mono">{f.password}</span></span>);
    } else {
      await api(`/admin/users/${value!.id}`, { method: 'PATCH', body: { username: f.username, name: f.name, role: f.role, note: f.note, profileIds: f.profileIds || [] } });
      toast('ok', t('Saved'));
    }
    onSaved();
    onClose();
  });
  return (
    <Modal open={!!value} onClose={onClose} title={isNew ? t('New account') : t('Edit account')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" busy={busy === 'save'} disabled={!f.username || (isNew && !f.password)} onClick={save}>{isNew ? t('Create account') : t('Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Username')} hint={t('Used to sign in')}><Input value={f.username || ''} onChange={(e) => up({ username: e.target.value })} autoFocus={isNew} autoComplete="off" /></Field>
        <Field label={t('Display name')}><Input value={f.name || ''} onChange={(e) => up({ name: e.target.value })} placeholder={f.username} /></Field>
        <Field label={t('Role')} className="sm:col-span-2" hint={f.role === 'admin' ? t('Can manage accounts and see the login history.') : t('Can use the whole dashboard except Accounts.')}>
          <Select value={f.role} disabled={isSelf} onChange={(e) => up({ role: e.target.value })}>
            <option value="user">{t('User')}</option>
            <option value="admin">{t('Admin')}</option>
          </Select>
        </Field>
        {isNew && <Field label={t('Password')} className="sm:col-span-2" hint={t('At least 8 characters. Give it to the person; they can change it later.')}><PasswordInput value={f.password || ''} onChange={(v) => up({ password: v })} /></Field>}
        {f.role !== 'admin' && (
          <Field label={t('Profiles this account can use')} className="sm:col-span-2" hint={t('Only these candidates show up for this account, in the hub and in their Chrome extension.')}>
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((p) => {
                const on = (f.profileIds || []).includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => up({ profileIds: on ? (f.profileIds || []).filter((x: string) => x !== p.id) : [...(f.profileIds || []), p.id] })}
                    className={cx('inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-[12.5px] font-semibold transition', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink2 hover:bg-sunken')}>
                    <Avatar name={profileName(p)} size={20} />{profileName(p)}
                  </button>
                );
              })}
              {!profiles.length && <span className="text-[12.5px] text-muted">{t('No profiles yet.')}</span>}
            </div>
          </Field>
        )}
        <Field label={t('Note')} className="sm:col-span-2"><Textarea rows={2} value={f.note || ''} onChange={(e) => up({ note: e.target.value })} placeholder={t('e.g. bidder for Jerry and Justin')} /></Field>
        {!isNew && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink2 sm:col-span-2">
            {(value?.email || value?.phone) && <span>{[value?.email, value?.phone].filter(Boolean).join(' · ')}</span>}
            <span className="text-muted">{Object.keys(value?.prefs || {}).length ? t('{n} own extension settings', { n: Object.keys(value?.prefs || {}).length }) : t('Uses the default extension settings')}</span>
            {Object.keys(value?.prefs || {}).length > 0 && <Button size="sm" variant="ghost" onClick={() => run('rp', async () => { await api(`/admin/users/${value!.id}/reset-prefs`, { method: 'POST' }); onSaved(); onClose(); }, 'Back to the defaults')}>{t('Reset to defaults')}</Button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = usePrefs();
  const toast = useToast();
  const { busy, run } = useAction();
  const [pw, setPw] = useState('');
  const [id, setId] = useState('');
  if (user && user.id !== id) { setId(user.id); setPw(''); }
  const save = () => run('reset', async () => {
    await api(`/admin/users/${user!.id}/password`, { body: { password: pw } });
    toast('ok', <span>{t('New password for {name}:', { name: user!.username })} <span className="font-mono font-semibold">{pw}</span></span>);
    refresh('admin');
    onClose();
  });
  return (
    <Modal open={!!user} onClose={onClose} title={t('Reset password')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" busy={busy === 'reset'} disabled={pw.length < 8} onClick={save}>{t('Set password')}</Button></>}>
      <p className="mb-3 text-[13px] text-muted">{t('{name} will be signed out on every device and must use the new password.', { name: user?.name || '' })}</p>
      <PasswordInput value={pw} onChange={setPw} autoFocus />
    </Modal>
  );
}

// ---------- Proxy column: which proxy each account uses (set on the Proxies page) and what its Chrome reports ----------

type ProxyRule = { mode: 'off' | 'hub' | 'chrome'; proxyId: string; scope: 'ai' | 'all' };
type ProxyData = {
  proxies: { id: string; name: string; host: string; port: number | string; type: string; username: string }[];
  defaultRule: ProxyRule;
  users: { id: string; rule: ProxyRule | null; status: null | { at: string; state: string; error: string; mode: string } }[];
};

function ProxyCell({ data, userId, t }: { data?: ProxyData; userId: string; t: (s: string, v?: any) => string }) {
  if (!data) return <span className="text-muted">-</span>;
  const row = data.users.find((u) => u.id === userId);
  const rule = row?.rule || data.defaultRule;
  const own = !!row?.rule;
  const p = data.proxies.find((x) => x.id === rule.proxyId);
  const st = row?.status;
  // What this account's Chrome said last (only shown when it is recent or an error).
  const report = st && (st.error || Date.now() - new Date(st.at).getTime() < 15 * 60000) ? st : null;
  const how = rule.mode === 'hub' ? t('through the hub') : rule.mode === 'chrome' ? (rule.scope === 'all' ? t('in Chrome, all sites') : t('in Chrome, AI only')) : '';
  const tip = `${own ? t('Own setting') : t('Default setting')}${report ? ` · ${t('Chrome')}: ${report.error || report.state} (${ago(report.at, t)})` : ''}`;
  return (
    <Link to="/proxies" title={tip} className="flex flex-col gap-0.5 hover:opacity-80">
      {rule.mode === 'off' || !p ? (
        <Badge tone="neutral"><Network className="size-3" />{t('No proxy')}</Badge>
      ) : (
        <Badge tone={report?.error ? 'bad' : 'accent'}>{rule.mode === 'hub' ? <Server className="size-3" /> : <Chrome className="size-3" />}{p.name || `${p.host}:${p.port}`}</Badge>
      )}
      <span className={cx('text-[11px]', report?.error ? 'text-bad' : 'text-muted')}>
        {report?.error ? t('Error: {e}', { e: report.error.slice(0, 40) }) : [how, own ? '' : t('default')].filter(Boolean).join(' · ') || (own ? t('set for this account') : t('default'))}
      </span>
    </Link>
  );
}
