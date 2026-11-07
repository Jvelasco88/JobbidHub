import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarDays, Clock, Target, Users, Globe2, StickyNote, History, ExternalLink } from 'lucide-react';
import { api, refresh, useApps, useBoot, profileName, type Application, type ScheduleBlock } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Card, Empty, IconButton, Input, PageHeader, Progress, Textarea, cx, useAction } from '../components/ui';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);
const toMin = (hhmm: string) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const fmtDur = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const tone = (s: string) => (s === 'Offer' || s === 'Interview' ? 'good' : s === 'Rejected' ? 'bad' : s === 'No reply' ? 'warn' : 'neutral') as any;

// One day's numbers: applications, the schedule goal for that weekday, active time.
function dayStats(apps: Application[], blocks: ScheduleBlock[], d: Date) {
  const list = apps.filter((a) => sameDay(new Date(a.date), d)).sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const dayBlocks = blocks.filter((b) => (b.days || []).includes(d.getDay())).sort((a, b) => toMin(a.start) - toMin(b.start));
  const goal = dayBlocks.reduce((s, b) => s + (Number(b.target) || 0), 0);
  const first = list[0] ? new Date(list[0].date) : null, last = list.length ? new Date(list[list.length - 1].date) : null;
  return { list, blocks: dayBlocks, goal, first, last, active: first && last ? +last - +first : 0, wins: list.filter((a) => /interview|offer/i.test(a.status)).length };
}

export default function DailyLog() {
  const { t, prefs } = usePrefs();
  const { data: boot } = useBoot();
  const { data: apps = [] } = useApps();
  const notes = useQuery({ queryKey: ['daynotes'], queryFn: () => api<Record<string, string>>('/daynotes') });
  const { busy, run } = useAction();
  const [day, setDay] = useState(() => new Date());
  const key = ymd(day);
  const [note, setNote] = useState('');
  useEffect(() => setNote(notes.data?.[key] || ''), [key, notes.data]);
  const profiles = boot?.profiles || [];
  const blocks = boot?.schedule?.blocks || [];
  const st = useMemo(() => dayStats(apps, blocks, day), [apps, blocks, key]);
  const isToday = sameDay(day, new Date());
  const pct = st.goal ? Math.round((st.list.length / st.goal) * 100) : null;
  const loc = prefs.lang === 'en' ? 'en-US' : prefs.lang === 'ko' ? 'ko-KR' : 'zh-CN';
  const time = (d: Date) => d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const move = (n: number) => { const d = new Date(day); d.setDate(d.getDate() + n); if (d <= new Date()) setDay(d); };
  const saveNote = () => run('note', async () => { await api(`/daynotes/${key}`, { method: 'PUT', body: { text: note } }); refresh('daynotes'); }, 'Saved');

  const ids = [...new Set([...st.list.map((a) => a.profileId), ...st.blocks.map((b) => b.profileId)])];
  const sites = Object.entries(st.list.reduce((m: Record<string, number>, a) => ((m[a.site || 'unknown'] = (m[a.site || 'unknown'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const maxSite = Math.max(1, ...sites.map(([, n]) => n));
  const history = useMemo(() => [...Array(30)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); return { d, ...dayStats(apps, blocks, d) }; }), [apps, blocks]);

  return (
    <div className="fade-up">
      <PageHeader title={t('Daily log')} sub={day.toLocaleDateString(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + (isToday ? ` · ${t('today')}` : '')}
        actions={<div className="flex items-center gap-1">
          <IconButton label={t('Previous day')} onClick={() => move(-1)}><ChevronLeft className="size-4" /></IconButton>
          <Input type="date" value={key} max={ymd(new Date())} onChange={(e) => e.target.value && setDay(fromYmd(e.target.value))} className="!w-auto" />
          <IconButton label={t('Next day')} disabled={isToday} onClick={() => move(1)} className="disabled:opacity-30"><ChevronRight className="size-4" /></IconButton>
          {!isToday && <Button size="sm" variant="soft" onClick={() => setDay(new Date())}>{t('Today')}</Button>}
        </div>} />

      <div className="grid grid-cols-2 gap-d lg:grid-cols-4">
        {[
          { icon: <CalendarDays className="size-5" />, label: t('Applied'), value: st.list.length, sub: st.goal ? t('goal {n}', { n: st.goal }) : t('no schedule goal') },
          { icon: <Target className="size-5" />, label: t('Goal reached'), value: pct == null ? '–' : `${pct}%`, sub: pct != null ? <Progress value={st.list.length} max={st.goal} tone={pct >= 100 ? 'good' : 'accent'} /> : null },
          { icon: <Clock className="size-5" />, label: t('Active time'), value: st.active ? fmtDur(st.active) : st.list.length ? '< 1m' : '–', sub: st.first ? `${time(st.first)} – ${time(st.last!)}` : '' },
          { icon: <Users className="size-5" />, label: t('Profiles used'), value: new Set(st.list.map((a) => a.profileId)).size, sub: st.wins ? t('{n} interviews / offers so far', { n: st.wins }) : '' },
        ].map((k) => (
          <div key={k.label} className="card pad flex items-center gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent/10 text-accent">{k.icon}</span>
            <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-muted">{k.label}</div><div className="text-[22px] font-extrabold leading-tight tnum">{k.value}</div>{k.sub && <div className="mt-1 text-[11.5px] text-muted">{k.sub}</div>}</div>
          </div>
        ))}
      </div>

      <div className="mt-[var(--gap)] grid gap-d xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title={t('{n} applications', { n: st.list.length })} icon={<CalendarDays className="size-4" />}>
          {st.list.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {st.list.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="w-14 shrink-0 text-[12.5px] font-semibold text-muted tnum">{time(new Date(a.date))}</span>
                  <Avatar name={a.profileName} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{a.title || t('Untitled job')}</div>
                    <div className="truncate text-[12px] text-muted">{[a.company, a.site, a.profileName].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Badge tone={tone(a.status || 'Applied')}>{t(a.status || 'Applied')}</Badge>
                  {a.url && <IconButton label={t('Open')} onClick={() => window.open(a.url, '_blank', 'noopener')}><ExternalLink className="size-4" /></IconButton>}
                </li>
              ))}
            </ul>
          ) : <Empty title={t('No applications logged')}>{isToday ? t('Applications you log today show up here with their time.') : t('Nothing was logged on this day.')}</Empty>}
        </Card>

        <div className="flex flex-col gap-d">
          <Card title={t('By profile')} icon={<Users className="size-4" />}>
            {ids.length ? ids.map((id) => {
              const p = profiles.find((x) => x.id === id);
              const name = p ? profileName(p) : st.list.find((a) => a.profileId === id)?.profileName || t('Deleted profile');
              const n = st.list.filter((a) => a.profileId === id).length;
              const g = st.blocks.filter((b) => b.profileId === id).reduce((s, b) => s + (Number(b.target) || 0), 0);
              return (
                <div key={id} className="flex items-center gap-3 py-1.5">
                  <Avatar name={name} size={28} />
                  <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{name}</div><div className="mt-1"><Progress value={n} max={g || Math.max(n, 1)} tone={g && n >= g ? 'good' : 'accent'} /></div></div>
                  <span className="text-[12.5px] font-bold tnum">{n}{g ? <span className="font-medium text-muted">/{g}</span> : null}</span>
                </div>
              );
            }) : <p className="text-[13px] text-muted">{t('No profiles scheduled or used.')}</p>}
          </Card>

          <Card title={t('Schedule blocks')} icon={<Clock className="size-4" />}>
            {st.blocks.length ? st.blocks.map((b) => {
              // Applications by this block's profile during the block's hours.
              const n = st.list.filter((a) => { const d = new Date(a.date); const m = d.getHours() * 60 + d.getMinutes(); return a.profileId === b.profileId && m >= toMin(b.start) && m < toMin(b.end); }).length;
              const goal = Number(b.target) || 0;
              const past = !isToday || toMin(b.end) <= new Date().getHours() * 60 + new Date().getMinutes();
              return (
                <div key={b.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                  <span className="w-24 shrink-0 font-semibold tnum">{b.start}–{b.end}</span>
                  <span className="min-w-0 flex-1 truncate">{profileName(profiles.find((p) => p.id === b.profileId))}{b.task ? <span className="text-muted"> · {b.task}</span> : null}</span>
                  <span className="tnum text-muted">{n}{goal ? `/${goal}` : ''}</span>
                  {goal && n >= goal ? <Badge tone="good">{t('Goal met')}</Badge> : past ? <Badge tone={n ? 'warn' : 'bad'}>{n ? t('Partly') : t('Missed')}</Badge> : <Badge>{t('Upcoming')}</Badge>}
                </div>
              );
            }) : <p className="text-[13px] text-muted">{t('No schedule blocks on this weekday.')}</p>}
          </Card>

          <Card title={t('Sites')} icon={<Globe2 className="size-4" />}>
            {sites.length ? sites.map(([name, n]) => (
              <div key={name} className="flex items-center gap-3 py-1 text-[12.5px]">
                <span className="w-36 shrink-0 truncate">{name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken"><i className="block h-full rounded-full bg-accent" style={{ width: `${(n / maxSite) * 100}%` }} /></span>
                <span className="w-6 text-right font-bold tnum">{n}</span>
              </div>
            )) : <p className="text-[13px] text-muted">{t('No sites yet.')}</p>}
          </Card>

          <Card title={t('Note for this day')} icon={<StickyNote className="size-4" />}
            actions={note !== (notes.data?.[key] || '') && <Button size="sm" variant="primary" busy={busy === 'note'} onClick={saveNote}>{t('Save')}</Button>}>
            <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('What went well, blockers, follow-ups…')} />
          </Card>
        </div>
      </div>

      <Card className="mt-[var(--gap)]" title={t('Last 30 days')} icon={<History className="size-4" />}>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="text-left text-[11.5px] font-bold uppercase tracking-wide text-muted">
              <tr className="border-b border-line"><th className="py-2">{t('Day')}</th><th>{t('Applied')}</th><th>{t('Goal')}</th><th>%</th><th>{t('Active time')}</th></tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const p = h.goal ? Math.round((h.list.length / h.goal) * 100) : null;
                return (
                  <tr key={ymd(h.d)} onClick={() => setDay(h.d)} className={cx('cursor-pointer border-b border-line last:border-0 hover:bg-sunken/60', sameDay(h.d, day) && 'bg-accent/5')}>
                    <td className="py-1.5">{h.d.toLocaleDateString(loc, { weekday: 'short', month: 'short', day: 'numeric' })}{notes.data?.[ymd(h.d)] ? <StickyNote className="ml-1.5 inline size-3.5 text-muted" /> : null}</td>
                    <td className="font-bold tnum">{h.list.length}</td>
                    <td className="tnum text-muted">{h.goal || '–'}</td>
                    <td>{p == null ? <span className="text-muted">–</span> : <Badge tone={p >= 100 ? 'good' : p >= 50 ? 'warn' : h.list.length ? 'bad' : 'neutral'}>{p}%</Badge>}</td>
                    <td className="tnum text-muted">{h.active ? fmtDur(h.active) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
