import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Radar, Play, Pencil, Trash2, Plus, Clock, AlertTriangle, Building2, History, MapPin, Wand2 } from 'lucide-react';
import { api, refresh, useBoot, useMe, useSearches, profileName, type Search } from '../api';
import { usePrefs } from '../prefs';
import { Badge, Button, Card, Empty, Field, IconButton, Input, Loading, Modal, PageHeader, Select, TagInput, Toggle, ago, cx, useAction } from '../components/ui';

const BOARD_HELP: Record<string, string> = {
  greenhouse: 'boards.greenhouse.io/<company>',
  lever: 'jobs.lever.co/<company>',
  ashby: 'jobs.ashbyhq.com/<company>',
};

export default function Searches() {
  const { t } = usePrefs();
  const nav = useNavigate();
  const { data: boot } = useBoot();
  const { data: searches = [], isLoading } = useSearches();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api<any[]>('/runs'), refetchInterval: 15000 });
  const [editing, setEditing] = useState<Partial<Search> | null>(null);
  const { busy, run } = useAction();
  const profiles = boot?.profiles || [];

  const runNow = (s: Search) => run('run' + s.id, async () => {
    await api(`/searches/${s.id}/run`, { method: 'POST' });
    refresh('searches', 'jobs', 'runs');
  });
  const toggle = (s: Search, enabled: boolean) => run('t', async () => { await api(`/searches/${s.id}`, { method: 'PUT', body: { enabled } }); refresh('searches'); });
  const remove = (s: Search) => confirm(t('Delete the search "{name}"?', { name: s.name })) && run('d', async () => { await api(`/searches/${s.id}`, { method: 'DELETE' }); refresh('searches'); });

  // One-click starter searches from each profile's titles and top skills.
  const suggest = () => run('suggest', async () => {
    for (const p of profiles) {
      const title = (p.criteria?.titles?.[0] || p.headline || p.currentTitle || '').replace(/\b(senior|sr\.?|lead|staff|principal)\b/gi, '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      await api('/searches', { body: { name: `${profileName(p)} · ${title}`, keywords: [title.toLowerCase()], profileId: p.id, remote: p.criteria?.workMode === 'remote' ? 'remote' : 'any' } });
    }
    refresh('searches');
  }, 'Searches created');

  return (
    <div className="fade-up">
      <PageHeader title={t('Job search')} sub={t('Saved searches run by themselves every few hours. New jobs are scored for every profile and added to the job board.')}
        actions={<>
          {profiles.length > 0 && !searches.length && <Button icon={<Wand2 className="size-4" />} busy={busy === 'suggest'} onClick={suggest}>{t('Create from profiles')}</Button>}
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>{t('New search')}</Button>
        </>} />

      {isLoading ? <Loading /> : !searches.length ? (
        <div className="card"><Empty icon={<Radar className="size-5" />} title={t('No searches yet')} action={<Button variant="primary" onClick={() => setEditing({})}>{t('New search')}</Button>}>
          {t('A search is a set of keywords, like "python developer". JobBid checks free job boards and company career pages for it.')}
        </Empty></div>
      ) : (
        <div className="grid gap-d lg:grid-cols-2">
          {searches.map((s) => {
            const p = profiles.find((x) => x.id === s.profileId);
            return (
              <div key={s.id} className={cx('card pad flex flex-col gap-3', s.enabled === false && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent/10 text-accent"><Radar className={cx('size-5', s.running && 'animate-pulse')} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{s.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
                      {p && <span>{t('for')} {profileName(p)}</span>}
                      {s.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{s.location}</span>}
                      <span>{s.remote === 'remote' ? t('Remote only') : s.remote === 'onsite' ? t('On-site only') : t('Remote or on-site')}</span>
                      {s.maxAgeDays ? <span>{t('posted in {n} days', { n: s.maxAgeDays })}</span> : null}
                    </div>
                  </div>
                  <Toggle checked={s.enabled !== false} onChange={(v) => toggle(s, v)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.keywords.map((k) => <Badge key={k} tone="accent">{k}</Badge>)}
                  {(s.exclude || []).map((k) => <Badge key={k} tone="bad">−{k}</Badge>)}
                </div>
                <div className="flex flex-wrap gap-1">{s.sources.map((x) => <Badge key={x}>{boot?.sources?.[x]?.name || x}</Badge>)}</div>
                {(s.lastErrors || []).length > 0 && (
                  <div className="flex items-start gap-2 rounded-[10px] bg-warn/10 px-3 py-2 text-[12px] text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{s.lastErrors!.join(' · ')}</span></div>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                    <Clock className="size-3.5" />
                    {s.running ? t('Searching…') : s.lastRun ? t('{when}: {found} found, {added} new', { when: ago(s.lastRun, t), found: s.lastFound ?? 0, added: s.lastAdded ?? 0 }) : t('Not run yet')}
                    {' · '}{t('every {n}h', { n: s.everyHours })}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => nav(`/jobs`)}>{t('View jobs')}</Button>
                    <IconButton label={t('Edit')} onClick={() => setEditing(s)}><Pencil className="size-4" /></IconButton>
                    <IconButton label={t('Delete')} onClick={() => remove(s)}><Trash2 className="size-4" /></IconButton>
                    <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} busy={busy === 'run' + s.id || s.running} onClick={() => runNow(s)}>{t('Run now')}</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-[var(--gap)] grid gap-d xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Boards />
        <Card title={t('Search history')} icon={<History className="size-4" />}>
          {runs.data?.length ? (
            <ul className="flex flex-col divide-y divide-line text-[13px]">
              {runs.data.slice(0, 12).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{searches.find((s) => s.id === r.search_id)?.name || t('Deleted search')}</span>
                  <span className="text-muted tnum">{t('{found} found, {added} new', { found: r.found, added: r.added })}</span>
                  {r.errors?.length ? <Badge tone="warn" title={r.errors.join('\n')}>{r.errors.length} ⚠</Badge> : null}
                  <span className="w-20 text-right text-[12px] text-muted">{ago(r.started_at, t)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="py-4 text-[13px] text-muted">{t('No searches have run yet.')}</p>}
        </Card>
      </div>

      <SearchEditor value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// Companies whose own career pages are searched (Greenhouse / Lever / Ashby).
function Boards() {
  const { t } = usePrefs();
  const { data: boot } = useBoot();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);
  // A shared setting: only admins change the company list.
  const admin = useMe().data?.role === 'admin';
  // Until the user edits the list, the starter companies are used.
  const boards = draft || boot?.hub?.boards || boot?.starterBoards || { greenhouse: [], lever: [], ashby: [] };
  const save = () => run('boards', async () => { await api('/settings', { method: 'PUT', body: { hub: { boards } } }); refresh('boot'); setDraft(null); }, 'Saved');
  return (
    <Card title={t('Company career pages')} icon={<Building2 className="size-4" />}
      actions={admin && draft && <Button size="sm" variant="primary" busy={busy === 'boards'} onClick={save}>{t('Save')}</Button>}>
      <p className="mb-3 text-[12.5px] text-muted">{t('Add companies by the name in their careers link. Searches that include these sources check every listed company.')}{!boot?.hub?.boards && ' ' + t('A starter list of well-known tech companies is used until you change it.')}</p>
      <div className="flex flex-col gap-3">
        {(['greenhouse', 'lever', 'ashby'] as const).map((id) => (
          <Field key={id} label={boot?.sources?.[id]?.name || id} hint={<span className="font-mono">{BOARD_HELP[id]}</span>}>
            <TagInput value={boards[id] || []} onChange={(v) => admin && setDraft({ ...boards, [id]: v.map((x) => x.trim().replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0].toLowerCase()) })}
              placeholder={id === 'greenhouse' ? 'stripe, airbnb, discord' : id === 'lever' ? 'spotify, plaid' : 'ramp, notion'} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

function SearchEditor({ value, onClose }: { value: Partial<Search> | null; onClose: () => void }) {
  const { t } = usePrefs();
  const { data: boot } = useBoot();
  const { busy, run } = useAction();
  const [f, setF] = useState<Partial<Search>>({});
  const [lastId, setLastId] = useState<string | undefined>('none');
  // Reset the form when a different search is opened.
  if (value && (value.id || '') !== lastId) {
    setLastId(value.id || '');
    setF({
      name: '', keywords: [], exclude: ['intern'], location: '', remote: 'any', maxAgeDays: 14, everyHours: 6, enabled: true, profileId: '',
      sources: ['remoteok', 'jobicy', 'greenhouse', 'lever', 'ashby'], ...value,
    });
  }
  if (!value && lastId !== 'none') setLastId('none');
  const up = (patch: Partial<Search>) => setF((x) => ({ ...x, ...patch }));
  const save = () => run('save', async () => {
    const body = { ...f, name: f.name || (f.keywords || []).join(', ') || t('Search') };
    if (value?.id) await api(`/searches/${value.id}`, { method: 'PUT', body });
    else {
      const s = await api<Search>('/searches', { body });
      api(`/searches/${s.id}/run`, { method: 'POST' }).then(() => refresh('searches', 'jobs', 'runs')).catch(() => {});
    }
    refresh('searches');
    onClose();
  }, value?.id ? 'Saved' : 'Search created - running it now');
  const sources = boot?.sources || {};
  const profiles = boot?.profiles || [];

  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? t('Edit search') : t('New search')} wide
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" busy={busy === 'save'} disabled={!(f.keywords || []).length} onClick={save}>{t('Save')}</Button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label={t('Keywords')} hint={t('Job titles or skills. A job matches if it fits any of them.')} className="sm:col-span-2">
          <TagInput value={f.keywords || []} onChange={(v) => up({ keywords: v })} placeholder="python developer, machine learning engineer" />
        </Field>
        <Field label={t('Skip titles with')} hint={t('e.g. intern, manager, clearance')} className="sm:col-span-2">
          <TagInput value={f.exclude || []} onChange={(v) => up({ exclude: v })} />
        </Field>
        <Field label={t('Name')}><Input value={f.name || ''} onChange={(e) => up({ name: e.target.value })} placeholder={(f.keywords || []).join(', ')} /></Field>
        <Field label={t('For profile')} hint={t('Optional. Jobs are scored for every profile anyway.')}>
          <Select value={f.profileId || ''} onChange={(e) => up({ profileId: e.target.value })}>
            <option value="">{t('Any profile')}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
          </Select>
        </Field>
        <Field label={t('Work type')}>
          <Select value={f.remote || 'any'} onChange={(e) => up({ remote: e.target.value as any })}>
            <option value="any">{t('Remote or on-site')}</option>
            <option value="remote">{t('Remote only')}</option>
            <option value="onsite">{t('On-site only')}</option>
          </Select>
        </Field>
        <Field label={t('Location')} hint={t('For on-site jobs, e.g. "Chicago" or "United States"')}><Input value={f.location || ''} onChange={(e) => up({ location: e.target.value })} /></Field>
        <Field label={t('Posted within (days)')}><Input type="number" min={0} value={f.maxAgeDays ?? 14} onChange={(e) => up({ maxAgeDays: Number(e.target.value) })} /></Field>
        <Field label={t('Run every (hours)')} hint={t('0 = only when you click Run now')}><Input type="number" min={0} value={f.everyHours ?? 6} onChange={(e) => up({ everyHours: Number(e.target.value) })} /></Field>
        <Field label={t('Where to search')} className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(sources).map(([id, s]) => {
              const on = (f.sources || []).includes(id);
              return (
                <label key={id} className={cx('flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2 text-[13px] transition', on ? 'border-accent/40 bg-accent/5' : 'border-line')}>
                  <input type="checkbox" checked={on} className="accent-[var(--accent)]"
                    onChange={(e) => up({ sources: e.target.checked ? [...(f.sources || []), id] : (f.sources || []).filter((x) => x !== id) })} />
                  <span className="font-medium">{s.name}</span>
                  {s.remoteOnly && <Badge className="ml-auto">{t('remote jobs')}</Badge>}
                  {s.boards && <Badge className="ml-auto">{t('your companies')}</Badge>}
                  {s.mayBlock && <Badge tone="warn" className="ml-auto" title={t('Some networks block this site')}>{t('may be blocked')}</Badge>}
                </label>
              );
            })}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
