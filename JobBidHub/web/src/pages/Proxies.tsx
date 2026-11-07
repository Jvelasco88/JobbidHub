import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, Trash2, Save, Activity, ClipboardPaste, Server, Chrome, Ban, Users as UsersIcon, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api';
import { usePrefs } from '../prefs';
import { Badge, Button, Card, Empty, IconButton, Input, Loading, PageHeader, Segmented, Select, ago, cx, useToast } from '../components/ui';

type PType = 'http' | 'https' | 'socks5';
type Mode = 'off' | 'hub' | 'chrome';
type Scope = 'ai' | 'all';
type Rule = { mode: Mode; proxyId: string; scope: Scope };
type Proxy = { id: string; name: string; type: PType; host: string; port: number | string; username: string; hasPassword: boolean; note: string; password?: string; clearPass?: boolean };
type UserRow = { id: string; name: string; username: string; role: string; disabled: boolean; rule: Rule | null; status: null | { at: string; state: string; error: string; mode: string; version: string } };
type Data = { proxies: Proxy[]; defaultRule: Rule; hubOwn: string; users: UserRow[] };
type TestResult = { ok: boolean; ms: number; ip: string; country: string; city: string; org: string; error: string; services: { name: string; ok: boolean; status: number; note: string }[] };

const TYPES: { value: PType; label: string }[] = [{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }, { value: 'socks5', label: 'SOCKS5' }];
const OFF: Rule = { mode: 'off', proxyId: '', scope: 'ai' };

// "socks5://user:pass@host:port", "host:port:user:pass", "user:pass@host:port" or "host:port".
function parseProxy(text: string): Partial<Proxy> | null {
  let t = text.trim();
  if (!t) return null;
  let type: PType | undefined;
  const m = t.match(/^(https?|socks5h?|socks):\/\//i);
  if (m) { const k = m[1].toLowerCase(); type = k.startsWith('socks') ? 'socks5' : (k as PType); t = t.slice(m[0].length); }
  t = t.replace(/\/.*$/, '');
  let user = '', pass = '', host = '', port = '';
  if (t.includes('@')) {
    const [cred, addr] = [t.slice(0, t.lastIndexOf('@')), t.slice(t.lastIndexOf('@') + 1)];
    [user, pass = ''] = [cred.slice(0, cred.indexOf(':') < 0 ? cred.length : cred.indexOf(':')), cred.includes(':') ? cred.slice(cred.indexOf(':') + 1) : ''];
    [host, port] = addr.split(':');
  } else {
    const parts = t.split(':');
    [host, port] = parts;
    if (parts.length >= 4) { user = parts[2]; pass = parts.slice(3).join(':'); }
  }
  if (!host || !/^\d+$/.test(port || '')) return null;
  return { type: type || 'http', host, port: Number(port), username: user, password: pass };
}

let tmp = 0;

// Admin page: the proxies, who uses which, and how (through the hub or inside Chrome).
export default function Proxies() {
  const { t } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['proxies'], queryFn: () => api<Data>('/admin/proxies'), refetchInterval: 30_000 });
  const [draft, setDraft] = useState<{ proxies: Proxy[]; defaultRule: Rule; hubOwn: string; users: Record<string, Rule | null> } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult | 'busy'>>({});
  const [paste, setPaste] = useState('');

  // Fresh data from the hub replaces the form only while nothing is being edited.
  useEffect(() => {
    if (!q.data || dirty) return;
    setDraft({ proxies: q.data.proxies.map((p) => ({ ...p, password: '' })), defaultRule: q.data.defaultRule, hubOwn: q.data.hubOwn, users: Object.fromEntries(q.data.users.map((u) => [u.id, u.rule])) });
  }, [q.data, dirty]);

  const change = (fn: (d: NonNullable<typeof draft>) => void) => {
    setDraft((d) => { if (!d) return d; const n = structuredClone(d); fn(n); return n; });
    setDirty(true);
  };
  const named = useMemo(() => Object.fromEntries((draft?.proxies || []).map((p) => [p.id, p.name || `${p.host}:${p.port}`])), [draft]);

  if (q.isLoading || !draft) return <Loading />;
  if (q.error) return <Empty icon={<Network className="size-6" />} title={t('Could not load the proxies')}>{String((q.error as Error).message)}</Empty>;

  const addProxy = (p: Partial<Proxy> = {}) => change((d) => { d.proxies.push({ id: `new-${++tmp}`, name: '', type: 'http', host: '', port: '', username: '', hasPassword: false, note: '', password: '', ...p }); });
  const fromPaste = () => {
    const lines = paste.split(/\r?\n/).map(parseProxy).filter(Boolean) as Partial<Proxy>[];
    if (!lines.length) return toast('err', t('Could not read a proxy. Use host:port, host:port:user:pass or socks5://user:pass@host:port'));
    for (const p of lines) addProxy(p);
    setPaste('');
  };
  const removeProxy = (id: string) => {
    const used = draft.defaultRule.proxyId === id || draft.hubOwn === id || Object.values(draft.users).some((r) => r?.proxyId === id);
    if (used && !confirm(t('Accounts use this proxy. They go back to no proxy. Remove it?'))) return;
    change((d) => {
      d.proxies = d.proxies.filter((p) => p.id !== id);
      if (d.defaultRule.proxyId === id) d.defaultRule = { ...OFF };
      if (d.hubOwn === id) d.hubOwn = '';
      for (const k of Object.keys(d.users)) if (d.users[k]?.proxyId === id) d.users[k] = { ...OFF };
    });
  };
  const test = async (p: Proxy) => {
    setTests((x) => ({ ...x, [p.id]: 'busy' }));
    try {
      const saved = !p.id.startsWith('new-');
      const r = await api<TestResult>('/admin/proxies/test', { method: 'POST', body: { id: saved ? p.id : undefined, proxy: { type: p.type, host: p.host, port: p.port, username: p.username, password: p.clearPass ? '' : p.password } } });
      setTests((x) => ({ ...x, [p.id]: r }));
    } catch (e) {
      setTests((x) => ({ ...x, [p.id]: { ok: false, ms: 0, ip: '', country: '', city: '', org: '', error: (e as Error).message, services: [] } }));
    }
  };
  // A full proxy pasted into the Name or Address box ("1.2.3.4:8080:user:pass") is split into its boxes.
  const typeInto = (i: number, field: 'name' | 'host', value: string) => change((d) => {
    const parsed = /:\d+/.test(value) ? parseProxy(value) : null;
    if (parsed) { Object.assign(d.proxies[i], parsed, { clearPass: false }); if (field === 'name') d.proxies[i].name = ''; return; }
    d.proxies[i][field] = field === 'host' ? value.trim() : value;
  });
  const save = async () => {
    // Rows left empty (an extra "Add proxy") are dropped; a half-filled one says which it is.
    const blank = (p: Proxy) => !p.name.trim() && !p.host && !String(p.port) && !p.username && !p.password;
    const rows = draft.proxies.filter((p) => !blank(p));
    const bad = rows.findIndex((p) => !p.host || !/^\d+$/.test(String(p.port)));
    if (bad >= 0) {
      const p = rows[bad];
      return toast('err', t('Proxy {n} ({name}) needs an address and a port, e.g. 1.2.3.4 and 8080.', { n: draft.proxies.indexOf(p) + 1, name: p.name || p.host || t('no name') }));
    }
    if (rows.length !== draft.proxies.length) change((d) => { d.proxies = d.proxies.filter((p) => !blank(p)); });
    setSaving(true);
    try {
      await api('/admin/proxies', {
        method: 'PUT',
        body: {
          proxies: rows.map((p) => ({ id: p.id, name: p.name, type: p.type, host: p.host, port: p.port, username: p.username, note: p.note, password: p.clearPass ? null : p.password || '' })),
          defaultRule: draft.defaultRule, hubOwn: draft.hubOwn,
          users: Object.fromEntries(Object.entries(draft.users).map(([k, r]) => [k, r || { mode: 'default' }])),
        },
      });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['proxies'] });
      toast('ok', t('Saved. Each JobBid picks it up within a minute.'));
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const proxyOptions = draft.proxies.filter((p) => p.host);
  const usersById = Object.fromEntries((q.data?.users || []).map((u) => [u.id, u]));

  return (
    <div className="fade-up">
      <PageHeader title={t('Proxies')} sub={t('Send AI requests through a proxy - for everyone, or only for the accounts you choose.')}
        actions={<Button variant="primary" icon={<Save className="size-4" />} busy={saving} disabled={!dirty} onClick={save}>{dirty ? t('Save changes') : t('Saved')}</Button>} />

      <div className="grid gap-d">
        <Card title={t('Proxy list')} icon={<Server className="size-4" />} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => addProxy()}>{t('Add proxy')}</Button>}>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2} placeholder={t('Paste proxies, one per line: host:port:user:pass  or  socks5://user:pass@host:port')}
              className="min-h-[42px] flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs outline-none focus:border-accent" />
            <Button icon={<ClipboardPaste className="size-4" />} onClick={fromPaste} disabled={!paste.trim()}>{t('Add from text')}</Button>
          </div>
          {!draft.proxies.length ? (
            <Empty icon={<Network className="size-6" />} title={t('No proxies yet')}>{t('Add the proxy your provider gave you. A residential or ISP proxy in a supported country (e.g. the US) works best: AI services often block data-centre addresses.')}</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {draft.proxies.map((p, i) => {
                const r = tests[p.id];
                return (
                  <div key={p.id} className="rounded-xl border border-line p-3">
                    <div className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_1.6fr_0.7fr_1fr_1fr_auto]">
                      <Input value={p.name} placeholder={t('Name')} onChange={(e) => typeInto(i, 'name', e.target.value)} />
                      <Select value={p.type} onChange={(e) => change((d) => { d.proxies[i].type = e.target.value as PType; })}>
                        {TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                      </Select>
                      <Input value={p.host} placeholder={t('Address (host or IP)')} onChange={(e) => typeInto(i, 'host', e.target.value)} />
                      <Input value={String(p.port)} inputMode="numeric" placeholder={t('Port')} onChange={(e) => change((d) => { d.proxies[i].port = e.target.value.replace(/\D/g, ''); })} />
                      <Input value={p.username} placeholder={t('Username (optional)')} autoComplete="off" onChange={(e) => change((d) => { d.proxies[i].username = e.target.value; })} />
                      <Input type="password" value={p.password || ''} autoComplete="new-password" placeholder={p.hasPassword && !p.clearPass ? t('Saved - type to change') : t('Password (optional)')}
                        onChange={(e) => change((d) => { d.proxies[i].password = e.target.value; d.proxies[i].clearPass = false; })} />
                      <div className="flex items-center gap-1">
                        <Button size="sm" icon={<Activity className="size-4" />} busy={r === 'busy'} disabled={!p.host || !p.port} onClick={() => test(p)}>{t('Test')}</Button>
                        <IconButton label={t('Remove')} onClick={() => removeProxy(p.id)}><Trash2 className="size-4" /></IconButton>
                      </div>
                    </div>
                    {p.hasPassword && !p.password && (
                      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" checked={!!p.clearPass} onChange={(e) => change((d) => { d.proxies[i].clearPass = e.target.checked; })} />{t('Remove the saved password')}
                      </label>
                    )}
                    {p.type === 'socks5' && p.username && <p className="mt-2 text-xs text-warn">{t('Chrome cannot sign in to a SOCKS5 proxy. Accounts set to "In Chrome" use it through the hub instead (AI only).')}</p>}
                    {r && r !== 'busy' && (
                      <div className={cx('mt-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs', r.ok ? 'bg-good/10' : 'bg-bad/10')}>
                        {r.ok ? <CheckCircle2 className="size-4 text-good" /> : <XCircle className="size-4 text-bad" />}
                        {r.ok ? (
                          <>
                            <b>{r.ip}</b>
                            <span>{[r.city, r.country].filter(Boolean).join(', ')}</span>
                            {r.org && <span className="text-muted">{r.org}</span>}
                            <span className="text-muted tnum">{r.ms} ms</span>
                            {r.services.map((s) => <Badge key={s.name} tone={s.ok ? 'good' : 'bad'} title={s.note}>{s.name}: {s.ok ? t('reachable') : t('blocked')}</Badge>)}
                          </>
                        ) : <span>{r.error}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={t('Who uses which proxy')} icon={<UsersIcon className="size-4" />}>
          <div className="mb-4 grid gap-2 text-xs text-muted md:grid-cols-3">
            <p className="flex gap-2"><Ban className="mt-0.5 size-4 shrink-0" /><span><b className="text-ink">{t('Off')}</b> - {t('AI requests go straight from that Chrome, on its own internet connection.')}</span></p>
            <p className="flex gap-2"><Server className="mt-0.5 size-4 shrink-0" /><span><b className="text-ink">{t('Through the hub')}</b> - {t('JobBid sends AI requests to this hub, which sends them on through the proxy. Works with every proxy type and login. Job sites and the ChatGPT website stay on the normal connection.')}</span></p>
            <p className="flex gap-2"><Chrome className="mt-0.5 size-4 shrink-0" /><span><b className="text-ink">{t('In Chrome')}</b> - {t('JobBid sets the proxy inside that Chrome: only AI sites (also the ChatGPT website), or every site. Turn off other VPN or proxy extensions there.')}</span></p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">{t('Account')}</th><th className="py-2 pr-3 font-medium">{t('How')}</th><th className="py-2 pr-3 font-medium">{t('Proxy')}</th>
                <th className="py-2 pr-3 font-medium">{t('Which sites')}</th><th className="py-2 font-medium">{t('Last report from Chrome')}</th>
              </tr></thead>
              <tbody>
                <RuleRow t={t} label={<b>{t('Everyone else (default)')}</b>} rule={draft.defaultRule} proxies={proxyOptions}
                  onChange={(r) => change((d) => { d.defaultRule = r || { ...OFF }; })} />
                {Object.keys(draft.users).map((id) => {
                  const u = usersById[id];
                  if (!u) return null;
                  const r = draft.users[id];
                  const eff = r || draft.defaultRule;
                  return (
                    <RuleRow key={id} t={t} rule={r} proxies={proxyOptions} canDefault
                      label={<div><div className={cx('font-medium', u.disabled && 'line-through opacity-60')}>{u.name}</div><div className="text-xs text-muted">@{u.username}{u.role === 'admin' ? ' · admin' : ''}</div></div>}
                      fallback={eff.mode === 'off' ? t('Default: off') : t('Default: {p}', { p: `${named[eff.proxyId] || '?'} · ${eff.mode === 'hub' ? t('through the hub') : t('in Chrome')}` })}
                      status={u.status} onChange={(nr) => change((d) => { d.users[id] = nr; })} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t("The hub's own AI requests")} icon={<Server className="size-4" />}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-muted">{t('Job scoring, resume reading and the AI keys page use the AI from this hub computer. Send them through a proxy too?')}</p>
            <Select className="sm:w-72" value={draft.hubOwn} onChange={(e) => change((d) => { d.hubOwn = e.target.value; })}>
              <option value="">{t('No proxy (direct)')}</option>
              {proxyOptions.map((p) => <option key={p.id} value={p.id}>{named[p.id]}</option>)}
            </Select>
          </div>
        </Card>
      </div>
    </div>
  );
}

function RuleRow({ t, label, rule, proxies, onChange, canDefault, fallback, status }: {
  t: (s: string, v?: Record<string, any>) => string; label: React.ReactNode; rule: Rule | null; proxies: Proxy[]; onChange: (r: Rule | null) => void;
  canDefault?: boolean; fallback?: string; status?: UserRow['status'];
}) {
  const r = rule;
  const how = r ? r.mode : 'default';
  const set = (patch: Partial<Rule>) => {
    const next = { ...(r || OFF), ...patch } as Rule;
    if (next.mode !== 'off' && !next.proxyId && proxies[0]) next.proxyId = proxies[0].id;
    onChange(next);
  };
  const options = [
    ...(canDefault ? [{ value: 'default', label: t('Default') }] : []),
    { value: 'off', label: t('Off') }, { value: 'hub', label: t('Through the hub') }, { value: 'chrome', label: t('In Chrome') },
  ];
  return (
    <tr className="border-b border-line/60 align-middle">
      <td className="py-2 pr-3">{label}</td>
      <td className="py-2 pr-3">
        <Segmented size="sm" value={how as any} options={options as any} onChange={(v: string) => (v === 'default' ? onChange(null) : set({ mode: v as Mode }))} />
      </td>
      <td className="py-2 pr-3">
        {!r ? <span className="text-xs text-muted">{fallback}</span> : r.mode === 'off' ? <span className="text-xs text-muted">-</span> : (
          <Select value={r.proxyId} onChange={(e) => set({ proxyId: e.target.value })}>
            {!proxies.length && <option value="">{t('Add a proxy first')}</option>}
            {proxies.map((p) => <option key={p.id} value={p.id}>{p.name || `${p.host}:${p.port}`}</option>)}
          </Select>
        )}
      </td>
      <td className="py-2 pr-3">
        {r?.mode === 'chrome' ? (
          <Segmented size="sm" value={r.scope} onChange={(v) => set({ scope: v as Scope })} options={[{ value: 'ai', label: t('AI only') }, { value: 'all', label: t('All sites') }]} />
        ) : <span className="text-xs text-muted">{r?.mode === 'hub' ? t('AI only') : '-'}</span>}
      </td>
      <td className="py-2 text-xs">
        {status ? (
          <span className={cx(status.error ? 'text-bad' : 'text-muted')} title={status.error || ''}>
            {status.error ? `${t('Error')}: ${status.error}` : { on: t('Proxy on'), off: t('No proxy'), hub: t('Through the hub') }[status.state] || status.state} · {ago(status.at)}{status.version ? ` · v${status.version}` : ''}
          </span>
        ) : <span className="text-muted">-</span>}
      </td>
    </tr>
  );
}
