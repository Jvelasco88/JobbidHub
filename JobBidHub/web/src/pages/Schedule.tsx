import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2, Target } from 'lucide-react';
import { api, refresh, useApps, useBoot, profileName, type Schedule as Sch, type ScheduleBlock } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Toggle, avatarGradient, cx, useAction } from '../components/ui';

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toMin = (hhmm: string) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

export default function Schedule() {
  const { t } = usePrefs();
  const { data: boot } = useBoot();
  const { data: apps = [] } = useApps();
  const sched = useQuery({ queryKey: ['schedule'], queryFn: () => api<Sch>('/schedule') });
  const { run } = useAction();
  const [editing, setEditing] = useState<Partial<ScheduleBlock> | null>(null);
  const profiles = boot?.profiles || [];
  const s: Sch = { blocks: [], autoSwitch: false, reminders: true, ...(sched.data || {}) };

  const save = (next: Sch, ok?: string) => run('s', async () => { await api('/schedule', { method: 'PUT', body: next }); refresh('schedule', 'boot'); }, ok);
  const today = new Date().getDay();
  // This week's applications per day + profile, to show progress inside each block.
  const week0 = new Date(); week0.setHours(0, 0, 0, 0); week0.setDate(week0.getDate() - ((week0.getDay() + 6) % 7));
  const doneOn = (day: number, pid: string) => apps.filter((a) => { const d = new Date(a.date); return d >= week0 && d.getDay() === day && a.profileId === pid; }).length;

  return (
    <div className="fade-up">
      <PageHeader title={t('Schedule')} sub={t('When each profile applies, and how many applications per block. The extension reminds you and can switch profiles by itself.')}
        actions={<Button variant="primary" icon={<Plus className="size-4" />} disabled={!profiles.length} onClick={() => setEditing({})}>{t('Add block')}</Button>} />

      <Card className="mb-[var(--gap)]">
        <div className="flex flex-wrap gap-6">
          <Toggle checked={s.reminders !== false} onChange={(v) => save({ ...s, reminders: v })} label={t('Reminders')} hint={t('A Chrome notification when a block starts')} />
          <Toggle checked={!!s.autoSwitch} onChange={(v) => save({ ...s, autoSwitch: v })} label={t('Switch profile automatically')} hint={t('The extension changes to the block\'s profile when it starts')} />
        </div>
      </Card>

      {!s.blocks.length ? (
        <div className="card"><Empty icon={<CalendarClock className="size-5" />} title={t('No blocks yet')} action={<Button variant="primary" disabled={!profiles.length} onClick={() => setEditing({})}>{t('Add block')}</Button>}>
          {t('A block is a time when one profile applies, e.g. Mon-Fri 9:00-12:00, goal 10 applications.')}
        </Empty></div>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <div className="grid min-w-[900px] grid-cols-7 gap-2">
            {DAYS.map((d) => {
              const blocks = s.blocks.filter((b) => (b.days || []).includes(d)).sort((a, b) => toMin(a.start) - toMin(b.start));
              return (
                <div key={d} className={cx('flex flex-col gap-2 rounded-[14px] p-2', d === today ? 'bg-accent/5 ring-1 ring-accent/30' : 'bg-sunken/70')}>
                  <div className={cx('px-1 text-[12.5px] font-bold', d === today ? 'text-accent' : 'text-ink2')}>{t(DAY_NAMES[d])}{d === today && <span className="ml-1.5 text-[11px] font-semibold">· {t('today')}</span>}</div>
                  {blocks.map((b) => {
                    const p = profiles.find((x) => x.id === b.profileId);
                    const name = profileName(p);
                    const done = doneOn(d, b.profileId);
                    return (
                      <button key={b.id} onClick={() => setEditing(b)} className="card overflow-hidden text-left transition hover:-translate-y-0.5">
                        <div className="h-1" style={{ background: avatarGradient(name) }} />
                        <div className="p-2.5">
                          <div className="text-[12px] font-bold tnum">{b.start}–{b.end}</div>
                          <div className="mt-1.5 flex items-center gap-1.5"><Avatar name={name} size={20} /><span className="truncate text-[12.5px] font-semibold">{name}</span></div>
                          {b.target ? <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted"><Target className="size-3" />{done}/{b.target}</div> : null}
                          {b.task && <div className="mt-1 truncate text-[11.5px] text-muted">{b.task}</div>}
                        </div>
                      </button>
                    );
                  })}
                  {!blocks.length && <div className="px-1 py-3 text-center text-[11.5px] text-muted">—</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BlockEditor value={editing} schedule={s} onClose={() => setEditing(null)} onSave={(next) => { save(next, 'Saved'); setEditing(null); }} />
    </div>
  );
}

function BlockEditor({ value, schedule, onClose, onSave }: { value: Partial<ScheduleBlock> | null; schedule: Sch; onClose: () => void; onSave: (s: Sch) => void }) {
  const { t } = usePrefs();
  const { data: boot } = useBoot();
  const profiles = boot?.profiles || [];
  const [f, setF] = useState<Partial<ScheduleBlock>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  if (value && (value.id || 'new') !== openId) { setOpenId(value.id || 'new'); setF({ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', profileId: profiles[0]?.id, target: 10, task: '', ...value }); }
  if (!value && openId !== null) setOpenId(null);
  const up = (patch: Partial<ScheduleBlock>) => setF((x) => ({ ...x, ...patch }));
  const others = schedule.blocks.filter((b) => b.id !== value?.id);
  const clash = others.find((b) => b.days.some((d) => (f.days || []).includes(d)) && toMin(b.start) < toMin(f.end || '') && toMin(f.start || '') < toMin(b.end));
  const valid = (f.days || []).length && f.profileId && toMin(f.start || '') < toMin(f.end || '');
  const submit = () => {
    const block = { ...f, id: value?.id || crypto.randomUUID(), target: Number(f.target) || 0 } as ScheduleBlock;
    onSave({ ...schedule, blocks: value?.id ? schedule.blocks.map((b) => (b.id === value.id ? block : b)) : [...schedule.blocks, block] });
  };
  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? t('Edit block') : t('Add block')}
      footer={<>
        {value?.id && <Button variant="danger" icon={<Trash2 className="size-4" />} className="mr-auto" onClick={() => onSave({ ...schedule, blocks: others })}>{t('Delete')}</Button>}
        <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="primary" disabled={!valid || !!clash} onClick={submit}>{t('Save')}</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Days')} className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = (f.days || []).includes(d);
              return <button key={d} type="button" onClick={() => up({ days: on ? (f.days || []).filter((x) => x !== d) : [...(f.days || []), d] })}
                className={cx('h-8 w-12 rounded-[9px] border text-[12.5px] font-semibold transition', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink2 hover:bg-sunken')}>{t(DAY_NAMES[d])}</button>;
            })}
          </div>
        </Field>
        <Field label={t('Start')}><Input type="time" value={f.start || ''} onChange={(e) => up({ start: e.target.value })} /></Field>
        <Field label={t('End')}><Input type="time" value={f.end || ''} onChange={(e) => up({ end: e.target.value })} /></Field>
        <Field label={t('Profile')}><Select value={f.profileId || ''} onChange={(e) => up({ profileId: e.target.value })}>{profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}</Select></Field>
        <Field label={t('Goal (applications)')}><Input type="number" min={0} value={f.target ?? 0} onChange={(e) => up({ target: Number(e.target.value) })} /></Field>
        <Field label={t('Note')} className="sm:col-span-2"><Input value={f.task || ''} onChange={(e) => up({ task: e.target.value })} placeholder={t('e.g. LinkedIn Easy Apply')} /></Field>
      </div>
      {clash && <p className="mt-3 text-[12.5px] text-bad">{t('Overlaps with {name} {start}–{end}', { name: profileName(profiles.find((p) => p.id === clash.profileId)), start: clash.start, end: clash.end })}</p>}
    </Modal>
  );
}
