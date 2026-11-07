import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Briefcase, CalendarCheck, Clock, Flame, Radar, Send, Sparkles, Target, TrendingUp, AlertTriangle, CheckCircle2, ArrowRight, Plug } from 'lucide-react';
import { api, useApps, useBoot, useSearches, profileName, refresh, type Job } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, avatarColor, Badge, Button, Card, Empty, PageHeader, Progress, ScoreRing, ago, cx, useAction } from '../components/ui';

const MIN_SAVED_PER_APP = 12; // minutes a filled application saves, roughly

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function Kpi({ icon, label, value, sub, tone = 'accent' }: { icon: any; label: string; value: any; sub?: any; tone?: string }) {
  return (
    <div className="card pad flex items-center gap-3.5">
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-[12px]', tone === 'good' ? 'bg-good/10 text-good' : tone === 'warn' ? 'bg-warn/10 text-warn' : tone === 'info' ? 'bg-info/10 text-info' : 'bg-accent/10 text-accent')}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-muted">{label}</div>
        <div className="text-[22px] font-extrabold leading-tight tracking-tight tnum">{value}</div>
        {sub && <div className="truncate text-[11.5px] text-muted">{sub}</div>}
      </div>
    </div>
  );
}

export default function Home() {
  const { t, prefs } = usePrefs();
  const nav = useNavigate();
  const { data: boot } = useBoot();
  const { data: apps = [] } = useApps();
  const { data: searches = [] } = useSearches();
  const pid = prefs.profileId;
  const matches = useQuery({ queryKey: ['jobs', 'home', pid], queryFn: () => api<{ jobs: Job[] }>(`/jobs?status=new&sort=best&limit=6&qualified=1&profileId=${pid}&days=7`) });
  const jstats = useQuery({ queryKey: ['jobs', 'stats'], queryFn: () => api<{ byStatus: Record<string, number>; foundToday: number }>('/jobs/stats') });
  const { busy, run } = useAction();
  const profiles = boot?.profiles || [];

  const mine = pid ? apps.filter((a) => a.profileId === pid) : apps;
  const today0 = startOfDay();
  const week0 = new Date(today0); week0.setDate(week0.getDate() - ((week0.getDay() + 6) % 7));
  const todayN = mine.filter((a) => new Date(a.date) >= today0).length;
  const weekN = mine.filter((a) => new Date(a.date) >= week0).length;
  const interviews = mine.filter((a) => /interview|offer/i.test(a.status)).length;
  const saved = mine.length * MIN_SAVED_PER_APP;

  // Applications per day (last 14 days), one bar segment per profile.
  const chart = useMemo(() => {
    const days: any[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today0); d.setDate(d.getDate() - i);
      days.push({ key: dayKey(d), label: d.toLocaleDateString(prefs.lang === 'en' ? 'en-US' : prefs.lang, { month: 'numeric', day: 'numeric' }) });
    }
    const idx = Object.fromEntries(days.map((d, i) => [d.key, i]));
    for (const a of mine) {
      const i = idx[dayKey(new Date(a.date))];
      if (i === undefined) continue;
      days[i][a.profileId] = (days[i][a.profileId] || 0) + 1;
    }
    return days;
  }, [mine, prefs.lang]);
  const chartProfiles = profiles.filter((p) => (!pid || p.id === pid) && mine.some((a) => a.profileId === p.id));

  // Streak: consecutive days (ending today or yesterday) with at least one application.
  const streak = useMemo(() => {
    const set = new Set(mine.map((a) => dayKey(new Date(a.date))));
    let n = 0; const d = new Date(today0);
    if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }, [mine]);

  // Today's goal per profile from the schedule.
  const goals = useMemo(() => {
    const dow = new Date().getDay();
    const blocks = (boot?.schedule?.blocks || []).filter((b) => (b.days || []).includes(dow));
    return profiles.map((p) => ({
      p,
      done: apps.filter((a) => a.profileId === p.id && new Date(a.date) >= today0).length,
      goal: blocks.filter((b) => b.profileId === p.id).reduce((s, b) => s + (Number(b.target) || 0), 0),
      when: blocks.filter((b) => b.profileId === p.id).map((b) => `${b.start}-${b.end}`).join(', '),
    })).filter((g) => !pid || g.p.id === pid);
  }, [boot, apps, pid]);

  // Things that need the user.
  const todo = useMemo(() => {
    const list: { tone: 'warn' | 'bad' | 'info'; text: string; to: string; cta: string }[] = [];
    const keys = (boot?.settings?.aiKeys || []).filter((k: any) => k.enabled !== false);
    if (!keys.length) list.push({ tone: 'warn', text: t('No AI key yet - answers and cover letters need one.'), to: '/ai', cta: t('Add key') });
    for (const p of profiles) {
      const open = Object.values(p.customAnswers || {}).filter((v) => !String(v || '').trim()).length;
      if (open) list.push({ tone: 'info', text: t('{name}: {n} questions waiting for an answer', { name: profileName(p), n: open }), to: `/answers?profile=${p.id}&open=1`, cta: t('Answer') });
      if (!(p.resumes || []).length) list.push({ tone: 'warn', text: t('{name} has no resume file', { name: profileName(p) }), to: `/profiles/${p.id}?tab=resumes`, cta: t('Upload') });
      if (!p.criteria) list.push({ tone: 'info', text: t('{name}: set apply criteria for better matches', { name: profileName(p) }), to: `/profiles/${p.id}?tab=criteria`, cta: t('Set up') });
    }
    if (!searches.length) list.push({ tone: 'info', text: t('Create a job search so new jobs come to you.'), to: '/searches', cta: t('Create') });
    const lastSync = Math.max(0, ...(boot?.clients || []).map((c: any) => new Date(c.last_sync || 0).getTime()));
    if (!lastSync) list.push({ tone: 'warn', text: t('The extension has not synced with the hub yet.'), to: '/settings', cta: t('How to connect') });
    return list;
  }, [boot, profiles, searches, t]);

  const hour = new Date().getHours();
  const hello = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');
  const runAll = () => run('runall', async () => {
    await Promise.all(searches.filter((s) => s.enabled !== false).map((s) => api(`/searches/${s.id}/run`, { method: 'POST' })));
    refresh('jobs', 'searches');
  }, 'Search finished');

  return (
    <div className="fade-up">
      <PageHeader
        title={hello}
        sub={new Date().toLocaleDateString(prefs.lang === 'en' ? 'en-US' : prefs.lang, { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={<>
          <Button icon={<Radar className="size-4" />} busy={busy === 'runall'} disabled={!searches.length} onClick={runAll}>{t('Find new jobs')}</Button>
          <Button variant="primary" icon={<Briefcase className="size-4" />} onClick={() => nav('/jobs')}>{t('Job board')}</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-d lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Send className="size-5" />} label={t('Applied today')} value={todayN} sub={goals.some((g) => g.goal) ? t('goal {n}', { n: goals.reduce((s, g) => s + g.goal, 0) }) : undefined} />
        <Kpi icon={<CalendarCheck className="size-5" />} label={t('This week')} value={weekN} tone="info" />
        <Kpi icon={<TrendingUp className="size-5" />} label={t('All applications')} value={mine.length} tone="info" />
        <Kpi icon={<Sparkles className="size-5" />} label={t('Interviews')} value={interviews} sub={mine.length ? `${Math.round((interviews / mine.length) * 100)}% ${t('rate')}` : undefined} tone="good" />
        <Kpi icon={<Clock className="size-5" />} label={t('Time saved')} value={saved >= 60 ? `${Math.floor(saved / 60)}h ${saved % 60}m` : `${saved}m`} sub={t('about {n} min per application', { n: MIN_SAVED_PER_APP })} tone="good" />
        <Kpi icon={<Flame className="size-5" />} label={t('Streak')} value={streak === 1 ? t('1 day') : t('{n} days', { n: streak })} sub={t('{n} new jobs today', { n: jstats.data?.foundToday ?? 0 })} tone="warn" />
      </div>

      <div className="mt-[var(--gap)] grid gap-d xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title={t('Applications, last 14 days')} icon={<TrendingUp className="size-4" />}>
          {mine.length ? (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'var(--sunken)' }} contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' }} />
                  {chartProfiles.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--ink2)' }} />}
                  {chartProfiles.map((p, i) => (
                    <Bar key={p.id} dataKey={p.id} name={profileName(p)} stackId="a" isAnimationActive={false} fill={avatarColor(profileName(p))} stroke="var(--card)" strokeWidth={1}
                      radius={i === chartProfiles.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={34} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty icon={<Send className="size-5" />} title={t('No applications yet')}>{t('Applications you log in the extension show up here.')}</Empty>}
        </Card>

        <Card title={t('Today by profile')} icon={<Target className="size-4" />} actions={<Link to="/schedule" className="text-[12.5px] font-semibold text-accent">{t('Schedule')}</Link>}>
          {goals.length ? (
            <ul className="flex flex-col gap-3.5">
              {goals.map(({ p, done, goal, when }) => (
                <li key={p.id} className="flex items-center gap-3">
                  <Avatar name={profileName(p)} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13.5px] font-semibold">{profileName(p)}</span>
                      <span className="ml-auto text-[13px] font-bold tnum">{done}{goal ? <span className="text-muted font-medium">/{goal}</span> : null}</span>
                    </div>
                    <div className="mt-1.5"><Progress value={done} max={goal || Math.max(done, 1)} tone={goal && done >= goal ? 'good' : 'accent'} /></div>
                    <div className="mt-1 text-[11.5px] text-muted">{when || t('No block scheduled today')}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty title={t('No profiles yet')} action={<Button variant="primary" onClick={() => nav('/profiles')}>{t('Add profile')}</Button>} />}
        </Card>
      </div>

      <div className="mt-[var(--gap)] grid gap-d xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title={pid ? t('Best new matches') : t('Best new jobs')} icon={<Sparkles className="size-4" />}
          actions={<Link to="/jobs" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent">{t('See all')}<ArrowRight className="size-3.5" /></Link>}>
          {matches.data?.jobs?.length ? (
            <ul className="-mx-2 flex flex-col">
              {matches.data.jobs.map((j) => {
                const best = pid ? j.scores?.[pid] : Object.values(j.scores || {}).filter((s) => s.qualified).sort((a, b) => b.score - a.score)[0];
                return (
                  <li key={j.id}>
                    <Link to={`/jobs?id=${j.id}`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-sunken">
                      <ScoreRing score={best?.score} qualified={best?.qualified} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold">{j.title}</div>
                        <div className="truncate text-[12px] text-muted">{j.company} · {j.remote ? t('Remote') : j.location} · {ago(j.postedAt || j.foundAt, t)}</div>
                      </div>
                      {j.salary && <Badge tone="good" className="hidden sm:inline-flex">{j.salary}</Badge>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon={<Radar className="size-5" />} title={t('No new matches')} action={<Button variant="soft" onClick={() => nav('/searches')}>{t('Set up a job search')}</Button>}>
              {t('Saved searches look for jobs every few hours and score them for each profile.')}
            </Empty>
          )}
        </Card>

        <Card title={t('Needs attention')} icon={<AlertTriangle className="size-4" />}>
          {todo.length ? (
            <ul className="flex flex-col gap-2">
              {todo.slice(0, 8).map((x, i) => (
                <li key={i} className="flex items-center gap-2.5 rounded-[10px] border border-line px-3 py-2">
                  <span className={cx('size-2 shrink-0 rounded-full', x.tone === 'bad' ? 'bg-bad' : x.tone === 'warn' ? 'bg-warn' : 'bg-info')} />
                  <span className="min-w-0 flex-1 text-[13px]">{x.text}</span>
                  <Button size="sm" variant="soft" onClick={() => nav(x.to)}>{x.cta}</Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2.5 py-6 text-[13.5px] text-good"><CheckCircle2 className="size-5" />{t('All good - nothing needs you right now.')}</div>
          )}
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[12px] text-muted">
            <Plug className="size-3.5" />
            {(boot?.clients || []).length
              ? t('Extension last synced {when}', { when: ago((boot?.clients || []).map((c: any) => c.last_sync).filter(Boolean).sort().pop(), t) || t('never') })
              : t('No extension connected yet')}
          </div>
        </Card>
      </div>

      <Card className="mt-[var(--gap)]" title={t('Recent applications')} icon={<Send className="size-4" />}
        actions={<Link to="/applications" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent">{t('See all')}<ArrowRight className="size-3.5" /></Link>}>
        {mine.length ? (
          <ul className="-mx-2 grid gap-x-4 md:grid-cols-2">
            {mine.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-[10px] px-2 py-2">
                <Avatar name={a.profileName} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{a.title || a.site}</div>
                  <div className="truncate text-[12px] text-muted">{a.company || a.site} · {ago(a.date, t)}</div>
                </div>
                <Badge tone={/interview|offer/i.test(a.status) ? 'good' : /reject/i.test(a.status) ? 'bad' : 'neutral'}>{t(a.status)}</Badge>
              </li>
            ))}
          </ul>
        ) : <div className="py-4 text-[13px] text-muted">{t('Nothing yet.')}</div>}
      </Card>
    </div>
  );
}
