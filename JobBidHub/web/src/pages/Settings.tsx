import { useRef, useState } from 'react';
import { Palette, Plug, Database, Upload, Download, Wand2, Trash2, RefreshCw, Puzzle, Check, KeyRound, Bot, CheckCircle2, XCircle, Network, Copy, Globe, Archive, HardDrive, AlertTriangle } from 'lucide-react';
import { api, withToken, refresh, useBoot, useMe } from '../api';
import { useQuery } from '@tanstack/react-query';
import { usePrefs, type Prefs } from '../prefs';
import { askExtension } from '../extension';
import GetExtension from '../components/GetExtension';
import { Badge, Button, Card, Field, Input, PageHeader, Segmented, Select, Toggle, ago, cx, useAction } from '../components/ui';

const ACCENTS: { id: Prefs['accent']; color: string }[] = [
  { id: 'indigo', color: '#4f46e5' }, { id: 'blue', color: '#2563eb' }, { id: 'teal', color: '#0f766e' }, { id: 'green', color: '#15803d' },
  { id: 'rose', color: '#e11d48' }, { id: 'amber', color: '#d97706' }, { id: 'slate', color: '#334155' },
];

// Extension behaviour (same switches and defaults as the extension's Settings page).
const EXT_TOGGLES: { key: string; def: boolean; label: string; hint: string }[] = [
  { key: 'useAI', def: true, label: 'Use AI for questions', hint: 'Answer open questions and pick options with AI when no saved answer fits' },
  { key: 'learnAnswers', def: true, label: 'Learn my answers', hint: 'Save what you type on forms so it is filled next time' },
  { key: 'overwrite', def: false, label: 'Overwrite filled fields', hint: 'Replace values a site already filled in' },
  { key: 'showPanel', def: true, label: 'Open the side panel by default', hint: 'Off = a small button on every page' },
  { key: 'promptLog', def: true, label: 'Ask to log after submitting', hint: '"Did you submit this application?"' },
  { key: 'autoSubmit', def: false, label: 'Auto-submit', hint: 'When no required field is empty, submit after 1 second (with Cancel)' },
];

export default function Settings() {
  const { t, prefs, set } = usePrefs();
  const { data: boot } = useBoot();
  const { busy, run } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const s = boot?.settings || {};
  const hub = boot?.hub || {};
  // Shared settings, AI and data are the admin's; other accounts only change their own look & feel.
  const admin = useMe().data?.role === 'admin';

  const setExt = (patch: any) => run('ext', async () => { await api('/settings', { method: 'PUT', body: { settings: patch } }); refresh('boot'); });
  const setHub = (patch: any, ok?: string) => run('hub', async () => { await api('/settings', { method: 'PUT', body: { hub: patch } }); refresh('boot'); }, ok);
  const importFile = (f?: File) => f && run('import', async () => {
    const json = JSON.parse(await f.text());
    if (mode === 'replace' && !confirm(t('Replace ALL hub data with this file? Profiles and applications not in the file are removed.'))) return;
    const r = await api<{ profiles: number; applications: number }>('/import', { body: { ...json, mode } });
    refresh('boot', 'apps', 'jobs');
    alert(t('Imported: {p} profiles, {a} applications.', { p: r.profiles, a: r.applications }));
  });

  return (
    <div className="fade-up">
      <PageHeader title={t('Settings')} />
      <div className="grid gap-d xl:grid-cols-2">
        <Card title={t('Look & feel')} icon={<Palette className="size-4" />}>
          <div className="flex flex-col gap-4">
            <Row label={t('Theme')}>
              <Segmented value={prefs.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'system', label: t('System') }, { value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }]} />
            </Row>
            <Row label={t('Accent colour')}>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button key={a.id} title={a.id} onClick={() => set({ accent: a.id })} aria-pressed={prefs.accent === a.id}
                    className={cx('grid size-8 place-items-center rounded-full text-white transition', prefs.accent === a.id ? 'ring-2 ring-offset-2 ring-offset-card' : 'hover:scale-110')}
                    style={{ background: a.color, ['--tw-ring-color' as any]: a.color }}>
                    {prefs.accent === a.id && <Check className="size-4" />}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t('Density')}>
              <Segmented value={prefs.density} onChange={(v) => set({ density: v })} options={[{ value: 'comfortable', label: t('Comfortable') }, { value: 'compact', label: t('Compact') }]} />
            </Row>
            <Row label={t('Menu')}>
              <Segmented value={prefs.nav} onChange={(v) => set({ nav: v })} options={[{ value: 'side', label: t('Side') }, { value: 'top', label: t('Top') }]} />
            </Row>
            <Row label={t('Job board view')}>
              <Segmented value={prefs.jobView} onChange={(v) => set({ jobView: v })} options={[{ value: 'split', label: t('List + details') }, { value: 'cards', label: t('Cards') }, { value: 'table', label: t('Table') }]} />
            </Row>
            <Row label={t('Language')}>
              <Segmented value={prefs.lang} onChange={(v) => set({ lang: v })} options={[{ value: 'en', label: 'English' }, { value: 'ko', label: '한국어' }, { value: 'zh', label: '中文' }]} />
            </Row>
          </div>
        </Card>

        <Card title={t('Extension connection')} icon={<Plug className="size-4" />}>
          {(boot?.clients || []).length ? (
            <ul className="mb-3 flex flex-col gap-2">
              {(boot?.clients || []).map((c: any) => (
                <li key={c.id} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2">
                  <Puzzle className="size-4 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{c.name || t('Chrome')}{c.version ? <span className="ml-1.5 text-muted font-normal">v{c.version}</span> : null}</div>
                    <div className="text-[11.5px] text-muted">{t('Last sync')}: {c.last_sync ? ago(c.last_sync, t) : t('never')} · {t('seen')} {ago(c.last_seen, t)}</div>
                  </div>
                  <Badge tone={Date.now() - new Date(c.last_seen).getTime() < 5 * 60e3 ? 'good' : 'neutral'}>{Date.now() - new Date(c.last_seen).getTime() < 5 * 60e3 ? t('Online') : t('Offline')}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="mb-3 text-[13px] text-muted">{t('No extension has connected yet.')}</p>}
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-ink2">
            <li>{t('Keep JobBid Hub running (start.bat).')}</li>
            <li>{t('In each Chrome: click the JobBid icon, enter the hub address and sign in with your account. Until then the extension shows nothing; after sign-in it gets only that account\'s profiles.')}</li>
          </ol>
        </Card>

        <GetExtension />
        {admin && <NetworkCard />}
        {admin && <TunnelCard />}
        {admin && <BackupCard />}

        {admin && <>
        <Card title={t('Extension defaults for all accounts')} icon={<Puzzle className="size-4" />}>
          <p className="-mt-1 mb-3 text-[12.5px] text-muted">{t('Every account uses these unless it chose otherwise in My account. Changes reach the extensions at their next sync.')}</p>
          <div className="flex flex-col gap-3.5">
            {EXT_TOGGLES.map((x) => <Toggle key={x.key} checked={s[x.key] ?? x.def} onChange={(v) => setExt({ [x.key]: v })} label={t(x.label)} hint={t(x.hint)} />)}
            <Field label={t('ChatGPT website (no API key)')} hint={t('Asks ChatGPT in a background tab with the account signed in to Chrome. Slower (10-60 s per question), and against the OpenAI terms for automated use - the ChatGPT account could be limited.')}>
              <Select value={s.chatgptWeb || 'off'} onChange={(e) => setExt({ chatgptWeb: e.target.value })} className="max-w-[320px]">
                <option value="off">{t('Off')}</option>
                <option value="backup">{t('Backup (when API keys fail)')}</option>
                <option value="only">{t('Only (no API keys)')}</option>
              </Select>
            </Field>
            <ChatgptTest />
          </div>
        </Card>

        <Card title={t('Your data')} icon={<Database className="size-4" />}>
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-[13.5px] font-semibold">{t('Import a JobBid data file')}</div>
              <p className="mb-2 text-[12.5px] text-muted">{t('The jobbid-data.json file from the extension. "Add" keeps what is already here; "Replace" makes the hub an exact copy of the file.')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented size="sm" value={mode} onChange={(v) => setMode(v as any)} options={[{ value: 'merge', label: t('Add') }, { value: 'replace', label: t('Replace') }]} />
                <Button icon={<Upload className="size-4" />} busy={busy === 'import'} onClick={() => fileRef.current?.click()}>{t('Choose file…')}</Button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <div className="border-t border-line pt-4">
              <div className="mb-1.5 text-[13.5px] font-semibold">{t('Back up')}</div>
              <p className="mb-2 text-[12.5px] text-muted">{t('Download everything as a JobBid data file. The extension can open it too.')}</p>
              <Button icon={<Download className="size-4" />} onClick={() => window.open(withToken('/api/export'), '_blank')}>{t('Download backup')}</Button>
            </div>
            <div className="border-t border-line pt-4 text-[12px] text-muted">{t('Database file')}: <span className="font-mono">JobBidHub/data/jobbid.db</span> · v{boot?.version}</div>
          </div>
        </Card>

        <Card title={t('Job board')} icon={<Wand2 className="size-4" />}>
          <div className="flex flex-col gap-4">
            <Field label={t('Remove untouched jobs after (days)')} hint={t('Saved, applied and hidden jobs are always kept.')}>
              <Input type="number" min={7} defaultValue={hub.keepDays || 45} onBlur={(e) => setHub({ keepDays: Number(e.target.value) || 45 }, 'Saved')} className="max-w-[160px]" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button icon={<RefreshCw className="size-4" />} busy={busy === 'rescore'} onClick={() => run('rescore', async () => { await api('/jobs/rescore', { method: 'POST' }); refresh('jobs'); }, 'Scores updated')}>{t('Re-score all jobs')}</Button>
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => confirm(t('Delete all hidden jobs?')) && run('clear', async () => { await api('/jobs?status=hidden', { method: 'DELETE' }); refresh('jobs'); }, 'Deleted')}>{t('Delete hidden jobs')}</Button>
            </div>
          </div>
        </Card>

        <Card title={t('Adzuna (optional)')} icon={<KeyRound className="size-4" />}>
          <p className="-mt-1 mb-3 text-[12.5px] text-muted">{t('Adzuna adds on-site and hybrid jobs from many job boards. Get a free app id and key at developer.adzuna.com.')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="App id"><Input defaultValue={hub.adzunaId || ''} onBlur={(e) => e.target.value !== (hub.adzunaId || '') && setHub({ adzunaId: e.target.value.trim() }, 'Saved')} /></Field>
            <Field label="App key"><Input type="password" defaultValue={hub.adzunaKey || ''} onBlur={(e) => e.target.value !== (hub.adzunaKey || '') && setHub({ adzunaKey: e.target.value.trim() }, 'Saved')} /></Field>
            <Field label={t('Country')}>
              <Select value={hub.adzunaCountry || 'us'} onChange={(e) => setHub({ adzunaCountry: e.target.value })}>
                {['us', 'gb', 'ca', 'au', 'de', 'fr', 'nl', 'in', 'sg', 'nz', 'pl', 'it', 'es', 'at', 'ch', 'be', 'br', 'mx', 'za'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </Select>
            </Field>
          </div>
        </Card>
        </>}
      </div>
    </div>
  );
}

// Office-network access: teammates open this hub from their own PCs and sign in.
// Internet access through Cloudflare: Free (Quick Tunnel, random address) or your own domain (named tunnel).
type TunnelView = { on: boolean; mode: 'quick' | 'token'; url: string; hasToken: boolean; status: { installed: boolean; running: boolean; connections: number; error: string; lines: string[] } };
function TunnelCard() {
  const { t } = usePrefs();
  const { busy, run } = useAction();
  const q = useQuery({ queryKey: ['admin', 'tunnel'], queryFn: () => api<TunnelView>('/admin/tunnel'), refetchInterval: 4000 });
  const v = q.data;
  const [mode, setMode] = useState<'quick' | 'token' | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [log, setLog] = useState(false);
  const save = (body: any, ok?: string) => run('tun', async () => { await api('/admin/tunnel', { method: 'PUT', body }); setToken(''); await q.refetch(); }, ok);
  const m = mode ?? v?.mode ?? 'quick';
  const addr = url ?? (v?.mode === 'token' ? v?.url : '') ?? '';
  const st = v?.status;
  const live = v?.on && v.mode === m;
  const state = !live ? null : st?.connections && v?.url ? 'ok' : st?.error ? 'bad' : 'wait';
  return (
    <Card title={t('Internet access')} icon={<Globe className="size-4" />}>
      <p className="mb-3 text-[12.5px] text-muted">{t('A Cloudflare Tunnel gives the hub an https address that works from anywhere, also through proxies. This PC must stay on with the hub running.')}</p>
      <div className="flex flex-col gap-3">
        <Segmented value={m} onChange={(x) => setMode(x)} options={[{ value: 'quick', label: t('Free (no account)') }, { value: 'token', label: t('Own domain') }]} />
        {m === 'quick' ? (
          <p className="text-[12.5px] text-ink2">{t('Free and instant: you get an address like https://random-words.trycloudflare.com. It changes every time the hub restarts - then send the new address to your clients (their extension asks for it at sign-in).')}</p>
        ) : (
          <>
            <Field label={t('Public address')} hint={t('The hostname you set in the tunnel, e.g. https://hub.example.com')}>
              <Input value={addr} onChange={(e) => setUrl(e.target.value)} placeholder="https://hub.example.com" />
            </Field>
            <Field label={t('Tunnel token')} hint={v?.hasToken ? t('A token is saved. Paste a new one only to replace it.') : t('From the Cloudflare dashboard: the long text after "cloudflared.exe service install" (pasting the whole command is fine).')}>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={v?.hasToken ? '••••••••••' : ''} autoComplete="off" className="font-mono" />
            </Field>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {m === 'quick'
            ? !live && <Button variant="primary" busy={busy === 'tun'} onClick={() => save({ mode: 'quick', on: true }, 'Turned on')}>{t('Turn on')}</Button>
            : <Button variant="primary" busy={busy === 'tun'} disabled={!addr.trim() || (!token.trim() && !v?.hasToken)}
                onClick={() => save({ mode: 'token', url: addr, ...(token.trim() ? { token } : {}), on: true }, 'Saved')}>{live ? t('Save') : t('Save and turn on')}</Button>}
          {v?.on && <Button variant="ghost" onClick={() => save({ on: false }, 'Internet access is off')}>{t('Turn off')}</Button>}
        </div>
        {live && (
          <div className={cx('flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px]', state === 'ok' ? 'border-good/30 bg-good/10 text-good' : state === 'bad' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-sunken text-ink2')}>
            <span className="min-w-0 flex-1 truncate">
              {state === 'ok' ? <>{t('Connected')} · <a className="font-mono font-semibold underline" href={v!.url} target="_blank" rel="noreferrer">{v!.url}</a></> : state === 'bad' ? st!.error : t('Connecting to Cloudflare…')}
            </span>
            {state === 'ok' && <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(v!.url)}>{t('Copy')}</Button>}
          </div>
        )}
        {v && !st?.installed && <p className="text-[12.5px] text-bad">{t('cloudflared.exe is missing in the JobBidHub\\tools folder.')}</p>}
        {live && !!st?.lines?.length && (
          <div>
            <button type="button" className="text-[12px] font-semibold text-accent" onClick={() => setLog(!log)}>{log ? t('Hide details') : t('Show details')}</button>
            {log && <pre className="mt-1 max-h-48 overflow-auto rounded-[8px] bg-sunken p-2 text-[11px] leading-snug">{st.lines.join('\n')}</pre>}
          </div>
        )}
      </div>
    </Card>
  );
}

// Automatic daily backups: database + encryption key + hub settings, checked, the newest N kept.
type BackupItem = { name: string; at: string; size: number };
type BackupView = {
  config: { copyTo: string; keep: number; everyHours: number };
  state: { lastOk?: string; lastSize?: number; lastCounts?: { profiles: number; applications: number; files: number }; lastError?: string; lastErrorAt?: string; copyError?: string; copiedAt?: string };
  localDir: string; local: BackupItem[]; copies: BackupItem[]; overdue: boolean; running: boolean;
};
const mb = (n?: number) => ((n || 0) / 1048576).toFixed(1) + ' MB';
function BackupCard() {
  const { t } = usePrefs();
  const { busy, run } = useAction();
  const q = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => api<BackupView>('/admin/backups') });
  const v = q.data;
  const [copyTo, setCopyTo] = useState<string | null>(null);
  const dir = copyTo ?? v?.config.copyTo ?? '';
  const st = v?.state || {};
  const failedLast = !!st.lastError && (!st.lastOk || (st.lastErrorAt || '') > st.lastOk);
  const save = (body: any, ok: string) => run('bk-save', async () => { await api('/admin/backups', { method: 'PUT', body }); setCopyTo(null); await q.refetch(); }, ok);
  return (
    <Card title={t('Backups')} icon={<Archive className="size-4" />}>
      <p className="-mt-1 mb-3 text-[12.5px] text-muted">{t('Once a day the hub saves a copy of the database, the encryption key and its settings, and checks that the copy opens.')}</p>
      <div className="flex flex-col gap-3">
        <div className={cx('flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[12.5px]',
          failedLast ? 'border-bad/30 bg-bad/10 text-bad' : v?.overdue ? 'border-warn/30 bg-warn/10 text-warn' : 'border-good/30 bg-good/10 text-good')}>
          {failedLast || v?.overdue ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
          <span className="min-w-0 flex-1">
            {failedLast ? t('Last backup failed: {e}', { e: st.lastError })
              : st.lastOk ? t('Last backup {when} · {size} · {p} profiles, {a} applications', { when: ago(st.lastOk, t), size: mb(st.lastSize), p: st.lastCounts?.profiles ?? 0, a: st.lastCounts?.applications ?? 0 })
              : t('No backup yet.')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Archive className="size-4" />} busy={busy === 'bk-run'}
            onClick={() => run('bk-run', async () => { const r = await api<{ ok: boolean; error?: string }>('/admin/backups/run', { method: 'POST' }); await q.refetch(); if (!r.ok) throw new Error(r.error); }, 'Backup saved')}>{t('Back up now')}</Button>
          <span className="text-[12px] text-muted">{t('Kept: the newest')}</span>
          <Input type="number" min={3} max={90} defaultValue={v?.config.keep ?? 14} key={v?.config.keep}
            onBlur={(e) => Number(e.target.value) !== v?.config.keep && save({ keep: Number(e.target.value) }, 'Saved')} className="w-[72px]" />
        </div>
        <Field label={t('Second copy, off this PC')} hint={t('A OneDrive, Google Drive or USB-disk folder. If this PC breaks, the copies there survive. Leave empty to keep backups only on this PC.')}>
          <div className="flex gap-2">
            <Input value={dir} onChange={(e) => setCopyTo(e.target.value)} placeholder="C:\Users\you\OneDrive\JobBid backups" className="font-mono" />
            <Button busy={busy === 'bk-save'} disabled={copyTo == null || dir === v?.config.copyTo} onClick={() => save({ copyTo: dir }, dir ? 'Saved' : 'Second copy turned off')}>{t('Save')}</Button>
          </div>
        </Field>
        {v && !v.config.copyTo && <p className="-mt-1 text-[12.5px] text-warn">{t('Backups are only on this PC. Set a second folder so a broken disk does not lose everything.')}</p>}
        {!!st.copyError && <p className="-mt-1 text-[12.5px] text-bad">{st.copyError}</p>}
        {!!v?.local.length && (
          <div className="border-t border-line pt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted"><HardDrive className="size-3.5" /><span className="truncate font-mono">{v.localDir}</span></div>
            <ul className="flex flex-col gap-1">
              {v.local.slice(0, 5).map((b) => (
                <li key={b.name} className="flex items-center gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
                  {v.copies.some((c) => c.name === b.name) && <Badge tone="good">{t('also off this PC')}</Badge>}
                  <span className="text-muted">{mb(b.size)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-muted">{t('To restore, open the backup folder and follow README.txt.')}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function NetworkCard() {
  const { t } = usePrefs();
  const { busy, run } = useAction();
  const net = useQuery({ queryKey: ['admin', 'network'], queryFn: () => api<{ network: boolean; port: number; addresses: string[] }>('/admin/network') });
  const [restarting, setRestarting] = useState(false);
  const set = (network: boolean) => {
    if (network && !confirm(t('Let other computers on your office network open JobBid Hub? They still need an account to sign in.'))) return;
    run('net', async () => {
      const r = await api<{ restarting: boolean }>('/admin/network', { method: 'PUT', body: { network } });
      if (r.restarting) {
        setRestarting(true);
        // The hub restarts by itself; reload once it answers again.
        setTimeout(function wait() { fetch('/api/health').then((x) => (x.ok ? location.reload() : setTimeout(wait, 1000))).catch(() => setTimeout(wait, 1000)); }, 2500);
      }
    });
  };
  const on = !!net.data?.network;
  const urls = (net.data?.addresses || []).map((a) => `http://${a}:${net.data?.port}`);
  return (
    <Card title={t('Office network')} icon={<Network className="size-4" />}>
      <Toggle checked={on} onChange={set} label={t('Other computers on my network can open the hub')}
        hint={on ? t('Teammates open one of the addresses below and sign in with their own account.') : t('Off: only this computer can open the hub (safest).')} />
      {restarting && <p className="mt-3 text-[12.5px] text-warn">{t('Restarting the hub… this page reloads by itself.')}</p>}
      {on && !restarting && (
        <div className="mt-3 flex flex-col gap-1.5">
          {urls.length ? urls.map((u) => (
            <div key={u} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2 font-mono text-[13px]">
              <span className="min-w-0 flex-1 truncate">{u}</span>
              <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(u)}>{t('Copy')}</Button>
            </div>
          )) : <p className="text-[12.5px] text-warn">{t('No network address found. Is this PC connected to a network?')}</p>}
          <p className="text-[12px] text-muted">{t('If Windows asks to allow Node.js through the firewall, click Allow (private networks).')}</p>
        </div>
      )}
      {busy === 'net' && !restarting && <p className="mt-2 text-[12px] text-muted">{t('Saving…')}</p>}
    </Card>
  );
}

// Asks the extension in this browser to send ChatGPT a one-word question and shows what happened.
export function ChatgptTest() {
  const { t } = usePrefs();
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; text?: string; reload?: boolean }>({});
  const test = async () => {
    setState({ busy: true });
    const r = await askExtension('testChatgpt');
    setState(r.ok
      ? { ok: true, text: t('Works - ChatGPT answered "{a}" in {s}s.', { a: String(r.text || '').slice(0, 40), s: ((r.ms || 0) / 1000).toFixed(1) }) }
      : { ok: false, text: t(r.error || 'Failed'), reload: !!r.reload });
  };
  return (
    <div className="-mt-1 flex flex-wrap items-center gap-3">
      <Button size="sm" icon={<Bot className="size-3.5" />} busy={state.busy} onClick={test}>{state.busy ? t('Asking ChatGPT…') : t('Test ChatGPT')}</Button>
      {state.busy && <span className="text-[12px] text-muted">{t('A pinned ChatGPT tab opens in the background. This takes 10-60 seconds.')}</span>}
      {!state.busy && state.text && (
        <span className={cx('inline-flex items-start gap-1.5 text-[12.5px]', state.ok ? 'text-good' : 'text-bad')}>
          {state.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}{state.text}
        </span>
      )}
      {!state.busy && state.reload && <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} onClick={() => location.reload()}>{t('Reload page')}</Button>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: any }) {
  return <div className="flex flex-wrap items-center gap-3"><div className="w-36 shrink-0 text-[13px] font-semibold text-ink2">{label}</div><div className="min-w-0">{children}</div></div>;
}
