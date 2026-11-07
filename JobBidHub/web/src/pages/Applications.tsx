import { useMemo, useState } from 'react';
import { ListChecks, Download, Plus, Trash2, ExternalLink, Table2, Columns3, Search as SearchIcon, StickyNote } from 'lucide-react';
import { api, refresh, useApps, useBoot, profileName, type Application } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Empty, Field, IconButton, Input, Loading, Modal, PageHeader, Segmented, Select, Textarea, ago, cx, fmtDate, useAction } from '../components/ui';

// Same statuses as the extension's tracker.
export const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected', 'No reply'];
const tone = (s: string) => (s === 'Offer' ? 'good' : s === 'Interview' ? 'info' : s === 'Rejected' ? 'bad' : s === 'No reply' ? 'warn' : 'neutral') as any;

function toCsv(rows: Application[]) {
  const cols = ['date', 'profileName', 'title', 'company', 'status', 'site', 'url', 'notes'];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc((r as any)[c])).join(','))].join('\r\n');
}

export default function Applications() {
  const { t, prefs } = usePrefs();
  const { data: boot } = useBoot();
  const { data: apps = [], isLoading } = useApps();
  const profiles = boot?.profiles || [];
  const [profileId, setProfileId] = useState(prefs.profileId);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState('');
  const [view, setView] = useState<'table' | 'board'>('table');
  const [adding, setAdding] = useState(false);
  const [noteFor, setNoteFor] = useState<Application | null>(null);
  const { run } = useAction();

  const list = useMemo(() => {
    const from = range ? Date.now() - Number(range) * 864e5 : 0;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return apps.filter((a) => (!profileId || a.profileId === profileId) && (!status || (a.status || 'Applied') === status) && (!from || new Date(a.date).getTime() >= from)
      && words.every((w) => `${a.title} ${a.company} ${a.site} ${a.notes}`.toLowerCase().includes(w)));
  }, [apps, profileId, status, q, range]);

  const setField = (a: Application, body: Partial<Application>) => run('u', async () => { await api(`/applications/${a.id}`, { method: 'PATCH', body }); refresh('apps'); });
  const remove = (a: Application) => confirm(t('Delete this application from the tracker?')) && run('d', async () => { await api(`/applications/${a.id}`, { method: 'DELETE' }); refresh('apps', 'jobs'); }, 'Deleted');
  const exportCsv = () => {
    const blob = new Blob(['﻿' + toCsv(list)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fade-up">
      <PageHeader title={t('Applications')} sub={t('Every application from every profile. The extension adds them when you submit; you can also add one by hand.')}
        actions={<>
          <Segmented value={view} onChange={(v) => setView(v as any)} options={[{ value: 'table', label: <Table2 className="size-4" />, title: t('Table') }, { value: 'board', label: <Columns3 className="size-4" />, title: t('Board') }]} />
          <Button icon={<Download className="size-4" />} disabled={!list.length} onClick={exportCsv}>{t('Export CSV')}</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} disabled={!profiles.length} onClick={() => setAdding(true)}>{t('Add')}</Button>
        </>} />

      <div className="card mb-[var(--gap)] flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[200px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search title, company, notes…')} className="pl-9" />
        </div>
        <Select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="!w-auto">
          <option value="">{t('All profiles')}</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
          <option value="">{t('Any status')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </Select>
        <Select value={range} onChange={(e) => setRange(e.target.value)} className="!w-auto">
          <option value="">{t('All time')}</option>
          <option value="1">{t('Last 24 hours')}</option>
          <option value="7">{t('Last 7 days')}</option>
          <option value="30">{t('Last 30 days')}</option>
          <option value="90">{t('Last 90 days')}</option>
        </Select>
        <span className="ml-auto pr-1 text-[12px] text-muted tnum">{t('{n} applications', { n: list.length })}</span>
      </div>

      {isLoading ? <Loading /> : !list.length ? (
        <div className="card"><Empty icon={<ListChecks className="size-5" />} title={t('No applications')}>{t('Nothing matches these filters.')}</Empty></div>
      ) : view === 'board' ? (
        <div className="scroll-thin grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-d overflow-x-auto pb-2">
          {STATUSES.map((s) => {
            const col = list.filter((a) => (a.status || 'Applied') === s);
            return (
              <div key={s} className="flex min-h-[200px] flex-col rounded-[14px] bg-sunken/70 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const id = e.dataTransfer.getData('text/plain'); const a = apps.find((x) => x.id === id); if (a && a.status !== s) setField(a, { status: s }); }}>
                <div className="flex items-center gap-2 px-2 py-1.5"><Badge tone={tone(s)}>{t(s)}</Badge><span className="text-[12px] text-muted tnum">{col.length}</span></div>
                <div className="flex flex-col gap-2">
                  {col.slice(0, 200).map((a) => (
                    <div key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)} className="card cursor-grab p-3 active:cursor-grabbing">
                      <div className="clamp2 text-[13px] font-semibold">{a.title || a.site}</div>
                      <div className="truncate text-[12px] text-muted">{a.company || a.site}</div>
                      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted"><Avatar name={a.profileName} size={20} />{ago(a.date, t)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card scroll-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead className="text-left text-[11.5px] font-bold uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2.5">{t('Date')}</th><th className="px-3">{t('Profile')}</th><th className="px-3">{t('Job')}</th><th className="px-3">{t('Company')}</th>
                <th className="px-3">{t('Status')}</th><th className="px-3">{t('Notes')}</th><th className="w-24 px-3" />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 1000).map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0 hover:bg-sunken/60">
                  <td className="whitespace-nowrap px-3 py-2"><div className="font-medium">{fmtDate(a.date, prefs.lang)}</div><div className="text-[11.5px] text-muted">{ago(a.date, t)}</div></td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><Avatar name={a.profileName} size={24} /><span className="truncate">{a.profileName}</span></div></td>
                  <td className="max-w-[320px] px-3 py-2"><div className="clamp2 font-semibold">{a.title || '—'}</div><div className="truncate text-[11.5px] text-muted">{a.site}</div></td>
                  <td className="px-3 py-2 text-ink2">{a.company || '—'}</td>
                  <td className="px-3 py-2">
                    <select value={a.status || 'Applied'} onChange={(e) => setField(a, { status: e.target.value })}
                      className={cx('rounded-md border px-1.5 py-1 text-[12px] font-semibold outline-none', {
                        good: 'border-good/30 bg-good/10 text-good', info: 'border-info/30 bg-info/10 text-info', bad: 'border-bad/30 bg-bad/10 text-bad', warn: 'border-warn/30 bg-warn/10 text-warn', neutral: 'border-line bg-sunken text-ink2',
                      }[tone(a.status || 'Applied')])}>
                      {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                    </select>
                  </td>
                  <td className="max-w-[220px] px-3 py-2"><button onClick={() => setNoteFor(a)} className="w-full truncate text-left text-ink2 hover:text-accent">{a.notes || <span className="inline-flex items-center gap-1 text-muted"><StickyNote className="size-3.5" />{t('Add note')}</span>}</button></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-0.5">
                      {a.url && <IconButton label={t('Open')} onClick={() => window.open(a.url, '_blank', 'noopener')}><ExternalLink className="size-4" /></IconButton>}
                      <IconButton label={t('Delete')} onClick={() => remove(a)}><Trash2 className="size-4" /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddApp open={adding} onClose={() => setAdding(false)} />
      <NoteModal app={noteFor} onClose={() => setNoteFor(null)} onSave={(notes) => { if (noteFor) setField(noteFor, { notes }); setNoteFor(null); }} />
    </div>
  );
}

function NoteModal({ app, onClose, onSave }: { app: Application | null; onClose: () => void; onSave: (v: string) => void }) {
  const { t } = usePrefs();
  const [v, setV] = useState('');
  const [id, setId] = useState('');
  if (app && app.id !== id) { setId(app.id); setV(app.notes || ''); }
  return (
    <Modal open={!!app} onClose={onClose} title={t('Notes')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" onClick={() => onSave(v)}>{t('Save')}</Button></>}>
      <div className="mb-2 text-[13px] text-muted">{app?.title} · {app?.company}</div>
      <Textarea rows={6} value={v} onChange={(e) => setV(e.target.value)} placeholder={t('Recruiter name, interview date, follow-up…')} autoFocus />
    </Modal>
  );
}

function AddApp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, prefs } = usePrefs();
  const { data: boot } = useBoot();
  const { busy, run } = useAction();
  const profiles = boot?.profiles || [];
  const blank = () => ({ profileId: prefs.profileId || profiles[0]?.id || '', title: '', company: '', url: '', status: 'Applied', notes: '', date: new Date().toISOString().slice(0, 10) });
  const [f, setF] = useState(blank);
  const up = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run('add', async () => {
    await api('/applications', { body: { ...f, profileId: f.profileId || profiles[0]?.id, date: new Date(f.date + 'T12:00:00').toISOString() } });
    refresh('apps', 'jobs');
    setF(blank());
    onClose();
  }, 'Application added');
  return (
    <Modal open={open} onClose={onClose} title={t('Add application')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" busy={busy === 'add'} disabled={!f.title && !f.url} onClick={save}>{t('Add')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Profile')}>
          <Select value={f.profileId || profiles[0]?.id} onChange={(e) => up('profileId', e.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}</Select>
        </Field>
        <Field label={t('Date')}><Input type="date" value={f.date} onChange={(e) => up('date', e.target.value)} /></Field>
        <Field label={t('Job title')}><Input value={f.title} onChange={(e) => up('title', e.target.value)} /></Field>
        <Field label={t('Company')}><Input value={f.company} onChange={(e) => up('company', e.target.value)} /></Field>
        <Field label={t('Link')} className="sm:col-span-2"><Input value={f.url} onChange={(e) => up('url', e.target.value)} placeholder="https://" /></Field>
        <Field label={t('Status')}><Select value={f.status} onChange={(e) => up('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}</Select></Field>
        <Field label={t('Notes')} className="sm:col-span-2"><Textarea rows={3} value={f.notes} onChange={(e) => up('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
