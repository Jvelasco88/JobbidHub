import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, ExternalLink, Search, Check, X, Users, CalendarDays } from 'lucide-react';
import { api } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Card, Empty, Input, PageHeader, Segmented, ago, cx, fmtDate } from '../components/ui';

// step: 'fill' (Fill pressed), 'submit' (Submit clicked after a fill), 'applied' (logged) - sent by the extension.
type Bid = { userId: string; user: string; profileId: string; profileName: string; date: string; status: string; step: 'fill' | 'submit' | 'applied'; me: boolean };
type Choice = { userId: string; user: string; choice: 'bid' | 'skip'; at: string };
type JobLink = { id: string; title: string; company: string; urls: string[]; site: string; bids: Bid[]; users: string[]; count: number; first: string; last: string; choices: Choice[]; myChoice: '' | 'bid' | 'skip' };

// The local calendar day of a time, e.g. "2026-11-05".
const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// Today / Last 3 days start at local midnight (today, or 2 days back), like the day headings.
const rangeQuery = (v: string) => {
  if (v !== 'today' && v !== '3d') return `days=${v}`;
  const d = new Date(); d.setHours(0, 0, 0, 0); if (v === '3d') d.setDate(d.getDate() - 2);
  // days (fraction since midnight) also works on a hub not yet restarted; since wins on a newer one.
  return `since=${encodeURIComponent(d.toISOString())}&days=${((Date.now() - d.getTime()) / 864e5).toFixed(5)}`;
};
const RANGES =[{ value: 'today', label: 'Today' }, { value: '3d', label: 'Last 3 days' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '0', label: 'All' }] as const;
const SHOW = ['all', 'mine', 'notMine', 'planned'] as const;

// Every job anyone on the team bid, grouped (the same job on several addresses is one row), so you can
// see who already applied before you bid, and mark "I'll bid" or "Skip" for the others to see.
export default function JobLinks() {
  const { t, prefs } = usePrefs();
  const qc = useQueryClient();
  const [days, setDays] = useState<(typeof RANGES)[number]['value']>('30');
  const [q, setQ] = useState('');
  const [show, setShow] = useState<(typeof SHOW)[number]>('all');
  const links = useQuery({ queryKey: ['joblinks', days], queryFn: () => api<JobLink[]>(`/joblinks?${rangeQuery(days)}`), refetchInterval: 30_000 });

  const choose = async (l: JobLink, choice: JobLink['myChoice']) => {
    const next = l.myChoice === choice ? '' : choice;
    qc.setQueryData<JobLink[]>(['joblinks', days], (old) => old?.map((x) => (x.id === l.id ? { ...x, myChoice: next } : x)));
    await api('/joblinks/choice', { method: 'PUT', body: { id: l.id, choice: next } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['joblinks'] });
  };

  const list = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (links.data || []).filter((l) => {
      if (show === 'mine' && !l.bids.some((b) => b.me)) return false;
      if (show === 'notMine' && l.bids.some((b) => b.me)) return false;
      if (show === 'planned' && !l.choices.some((c) => c.choice === 'bid')) return false;
      return !s || `${l.title} ${l.company} ${l.urls.join(' ')} ${l.users.join(' ')}`.toLowerCase().includes(s);
    });
  }, [links.data, q, show]);

  // Grouped by day (your computer's date), with the number of jobs that day.
  const perDay = useMemo(() => { const m = new Map<string, number>(); for (const l of list) m.set(dayOf(l.last), (m.get(dayOf(l.last)) || 0) + 1); return m; }, [list]);
  const dayLabel = (iso: string) => {
    const d = dayOf(iso);
    if (d === dayOf(new Date().toISOString())) return t('Today');
    if (d === dayOf(new Date(Date.now() - 864e5).toISOString())) return t('Yesterday');
    return new Date(iso).toLocaleDateString(prefs.lang === 'zh' ? 'zh-CN' : prefs.lang === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Link2 className="size-6 text-accent" />{t('Job links')}</span>}
        sub={t('Every job anyone on the team filled or applied to with JobBid, and who. Check here before you bid.')}
      />
      <div className="mb-[var(--gap)] flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search title, company, link or person')} />
        </div>
        <Segmented size="sm" value={show} onChange={(v) => setShow(v as typeof show)} options={[
          { value: 'all', label: t('All') }, { value: 'mine', label: t('I bid') }, { value: 'notMine', label: t('Not bid by me') }, { value: 'planned', label: t('Someone will bid') }]} />
        <Segmented size="sm" value={days} onChange={(v) => setDays(v as typeof days)} options={RANGES.map((r) => ({ value: r.value, label: t(r.label) }))} />
      </div>

      <Card title={t('{n} jobs', { n: list.length })} icon={<Users className="size-4" />}>
        {links.isLoading ? <div className="text-muted">{t('Loading…')}</div> : !list.length ? (
          <Empty icon={<Link2 className="size-6" />} title={t('No job links yet')}>{t('Jobs show up here by themselves when someone presses Fill (or Shift+Alt+F) on a job.')}</Empty>
        ) : (
          <div className="-mx-[var(--pad)] divide-y divide-line">
            {list.map((l, i) => {
              const planned = l.choices.filter((c) => c.choice === 'bid');
              const skipped = l.choices.filter((c) => c.choice === 'skip');
              const mine = l.bids.some((b) => b.me);
              // A heading where a new day starts (the list is newest first).
              const day = dayOf(l.last);
              const head = i === 0 || dayOf(list[i - 1].last) !== day;
              return (
                <Fragment key={l.id}>
                {head && (
                  <div className="flex items-center gap-2 bg-sunken px-[var(--pad)] py-1.5 text-[12.5px] font-semibold text-ink2">
                    <CalendarDays className="size-3.5 text-muted" />{dayLabel(l.last)}
                    <span className="font-normal text-muted">· {t('{n} jobs', { n: perDay.get(day) || 0 })}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-start gap-3 px-[var(--pad)] py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={l.urls[0]} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{l.title || t('Job')}</a>
                      <Badge tone={mine ? 'good' : l.count > 1 ? 'warn' : 'info'}>{t(l.count === 1 ? '{n} bid' : '{n} bids', { n: l.count })}</Badge>
                      {mine && <Badge tone="good">{t('You bid')}</Badge>}
                    </div>
                    <div className="truncate text-[12.5px] text-muted">{[l.company, l.site, `${t('last')} ${fmtDate(l.last, prefs.lang)} · ${ago(l.last, t)}`].filter(Boolean).join(' · ')}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {l.bids.map((b, i) => (
                        <span key={i} title={`${b.user}${b.profileName ? ` · ${b.profileName}` : ''} · ${fmtDate(b.date, prefs.lang)} · ${b.status}`}
                          className={cx('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11.5px]', b.me ? 'border-good/40 bg-good/10' : 'border-line')}>
                          <Avatar name={b.user} size={16} />{b.user}{b.profileName && <span className="text-muted">· {b.profileName}</span>}
                          {b.step !== 'applied' && <span className={cx('rounded px-1 text-[10.5px] font-semibold', b.step === 'fill' ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn')}>{t(b.status)} · {ago(b.date, t)}</span>}
                        </span>
                      ))}
                    </div>
                    {(planned.length > 0 || skipped.length > 0) && (
                      <div className="mt-1 text-[12px] text-ink2">
                        {planned.length > 0 && <span className="text-accent">{t('Will bid:')} {planned.map((c) => c.user).join(', ')}</span>}
                        {planned.length > 0 && skipped.length > 0 && ' · '}
                        {skipped.length > 0 && <span className="text-muted">{t('Skipped:')} {skipped.map((c) => c.user).join(', ')}</span>}
                      </div>
                    )}
                    {l.urls.length > 1 && (
                      <details className="mt-1 text-[12px] text-muted">
                        <summary className="cursor-pointer">{t('{n} addresses', { n: l.urls.length })}</summary>
                        {l.urls.map((u) => <div key={u} className="truncate"><a href={u} target="_blank" rel="noreferrer" className="hover:underline">{u}</a></div>)}
                      </details>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" variant={l.myChoice === 'bid' ? 'primary' : 'outline'} icon={<Check className="size-3.5" />} onClick={() => choose(l, 'bid')}>{t("I'll bid")}</Button>
                    <Button size="sm" variant={l.myChoice === 'skip' ? 'primary' : 'ghost'} icon={<X className="size-3.5" />} onClick={() => choose(l, 'skip')}>{t('Skip')}</Button>
                    <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(l.urls[0], '_blank')}>{t('Open')}</Button>
                  </div>
                </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
