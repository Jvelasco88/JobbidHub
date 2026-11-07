import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, Search as SearchIcon, Bookmark, BookmarkCheck, EyeOff, Eye, ExternalLink, CheckCircle2, XCircle, MapPin, Building2, Wallet, CalendarDays,
  Sparkles, FileText, Copy, Plus, LayoutList, LayoutGrid, Table2, AlertCircle, Send, RefreshCw, ChevronDown, Globe2, Layers,
} from 'lucide-react';
import { api, refresh, useBoot, profileName, type Job, type Profile } from '../api';
import { usePrefs } from '../prefs';
import {
  Avatar, Badge, Button, Card, Empty, Field, IconButton, Input, Loading, Menu, MenuItem, Modal, PageHeader, ScoreRing, Segmented, Select, Textarea, Toggle,
  ago, cx, fmtDate, useAction, useToast,
} from '../components/ui';

const STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'saved', label: 'Saved' },
  { value: 'applied', label: 'Applied' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'all', label: 'All' },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  browser: 'Seen in Chrome', manual: 'Added by you', remotive: 'Remotive', remoteok: 'Remote OK', jobicy: 'Jobicy', himalayas: 'Himalayas',
  arbeitnow: 'Arbeitnow', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', adzuna: 'Adzuna',
};

// Best score across profiles when no profile is selected.
function bestOf(j: Job, pid: string) {
  if (pid) return j.scores?.[pid] ? { ...j.scores[pid], pid } : null;
  let best: any = null;
  const rank = (s: any) => (s.qualified ? 1000 : 0) + s.score;
  for (const [id, s] of Object.entries(j.scores || {})) if (!best || rank(s) > rank(best)) best = { ...s, pid: id };
  return best;
}

export default function Jobs() {
  const { t, prefs, set } = usePrefs();
  const { data: boot } = useBoot();
  const profiles = boot?.profiles || [];
  const pid = prefs.profileId;
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<string>('active');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [days, setDays] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [qualifiedOnly, setQualifiedOnly] = useState(false);
  const [sort, setSort] = useState('best');
  const [adding, setAdding] = useState(false);
  const selected = params.get('id') || '';
  const select = (id: string) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('id', id); else n.delete('id'); return n; }, { replace: true });

  const qs = new URLSearchParams({ status, q, source, days, sort, profileId: pid, remote: remoteOnly ? '1' : '', qualified: qualifiedOnly && pid ? '1' : '', limit: '300' }).toString();
  const list = useQuery({ queryKey: ['jobs', 'list', qs], queryFn: () => api<{ counts: { total: number }; jobs: Job[] }>(`/jobs?${qs}`), placeholderData: (p) => p });
  const jobs = list.data?.jobs || [];

  // Split view always shows a job: the one in the URL, else the first.
  useEffect(() => {
    if (prefs.jobView === 'split' && jobs.length && !jobs.some((j) => j.id === selected) && !params.get('id')) select(jobs[0].id);
  }, [jobs, prefs.jobView]);

  // Keyboard: j / k to move, s save, h hide, o open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = jobs.findIndex((j) => j.id === selected);
      if (e.key === 'j' || e.key === 'ArrowDown') { if (jobs[i + 1]) { select(jobs[i + 1].id); e.preventDefault(); } }
      if (e.key === 'k' || e.key === 'ArrowUp') { if (i > 0) { select(jobs[i - 1].id); e.preventDefault(); } }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [jobs, selected]);

  const sources = useMemo(() => Object.keys(SOURCE_LABEL), []);
  const views = [
    { value: 'split', label: <LayoutList className="size-4" />, title: t('List + details') },
    { value: 'cards', label: <LayoutGrid className="size-4" />, title: t('Cards') },
    { value: 'table', label: <Table2 className="size-4" />, title: t('Table') },
  ] as const;

  return (
    <div className="fade-up">
      <PageHeader
        title={t('Job board')}
        sub={pid ? t('Scores for {name}. Pick another profile in the menu.', { name: profileName(profiles.find((p) => p.id === pid)) }) : t('Showing the best score of all profiles. Pick a profile in the menu to see its matches.')}
        actions={<>
          <Segmented value={prefs.jobView} onChange={(v) => set({ jobView: v })} options={views as any} />
          <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t('Add job')}</Button>
        </>}
      />

      {/* Filters */}
      <div className="card mb-[var(--gap)] flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[200px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search title, company, skill…')} className="pl-9" />
        </div>
        <Segmented size="sm" value={status} onChange={setStatus} options={STATUS_TABS.map((s) => ({ value: s.value, label: t(s.label) }))} />
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="!w-auto">
          <option value="">{t('Any time')}</option>
          <option value="1">{t('Last 24 hours')}</option>
          <option value="3">{t('Last 3 days')}</option>
          <option value="7">{t('Last 7 days')}</option>
          <option value="30">{t('Last 30 days')}</option>
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="!w-auto">
          <option value="">{t('All sources')}</option>
          {sources.map((s) => <option key={s} value={s}>{t(SOURCE_LABEL[s])}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto">
          <option value="best">{t('Best match')}</option>
          <option value="new">{t('Newest')}</option>
          <option value="company">{t('Company')}</option>
        </Select>
        <div className="flex items-center gap-4 px-1">
          <Toggle checked={remoteOnly} onChange={setRemoteOnly} label={<span className="text-[13px]">{t('Remote')}</span>} />
          {pid && <Toggle checked={qualifiedOnly} onChange={setQualifiedOnly} label={<span className="text-[13px]">{t('Qualified only')}</span>} />}
        </div>
        <span className="ml-auto pr-1 text-[12px] text-muted tnum">{t('{n} jobs', { n: list.data?.counts.total ?? 0 })}</span>
      </div>

      {list.isLoading ? <Loading /> : !jobs.length ? (
        <div className="card">
          <Empty icon={<Briefcase className="size-5" />} title={t('No jobs here')}>
            {t('Run a job search, or open job pages in Chrome with the extension: they are added here automatically.')}
          </Empty>
        </div>
      ) : prefs.jobView === 'table' ? (
        <JobTable jobs={jobs} pid={pid} onOpen={(id) => { set({ jobView: 'split' }); select(id); }} />
      ) : prefs.jobView === 'cards' ? (
        <div className="grid gap-d sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((j) => <JobCard key={j.id} job={j} pid={pid} onOpen={() => { set({ jobView: 'split' }); select(j.id); }} />)}
        </div>
      ) : (
        <div className="grid gap-d lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
          <div className="card scroll-thin max-h-[calc(100vh-230px)] overflow-y-auto p-1.5 lg:sticky lg:top-4">
            {jobs.map((j) => <JobRow key={j.id} job={j} pid={pid} active={j.id === selected} onClick={() => select(j.id)} />)}
          </div>
          <div className="min-w-0">{selected ? <JobDetail id={selected} profiles={profiles} /> : null}</div>
        </div>
      )}

      <AddJobModal open={adding} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); set({ jobView: 'split' }); select(id); }} />
    </div>
  );
}

function Meta({ job }: { job: Job }) {
  const { t } = usePrefs();
  return (
    <>
      <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" />{job.company || '—'}</span>
      <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{job.remote ? (!job.location || /^remote$/i.test(job.location) ? t('Remote') : /remote/i.test(job.location) ? job.location : `${t('Remote')} · ${job.location}`) : job.location || t('Location not listed')}</span>
    </>
  );
}

function StatusBadge({ job }: { job: Job }) {
  const { t } = usePrefs();
  if (job.status === 'applied') return <Badge tone="bad"><CheckCircle2 className="size-3" />{t('Applied')}</Badge>;
  if (job.status === 'saved') return <Badge tone="accent"><Bookmark className="size-3" />{t('Saved')}</Badge>;
  if (job.status === 'hidden') return <Badge><EyeOff className="size-3" />{t('Hidden')}</Badge>;
  if (job.source === 'browser') return <Badge tone="info"><Globe2 className="size-3" />{t('Seen')}</Badge>;
  return null;
}

function JobRow({ job, pid, active, onClick }: { job: Job; pid: string; active: boolean; onClick: () => void }) {
  const { t } = usePrefs();
  const s = bestOf(job, pid);
  return (
    <button onClick={onClick} className={cx('flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition', active ? 'bg-accent/10' : 'hover:bg-sunken')}>
      <ScoreRing score={s?.score} qualified={s?.qualified} size={42} />
      <div className="min-w-0 flex-1">
        <div className={cx('clamp2 text-[13.5px] font-semibold leading-snug', active && 'text-accent')}>{job.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted"><Meta job={job} /></div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge job={job} />
          {s && s.qualified === false && <Badge tone="bad">{t('Disqualified')}</Badge>}
          {job.salary && <Badge tone="good">{job.salary}</Badge>}
          <span className="text-[11.5px] text-muted">{ago(job.postedAt || job.foundAt, t)}</span>
        </div>
      </div>
    </button>
  );
}

function JobCard({ job, pid, onOpen }: { job: Job; pid: string; onOpen: () => void }) {
  const { t } = usePrefs();
  const s = bestOf(job, pid);
  return (
    <button onClick={onOpen} className="card pad flex flex-col gap-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        <ScoreRing score={s?.score} qualified={s?.qualified} size={46} />
        <div className="min-w-0 flex-1">
          <div className="clamp2 text-[14px] font-bold leading-snug">{job.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted"><Meta job={job} /></div>
        </div>
      </div>
      <p className="clamp3 text-[12.5px] text-ink2">{job.excerpt}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <StatusBadge job={job} />
        {job.salary && <Badge tone="good">{job.salary}</Badge>}
        {(s?.matched || []).slice(0, 3).map((m: string) => <Badge key={m} tone="accent">{m}</Badge>)}
        <span className="ml-auto text-[11.5px] text-muted">{ago(job.postedAt || job.foundAt, t)}</span>
      </div>
    </button>
  );
}

function JobTable({ jobs, pid, onOpen }: { jobs: Job[]; pid: string; onOpen: (id: string) => void }) {
  const { t } = usePrefs();
  return (
    <div className="card scroll-thin overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead className="text-left text-[11.5px] font-bold uppercase tracking-wide text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2.5 w-16">{t('Match')}</th><th className="px-3">{t('Job')}</th><th className="px-3">{t('Company')}</th>
            <th className="px-3">{t('Location')}</th><th className="px-3">{t('Salary')}</th><th className="px-3">{t('Posted')}</th><th className="px-3">{t('Source')}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const s = bestOf(j, pid);
            return (
              <tr key={j.id} onClick={() => onOpen(j.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken">
                <td className="px-3 py-2"><ScoreRing score={s?.score} qualified={s?.qualified} size={34} /></td>
                <td className="px-3 py-2 font-semibold"><div className="flex items-center gap-2"><span className="clamp2">{j.title}</span><StatusBadge job={j} /></div></td>
                <td className="px-3 py-2 text-ink2">{j.company}</td>
                <td className="px-3 py-2 text-ink2">{j.remote ? t('Remote') : j.location}</td>
                <td className="px-3 py-2 text-ink2 whitespace-nowrap">{j.salary}</td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">{ago(j.postedAt || j.foundAt, t)}</td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">{t(SOURCE_LABEL[j.source] || j.source)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// One button when the profile is known, else a menu to pick the profile.
function ProfilePick({ label, icon, onPick, busyKey, busy, profiles, pid, variant = 'outline' }: { label: string; icon: any; onPick: (id: string) => void; busyKey: string; busy: string; profiles: Profile[]; pid: string; variant?: any }) {
  const { t } = usePrefs();
  if (!profiles.length) return null;
  if (pid || profiles.length === 1) return <Button variant={variant} icon={icon} busy={busy === busyKey} onClick={() => onPick(pid || profiles[0].id)}>{t(label)}</Button>;
  return (
    <Menu button={({ onClick }) => <Button variant={variant} icon={icon} busy={busy === busyKey} onClick={onClick}>{t(label)}<ChevronDown className="size-3.5" /></Button>}>
      {(close) => profiles.map((p) => <MenuItem key={p.id} icon={<Avatar name={profileName(p)} size={22} />} onClick={() => { close(); onPick(p.id); }}>{profileName(p)}</MenuItem>)}
    </Menu>
  );
}

function JobDetail({ id, profiles }: { id: string; profiles: Profile[] }) {
  const { t, prefs } = usePrefs();
  const toast = useToast();
  const { busy, run } = useAction();
  const pid = prefs.profileId;
  const q = useQuery({ queryKey: ['jobs', 'one', id], queryFn: () => api<Job>(`/jobs/${id}`) });
  const [letter, setLetter] = useState<{ pid: string; text: string } | null>(null);
  const [openScore, setOpenScore] = useState<string>('');
  useEffect(() => { setLetter(null); setOpenScore(''); }, [id]);
  const job = q.data;
  if (q.isLoading) return <div className="card"><Loading /></div>;
  if (!job) return <div className="card"><Empty title={t('Job not found')} /></div>;

  const patch = (body: any, ok?: string) => run('patch', async () => { await api(`/jobs/${job.id}`, { method: 'PATCH', body }); refresh('jobs'); }, ok);
  const markApplied = (profileId: string) => run('applied', async () => {
    await api('/applications', { body: { profileId, jobId: job.id } });
    refresh('jobs', 'apps');
  }, 'Logged as applied');
  const aiMatch = (profileId: string) => run('ai', async () => { await api(`/jobs/${job.id}/ai-match`, { body: { profileId } }); refresh('jobs'); });
  const makeLetter = (profileId: string) => run('letter', async () => {
    const r = await api<{ text: string }>(`/jobs/${job.id}/cover-letter`, { body: { profileId } });
    setLetter({ pid: profileId, text: r.text });
  });
  const applyUrl = job.applyUrl || job.url;
  const mineApplied = (job.appliedBy || []).filter((a) => !pid || a.profileId === pid);
  const otherApplied = (job.appliedBy || []).filter((a) => pid && a.profileId !== pid);
  const ordered = [...profiles].sort((a, b) => (a.id === pid ? -1 : b.id === pid ? 1 : (job.scores?.[b.id]?.score ?? 0) - (job.scores?.[a.id]?.score ?? 0)));
  const current = pid ? job.scores?.[pid] : null;
  const ai = pid ? job.details?.ai?.[pid] : null;
  const savedLetter = letter?.text || (pid && job.details?.letters?.[pid]?.text) || '';

  return (
    <div className="flex flex-col gap-d">
      <Card>
        <div className="flex items-start gap-4">
          {current ? <ScoreRing score={current.score} qualified={current.qualified} size={58} /> : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-extrabold leading-snug tracking-tight">{job.title}</h2>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink2">
              <Meta job={job} />
              {job.salary && <span className="inline-flex items-center gap-1"><Wallet className="size-3.5" />{job.salary}</span>}
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{job.postedAt ? `${t('Posted')} ${ago(job.postedAt, t)}` : `${t('Found')} ${ago(job.foundAt, t)}`}</span>
              {job.employmentType && <span className="inline-flex items-center gap-1"><Briefcase className="size-3.5" />{job.employmentType}</span>}
              {job.seniority && <span className="inline-flex items-center gap-1"><Layers className="size-3.5" />{job.seniority}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge job={job} /><Badge>{t(SOURCE_LABEL[job.source] || job.source)}</Badge></div>
          </div>
        </div>

        {/* Already applied */}
        {mineApplied.length > 0 && (
          <div className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-bad/25 bg-bad/10 px-3.5 py-2.5 text-[13px] text-bad">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div><b>{pid ? t('You already applied before!') : t('Already applied')}</b>
              <div className="text-[12px] opacity-90">{mineApplied.map((a) => `${a.profileName} · ${fmtDate(a.date, prefs.lang)} (${ago(a.date, t)})`).join(' — ')}</div></div>
          </div>
        )}
        {otherApplied.length > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-[12px] border border-warn/25 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>{otherApplied.map((a) => t('{name} applied {when}', { name: a.profileName, when: ago(a.date, t) })).join(' · ')}</div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<ExternalLink className="size-4" />} onClick={() => { window.open(applyUrl, '_blank', 'noopener'); }}>{t('Open & apply')}</Button>
          <ProfilePick profiles={profiles} pid={pid} busy={busy} label="Mark as applied" icon={<Send className="size-4" />} onPick={markApplied} busyKey="applied" />
          {job.status === 'saved'
            ? <Button icon={<BookmarkCheck className="size-4" />} onClick={() => patch({ status: 'new' })}>{t('Saved')}</Button>
            : <Button icon={<Bookmark className="size-4" />} onClick={() => patch({ status: 'saved' }, 'Saved')}>{t('Save')}</Button>}
          {job.status === 'hidden'
            ? <Button icon={<Eye className="size-4" />} onClick={() => patch({ status: 'new' })}>{t('Unhide')}</Button>
            : <Button variant="ghost" icon={<EyeOff className="size-4" />} onClick={() => patch({ status: 'hidden' }, 'Hidden')}>{t('Hide')}</Button>}
          <IconButton label={t('Copy link')} onClick={() => { navigator.clipboard.writeText(applyUrl); toast('ok', t('Link copied')); }}><Copy className="size-4" /></IconButton>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">{t('"Open & apply" opens the job in Chrome; the JobBid extension fills it and logs it here.')}</p>
      </Card>

      {/* Match per profile */}
      <Card title={t('Match by profile')} icon={<Sparkles className="size-4" />}
        actions={<ProfilePick profiles={profiles} pid={pid} busy={busy} label="AI check" icon={<Sparkles className="size-4" />} onPick={aiMatch} busyKey="ai" variant="soft" />}>
        <ul className="flex flex-col gap-1">
          {ordered.map((p) => {
            const s = job.scores?.[p.id];
            if (!s) return null;
            const open = openScore === p.id || (!openScore && p.id === (pid || ordered[0]?.id));
            const a = job.details?.ai?.[p.id];
            return (
              <li key={p.id} className={cx('rounded-[12px] border border-transparent', open && 'border-line bg-sunken/60')}>
                <button className="flex w-full items-center gap-3 px-2.5 py-2 text-left" onClick={() => setOpenScore(open ? '-' : p.id)}>
                  <Avatar name={profileName(p)} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{profileName(p)}</span>
                  {a && <Badge tone="info" title={a.verdict}>AI {a.score}%</Badge>}
                  {s.qualified ? <Badge tone="good"><CheckCircle2 className="size-3" />{t('Qualified')}</Badge> : <Badge tone="bad"><XCircle className="size-3" />{t('Disqualified')}</Badge>}
                  <ScoreRing score={s.score} qualified={s.qualified} size={36} />
                </button>
                {open && (
                  <div className="px-3 pb-3 text-[13px]">
                    {s.reasons.length > 0 && (
                      <ul className="mb-2.5 flex flex-col gap-1">
                        {s.reasons.map((r, i) => (
                          <li key={i} className={cx('flex items-start gap-2', r.ok ? 'text-good' : 'text-bad')}>
                            {r.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}<span>{t(r.text)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.matched.length > 0 && <div className="mb-1.5 flex flex-wrap items-center gap-1.5"><span className="text-[12px] font-semibold text-muted">{t('Has')}</span>{s.matched.map((m) => <Badge key={m} tone="good">{m}</Badge>)}</div>}
                    {s.missing.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-[12px] font-semibold text-muted">{t('Missing')}</span>{s.missing.map((m) => <Badge key={m}>{m}</Badge>)}</div>}
                    {a && (
                      <div className="mt-3 rounded-[10px] border border-info/20 bg-info/5 p-3">
                        <div className="mb-1 flex items-center gap-2 font-semibold text-info"><Sparkles className="size-3.5" />{a.verdict} · {a.score}%</div>
                        <p className="text-ink2">{a.summary}</p>
                        {(a.redFlags || []).length > 0 && <p className="mt-1.5 text-bad">{t('Red flags')}: {a.redFlags.join(', ')}</p>}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {s.override !== 'qualified' && <Button size="sm" variant="soft" onClick={() => patch({ override: { profileId: p.id, value: 'qualified' } }, 'Marked as qualified')}>{t('Mark as qualified')}</Button>}
                      {s.override !== 'disqualified' && <Button size="sm" variant="ghost" onClick={() => patch({ override: { profileId: p.id, value: 'disqualified' } })}>{t('Mark as disqualified')}</Button>}
                      {s.override && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => patch({ override: { profileId: p.id, value: '' } })}>{t('Back to automatic')}</Button>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Cover letter */}
      <Card title={t('Cover letter')} icon={<FileText className="size-4" />}
        actions={<ProfilePick profiles={profiles} pid={pid} busy={busy} label={savedLetter ? 'Write again' : 'Write with AI'} icon={<Sparkles className="size-4" />} onPick={makeLetter} busyKey="letter" variant="soft" />}>
        {savedLetter ? (
          <>
            <Textarea rows={12} value={savedLetter} onChange={(e) => setLetter({ pid: letter?.pid || pid, text: e.target.value })} />
            <div className="mt-2 flex justify-end"><Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => { navigator.clipboard.writeText(savedLetter); toast('ok', t('Copied')); }}>{t('Copy')}</Button></div>
          </>
        ) : <p className="text-[13px] text-muted">{t('A new letter written for this job and profile. Each job gets its own letter.')}</p>}
      </Card>

      <Card title={t('Description')} icon={<FileText className="size-4" />}
        actions={job.tags?.length ? <div className="hidden flex-wrap justify-end gap-1 md:flex">{job.tags.slice(0, 5).map((x) => <Badge key={x}>{x}</Badge>)}</div> : null}>
        <div className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink2">{job.description || t('No description saved for this job. Open it to read the full posting.')}</div>
      </Card>
    </div>
  );
}

function AddJobModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const { t } = usePrefs();
  const { busy, run } = useAction();
  const [f, setF] = useState({ url: '', title: '', company: '', location: '', remote: false, salary: '', description: '' });
  const up = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run('add', async () => {
    const j = await api<Job>('/jobs/manual', { body: f });
    refresh('jobs');
    setF({ url: '', title: '', company: '', location: '', remote: false, salary: '', description: '' });
    onAdded(j.id);
  }, 'Job added');
  return (
    <Modal open={open} onClose={onClose} title={t('Add a job')} wide
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" busy={busy === 'add'} disabled={!f.url || !f.title} onClick={save}>{t('Add job')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Link')} className="sm:col-span-2"><Input value={f.url} onChange={(e) => up('url', e.target.value)} placeholder="https://" /></Field>
        <Field label={t('Job title')}><Input value={f.title} onChange={(e) => up('title', e.target.value)} /></Field>
        <Field label={t('Company')}><Input value={f.company} onChange={(e) => up('company', e.target.value)} /></Field>
        <Field label={t('Location')}><Input value={f.location} onChange={(e) => up('location', e.target.value)} /></Field>
        <Field label={t('Salary')}><Input value={f.salary} onChange={(e) => up('salary', e.target.value)} placeholder="$120k-$150k" /></Field>
        <div className="sm:col-span-2"><Toggle checked={f.remote} onChange={(v) => up('remote', v)} label={t('Remote')} /></div>
        <Field label={t('Description')} hint={t('Paste the job description so it can be scored for each profile.')} className="sm:col-span-2">
          <Textarea rows={8} value={f.description} onChange={(e) => up('description', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
