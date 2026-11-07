import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, Search, ExternalLink, Check, Copy, ChevronDown, ChevronRight, Trash2, RotateCcw, Gauge } from 'lucide-react';
import { api, useMe } from '../api';
import { usePrefs } from '../prefs';
import { Badge, Button, Card, Empty, IconButton, Input, PageHeader, Segmented, Select, ago, cx, useToast } from '../components/ui';

type Status = 'failed' | 'cleared' | 'site-error' | 'unanswered';
type Sample = { id: number; at: string; status: Status; kind: string; required: boolean; options: string[]; value: string; error: string; html: string; url: string; title: string; company: string; profileName: string; version: string; platform: string };
type Group = { key: string; q: string; count: number; last: string; first: string; statuses: Partial<Record<Status, number>>; platforms: Record<string, number>; kinds: Record<string, number>; samples: Sample[]; done: null | { at: string; by: string; again?: boolean } };
type Stat = { platform: string; fills: number; fields: number; filled: number; problems: number; clean: number; last: string; avgMs?: number | null };

// What each kind of problem means, in plain words.
const STATUS: Record<Status, { label: string; tone: 'bad' | 'warn' | 'info' | 'neutral'; hint: string }> = {
  cleared: { label: 'Cleared by site', tone: 'bad', hint: 'JobBid filled it, then the site emptied it again.' },
  failed: { label: 'Not accepted', tone: 'warn', hint: 'JobBid had an answer, but the box would not take it (no matching option, nothing chosen, or an error).' },
  'site-error': { label: 'Site error', tone: 'bad', hint: 'Filled, but the site shows a red error under it.' },
  unanswered: { label: 'No answer', tone: 'info', hint: 'A required question JobBid had no answer for.' },
};
const DAYS = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '60', label: '60 days' }] as const;

// Everything about a question, ready to paste to whoever fixes JobBid.
const forFixing = (g: Group) => JSON.stringify({ question: g.q, times: g.count, statuses: g.statuses, sites: g.platforms, cases: g.samples.map(({ id, profileName, ...s }) => s) }, null, 1);

// What Fill got wrong, sent by the extension after every fill, grouped by question (most frequent first).
export default function Problems() {
  const { t } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [days, setDays] = useState<(typeof DAYS)[number]['value']>('30');
  const [status, setStatus] = useState<'' | Status>('');
  const [platform, setPlatform] = useState('');
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<string>('');
  const groups = useQuery({ queryKey: ['problems', days, showDone], queryFn: () => api<Group[]>(`/fill-problems?days=${days}${showDone ? '&done=1' : ''}`), refetchInterval: 30_000 });
  const stats = useQuery({ queryKey: ['fillstats', days], queryFn: () => api<Stat[]>(`/fill-reports/stats?days=${days}`), refetchInterval: 60_000 });

  const platforms = useMemo(() => [...new Set((groups.data || []).flatMap((g) => Object.keys(g.platforms)))].sort(), [groups.data]);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (groups.data || []).filter((g) => (!status || g.statuses[status]) && (!platform || g.platforms[platform]) && words.every((w) => g.q.toLowerCase().includes(w)));
  }, [groups.data, status, platform, q]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast('ok', t('{what} copied', { what })); }
    catch { toast('err', t('Could not copy. Select the text and copy it yourself.')); }
  };
  const setDone = async (g: Group, done: boolean) => {
    await api('/fill-problems/done', { method: 'PUT', body: { key: g.key, done } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['problems'] });
  };
  const remove = async (g: Group) => {
    if (!confirm(t('Delete every case of this question?'))) return;
    await api(`/fill-problems?key=${encodeURIComponent(g.key)}`, { method: 'DELETE' }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['problems'] });
  };

  return (
    <div className="fade-up">
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Bug className="size-6 text-accent" />{t('Problems')}</span>}
        sub={t('What Fill got wrong, sent by the extension after every fill and grouped by question. Copy the top ones for fixing, then mark them Fixed.')}
        actions={list.length ? <Button icon={<Copy className="size-4" />} onClick={() => copy(`[\n${list.slice(0, 25).map(forFixing).join(',\n')}\n]`, t('Top {n} problems', { n: Math.min(25, list.length) }))}>{t('Copy top 25')}</Button> : null}
      />

      <Card title={t('How Fill is doing')} icon={<Gauge className="size-4" />} className="mb-[var(--gap)]">
        {!stats.data?.length ? <div className="text-[13px] text-muted">{t('No fills reported yet. Reports start with extension 3.9.41.')}</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-3 font-semibold">{t('Site')}</th><th className="px-3 text-right font-semibold">{t('Fills')}</th>
                <th className="px-3 text-right font-semibold">{t('Boxes filled')}</th><th className="px-3 text-right font-semibold">{t('Fills with no problem')}</th>
                <th className="px-3 text-right font-semibold">{t('Problems')}</th><th className="px-3 text-right font-semibold">{t('Avg. fill time')}</th><th className="pl-3 text-right font-semibold">{t('Last')}</th></tr></thead>
              <tbody>
                {stats.data.map((s) => (
                  <tr key={s.platform} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium">
                      <button className={cx('hover:text-accent', platform === s.platform && 'text-accent')} onClick={() => setPlatform(platform === s.platform ? '' : s.platform)}>{s.platform || '—'}</button>
                    </td>
                    <td className="px-3 text-right tabular-nums">{s.fills}</td>
                    <td className="px-3 text-right tabular-nums">{s.fields ? Math.round((100 * s.filled) / s.fields) : 0}%</td>
                    <td className="px-3 text-right tabular-nums">{Math.round((100 * s.clean) / s.fills)}%</td>
                    <td className="px-3 text-right tabular-nums">{s.problems}</td>
                    <td className="px-3 text-right tabular-nums">{s.avgMs ? `${(s.avgMs / 1000).toFixed(1)} s` : '—'}</td>
                    <td className="pl-3 text-right text-muted">{ago(s.last, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-[var(--gap)] flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search questions…')} />
        </div>
        <Segmented size="sm" value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: '', label: t('All') }, ...(Object.keys(STATUS) as Status[]).map((k) => ({ value: k, label: t(STATUS[k].label), title: t(STATUS[k].hint) }))]} />
        <Select value={platform} onChange={(e) => setPlatform(e.target.value)} className="!w-auto">
          <option value="">{t('Every site')}</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Segmented size="sm" value={days} onChange={(v) => setDays(v as typeof days)} options={DAYS.map((d) => ({ value: d.value, label: t(d.label) }))} />
        <Button size="sm" variant={showDone ? 'primary' : 'outline'} onClick={() => setShowDone(!showDone)}>{t('Show fixed')}</Button>
      </div>

      {groups.isLoading ? <div className="text-muted">{t('Loading…')}</div> : !list.length ? (
        <div className="card"><Empty icon={<Check className="size-5" />} title={t('No problems reported')}>{t('After each Fill the extension sends what went wrong here by itself.')}</Empty></div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((g) => {
            const isOpen = open === g.key;
            const fixed = !!g.done && !g.done.again;
            return (
              <div key={g.key} className={cx('card px-4 py-3', fixed && 'opacity-60')}>
                <div className="flex flex-wrap items-start gap-2">
                  <button className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => setOpen(isOpen ? '' : g.key)}>
                    {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" />}
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium leading-snug">{g.q}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                        <Badge tone="accent">{t('{n}×', { n: g.count })}</Badge>
                        {(Object.keys(g.statuses) as Status[]).map((k) => <Badge key={k} tone={STATUS[k].tone} title={t(STATUS[k].hint)}>{t(STATUS[k].label)} {g.statuses[k]}</Badge>)}
                        {Object.entries(g.platforms).map(([p, n]) => <Badge key={p}>{p}{n > 1 ? ` ${n}` : ''}</Badge>)}
                        <span>{ago(g.last, t)}</span>
                        {g.done?.again && <Badge tone="warn">{t('Back after Fixed')}</Badge>}
                        {fixed && <Badge tone="good">{t('Fixed')}</Badge>}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <IconButton label={t('Copy for fixing')} onClick={() => copy(forFixing(g), t('Problem'))}><Copy className="size-4" /></IconButton>
                    {fixed
                      ? <IconButton label={t('Not fixed')} onClick={() => setDone(g, false)}><RotateCcw className="size-4" /></IconButton>
                      : <Button size="sm" icon={<Check className="size-4" />} onClick={() => setDone(g, true)}>{t('Fixed')}</Button>}
                    {me?.role === 'admin' && <IconButton label={t('Delete')} onClick={() => remove(g)}><Trash2 className="size-4" /></IconButton>}
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                    {g.samples.map((s) => (
                      <div key={s.id} className="flex flex-col gap-1.5 text-[12.5px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}</Badge>
                          <span className="text-muted">{s.kind}{s.required ? ' · ' + t('required') : ''} · {ago(s.at, t)}{s.version ? ` · v${s.version}` : ''}{s.profileName ? ` · ${s.profileName}` : ''}</span>
                          {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                            {[s.company, s.title].filter(Boolean).join(' · ') || s.platform}<ExternalLink className="size-3" /></a>}
                        </div>
                        {s.value && <div><span className="text-muted">{t('Tried')}:</span> <span className="font-medium">{s.value}</span></div>}
                        {s.error && <div className="text-bad">{s.error}</div>}
                        {!!s.options.length && <div className="text-muted">{t('Options')}: {s.options.map((o) => o || '""').join(' | ')}</div>}
                        {s.html && (
                          <details>
                            <summary className="cursor-pointer text-muted hover:text-ink">{t('Page code')}</summary>
                            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-2 font-mono text-[11px]">{s.html}</pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
