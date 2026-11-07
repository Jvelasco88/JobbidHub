import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Play, Square, RotateCcw, Trash2, ExternalLink, Chrome, ListChecks } from 'lucide-react';
import { api, useBoot } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Card, Empty, IconButton, Input, PageHeader, Segmented, Toggle, ago, cx, useAction } from '../components/ui';

type Bid = {
  id: string; profileId: string; profileName: string; jobId: string; title: string; company: string; url: string; score: number;
  status: 'queued' | 'running' | 'submitted' | 'review' | 'needs' | 'skipped' | 'failed'; reason: string; detail: any;
  createdAt: string; startedAt: string; finishedAt: string;
};
type Config = { mode: 'review' | 'auto'; perDay: number; gapMin: number; gapMax: number; onePerCompany: boolean; profileIds: string[]; running: boolean; nextAt: string; lastPoll: string };
type View = { config: Config; counts: Record<string, any>; items: Bid[]; now: string; stats?: Record<string, number> };

const STATUS: Record<Bid['status'], { label: string; tone: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info' }> = {
  queued: { label: 'Waiting', tone: 'neutral' },
  running: { label: 'Working…', tone: 'accent' },
  submitted: { label: 'Submitted', tone: 'good' },
  review: { label: 'Ready for you', tone: 'info' },
  needs: { label: 'Needs you', tone: 'warn' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'bad' },
};
const FILTERS = ['all', 'queued', 'review', 'needs', 'submitted', 'skipped', 'failed'] as const;

export default function AutoBid() {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const { data: boot } = useBoot();
  const { busy, run } = useAction();
  const q = useQuery({ queryKey: ['autobid'], queryFn: () => api<View>('/autobid'), refetchInterval: 4000 });
  const v = q.data;
  const profiles = boot?.profiles || [];
  const [cfg, setCfg] = useState<Config | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  // Settings are edited locally and saved on change; the server copy refreshes the rest.
  useEffect(() => { if (v && !cfg) setCfg(v.config); }, [v, cfg]);
  const set = (patch: Partial<Config>) => {
    const next = { ...(cfg as Config), ...patch };
    setCfg(next);
    api<View>('/autobid/config', { method: 'PUT', body: patch }).then((r) => qc.setQueryData(['autobid'], r)).catch(() => {});
  };
  const act = (key: string, path: string, body: any = {}, ok?: string) => run(key, async () => {
    const r = await api<View>(path, { body });
    qc.setQueryData(['autobid'], r);
    if (r.stats) setStats(r.stats);
    return r;
  }, ok);

  const items = useMemo(() => (v?.items || []).filter((b) => filter === 'all' || b.status === filter || (filter === 'queued' && b.status === 'running')), [v, filter]);
  if (!v || !cfg) return <div className="p-6 text-muted">{t('Loading…')}</div>;
  const c = v.counts;
  const running = v.config.running;
  // The extension asks the hub for work every 30 seconds while Chrome is open and signed in.
  const polledMs = v.config.lastPoll ? Date.now() - new Date(v.config.lastPoll).getTime() : Infinity;
  const connected = polledMs < 90_000;
  const waitMs = v.config.nextAt ? new Date(v.config.nextAt).getTime() - Date.now() : 0;
  const current = v.items.find((b) => b.status === 'running');

  return (
    <div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Bot className="size-6 text-accent" />{t('Auto bid')}</span>}
        sub={t('Applies to your profiles\' Qualified jobs on Greenhouse, Lever and Ashby, one at a time, in your Chrome.')}
        actions={running
          ? <Button variant="outline" icon={<Square className="size-4" />} busy={busy === 'stop'} onClick={() => act('stop', '/autobid/stop', {}, 'Stopped')}>{t('Stop')}</Button>
          : <Button variant="primary" icon={<Play className="size-4" />} busy={busy === 'start'} disabled={!cfg.profileIds.length} onClick={() => act('start', '/autobid/start', { profileIds: cfg.profileIds })}>{t('Start')}</Button>}
      />

      {stats && (
        <div className="card pad mb-[var(--gap)] text-[13px]">
          <b>{t('{n} jobs added to the queue.', { n: stats.added })}</b>{' '}
          <span className="text-muted">
            {[stats.unsupported && t('{n} on sites not supported yet', { n: stats.unsupported }), stats.applied && t('{n} already applied', { n: stats.applied }),
              stats.company && t('{n} company already taken by another profile', { n: stats.company }), stats.already && t('{n} already in the list', { n: stats.already })].filter(Boolean).join(' · ')}
          </span>
          {!stats.added && <div className="mt-1 text-muted">{t('Nothing new to apply to. Mark jobs as Qualified on the Job board, or run your searches.')}</div>}
        </div>
      )}

      <div className="grid gap-[var(--gap)] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-[var(--gap)]">
          {/* Status */}
          <div className="card pad flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <span className={cx('size-2.5 rounded-full', running ? 'bg-good animate-pulse' : 'bg-ink/25')} />
              <b className="text-[14px]">{running ? t('Running') : t('Stopped')}</b>
            </div>
            <div className={cx('flex items-center gap-1.5 text-[12.5px]', connected ? 'text-good' : 'text-warn')}>
              <Chrome className="size-4" />
              {connected ? t('Chrome connected ({t})', { t: ago(v.config.lastPoll, t) }) : t('Chrome not connected - open Chrome with JobBid signed in to this hub')}
            </div>
            {running && current && <div className="text-[12.5px] text-muted min-w-0 truncate">{t('Now: {job}', { job: `${current.title} · ${current.company} (${current.profileName})` })}</div>}
            {running && !current && waitMs > 0 && <div className="text-[12.5px] text-muted">{t('Next one in {s}s', { s: Math.ceil(waitMs / 1000) })}</div>}
          </div>

          {/* Counters */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(['queued', 'review', 'needs', 'submitted', 'skipped', 'failed'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(filter === k ? 'all' : k)}
                className={cx('card pad text-left transition', filter === k && 'ring-2 ring-accent')}>
                <div className="text-[22px] font-extrabold leading-none">{(c[k] || 0) + (k === 'queued' ? c.running || 0 : 0)}</div>
                <div className="mt-1 text-[12px] text-muted">{t(STATUS[k].label)}</div>
              </button>
            ))}
          </div>

          {/* The list */}
          <Card title={t('Jobs')} icon={<ListChecks className="size-4" />}
            actions={<>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} busy={busy === 'clearDone'} onClick={() => act('clearDone', '/autobid/clear', { which: 'done' })}>{t('Clear finished')}</Button>
              {!running && (c.queued || 0) > 0 && <Button size="sm" variant="ghost" busy={busy === 'clearQ'} onClick={() => act('clearQ', '/autobid/clear', { which: 'queued' })}>{t('Empty the queue')}</Button>}
            </>}>
            {!items.length ? (
              <Empty icon={<Bot className="size-6" />} title={v.items.length ? t('Nothing here') : t('No jobs yet')}>
                {v.items.length ? t('Pick another filter above.') : t('Choose profiles on the right and press Start: their Qualified jobs are added here.')}
              </Empty>
            ) : (
              <div className="-mx-[var(--pad)] divide-y divide-line">
                {items.map((b) => (
                  <div key={b.id} className="flex items-start gap-3 px-[var(--pad)] py-2.5">
                    <Avatar name={b.profileName} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={b.url} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline">{b.title || t('Job')}</a>
                        <Badge tone={STATUS[b.status].tone}>{t(STATUS[b.status].label)}</Badge>
                        {b.detail?.site && <span className="text-[11.5px] text-muted">{b.detail.site}</span>}
                      </div>
                      <div className="text-[12.5px] text-muted truncate">{b.company} · {b.profileName}{b.finishedAt ? ` · ${ago(b.finishedAt, t)}` : ''}</div>
                      {b.reason && <div className={cx('mt-0.5 text-[12.5px]', b.status === 'failed' ? 'text-bad' : b.status === 'needs' ? 'text-warn' : 'text-ink2')}>{b.reason}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton label={t('Open')} onClick={() => window.open(b.url, '_blank')}><ExternalLink className="size-4" /></IconButton>
                      {['needs', 'failed', 'skipped', 'review'].includes(b.status) && <IconButton label={t('Try again')} onClick={() => act('retry' + b.id, `/autobid/items/${b.id}/retry`)}><RotateCcw className="size-4" /></IconButton>}
                      {b.status !== 'running' && <IconButton label={t('Remove')} onClick={() => run('del' + b.id, async () => qc.setQueryData(['autobid'], await api(`/autobid/items/${b.id}`, { method: 'DELETE' })))}><Trash2 className="size-4" /></IconButton>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Settings */}
        <div className="flex flex-col gap-[var(--gap)]">
          <Card title={t('Profiles')}>
            {!profiles.length ? <div className="text-[13px] text-muted">{t('No profiles yet.')}</div> : (
              <div className="flex flex-col gap-2">
                {profiles.map((p) => {
                  const on = cfg.profileIds.includes(p.id);
                  const name = p.label || p.fullName || '';
                  return (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5">
                      <input type="checkbox" checked={on} className="size-4 accent-[var(--accent)]"
                        onChange={() => set({ profileIds: on ? cfg.profileIds.filter((x) => x !== p.id) : [...cfg.profileIds, p.id] })} />
                      <Avatar name={name} size={24} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{name}</span>
                      <span className="text-[11.5px] text-muted">{t('{n} today', { n: c.today?.[p.id] || 0 })}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title={t('How it applies')}>
            <div className="flex flex-col gap-4">
              <div>
                <Segmented value={cfg.mode} onChange={(mode) => set({ mode })} options={[{ value: 'review', label: t('Review first') }, { value: 'auto', label: t('Full auto') }]} />
                <div className="mt-1.5 text-[12px] text-muted">
                  {cfg.mode === 'review'
                    ? t('Fills each form and leaves the tab open for you to check and press Submit (up to 3 waiting at a time).')
                    : t('Fills and submits by itself. Jobs it is unsure about are marked "Needs you".')}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>{t('Applications per profile per day')}</span>
                <Input type="number" min={1} max={500} className="w-20" value={cfg.perDay} onChange={(e) => set({ perDay: Number(e.target.value) })} />
              </label>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span>{t('Pause between applications (minutes)')}</span>
                <span className="flex items-center gap-1">
                  <Input type="number" min={0} max={120} className="w-16" value={cfg.gapMin} onChange={(e) => set({ gapMin: Number(e.target.value) })} />
                  <span className="text-muted">–</span>
                  <Input type="number" min={0} max={240} className="w-16" value={cfg.gapMax} onChange={(e) => set({ gapMax: Number(e.target.value) })} />
                </span>
              </div>
              <Toggle checked={cfg.onePerCompany} onChange={(onePerCompany) => set({ onePerCompany })}
                label={t('One profile per company')} hint={t('Two of your profiles never apply to the same company.')} />
            </div>
          </Card>

          <div className="card pad text-[12px] leading-relaxed text-muted">
            <b className="text-ink2">{t('It stops and marks "Needs you" when:')}</b>
            <ul className="mt-1 list-disc pl-4">
              <li>{t('a captcha must be solved')}</li>
              <li>{t('the site wants a sign-in or account')}</li>
              <li>{t('a required question has no answer')}</li>
              <li>{t('no Submit button or no confirmation is found')}</li>
            </ul>
            <div className="mt-2">{t('Keep Chrome open, signed in to this hub and to ChatGPT (if you use the ChatGPT website for AI).')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
