import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquareText, Search as SearchIcon, Trash2, Plus, Check, CircleDashed } from 'lucide-react';
import { api, refresh, useBoot, profileName } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Empty, Field, IconButton, Input, Modal, PageHeader, Segmented, Select, Textarea, cx, useAction } from '../components/ui';

// Saved answers per profile: questions the extension learned or couldn't answer. Answer once, filled everywhere.
export default function Answers() {
  const { t, prefs } = usePrefs();
  const { data: boot } = useBoot();
  const [params, setParams] = useSearchParams();
  const profiles = boot?.profiles || [];
  const pid = params.get('profile') || prefs.profileId || profiles[0]?.id || '';
  const p = profiles.find((x) => x.id === pid) || profiles[0];
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>(params.get('open') ? 'open' : 'all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { run } = useAction();

  const rows = useMemo(() => {
    const ans = p?.customAnswers || {};
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return Object.entries(ans)
      .filter(([k, v]) => (filter === 'all' || (filter === 'open' ? !String(v || '').trim() : !!String(v || '').trim())) && words.every((w) => `${k} ${v}`.toLowerCase().includes(w)))
      .sort(([a, va], [b, vb]) => Number(!!String(va || '').trim()) - Number(!!String(vb || '').trim()) || a.localeCompare(b));
  }, [p, filter, q]);
  const openN = Object.values(p?.customAnswers || {}).filter((v) => !String(v || '').trim()).length;

  const patch = (body: any) => run('p', async () => { await api(`/profiles/${p!.id}/answers`, { method: 'PATCH', body }); refresh('boot'); });

  return (
    <div className="fade-up">
      <PageHeader title={t('Answers')} sub={t('Questions from application forms. Answer them once here and the extension fills them on every site.')}
        actions={<Button variant="primary" icon={<Plus className="size-4" />} disabled={!p} onClick={() => setAdding(true)}>{t('Add answer')}</Button>} />
      {!p ? <div className="card"><Empty icon={<MessageSquareText className="size-5" />} title={t('No profiles yet')} /></div> : (
        <>
          <div className="card mb-[var(--gap)] flex flex-wrap items-center gap-2 p-2.5">
            <div className="flex items-center gap-2">
              <Avatar name={profileName(p)} size={30} />
              <Select value={p.id} onChange={(e) => setParams({ profile: e.target.value })} className="!w-auto font-semibold">
                {profiles.map((x) => <option key={x.id} value={x.id}>{profileName(x)}</option>)}
              </Select>
            </div>
            <Segmented size="sm" value={filter} onChange={(v) => setFilter(v as any)} options={[
              { value: 'all', label: t('All') },
              { value: 'open', label: <>{t('Need answer')}{openN ? <Badge tone="warn" className="!px-1">{openN}</Badge> : null}</> },
              { value: 'done', label: t('Answered') },
            ]} />
            <div className="relative min-w-[200px] flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search questions…')} className="pl-9" />
            </div>
          </div>

          {!rows.length ? (
            <div className="card"><Empty icon={<Check className="size-5" />} title={filter === 'open' ? t('Every question has an answer') : t('No saved answers')} /></div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map(([question, answer]) => (
                <AnswerRow key={question} question={question} answer={String(answer ?? '')} options={p.answerOptions?.[question]}
                  onSave={(a) => patch({ set: { [question]: a } })}
                  onDelete={() => confirm(t('Delete this saved answer?')) && patch({ remove: [question] })} />
              ))}
            </div>
          )}
        </>
      )}
      <AddAnswer open={adding} onClose={() => setAdding(false)} onAdd={(question, a) => { patch({ set: { [question]: a } }); setAdding(false); }} />
    </div>
  );
}

function AnswerRow({ question, answer, options: raw, onSave, onDelete }: { question: string; answer: string; options?: string[]; onSave: (a: string) => void; onDelete: () => void }) {
  const { t } = usePrefs();
  // Saved options can be blank (the form's option words weren't readable): then it's a text box.
  const clean = (raw || []).map((o) => String(o ?? '').trim()).filter(Boolean);
  const options = clean.length >= 2 ? clean : undefined;
  const [v, setV] = useState(answer);
  const [base, setBase] = useState(answer);
  if (answer !== base) { setBase(answer); setV(answer); }
  const open = !answer.trim();
  const changed = v !== answer;
  return (
    <div className={cx('card flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start', open && 'border-warn/30')}>
      <div className="flex min-w-0 items-start gap-2.5 md:w-[45%]">
        {open ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-warn" /> : <Check className="mt-0.5 size-4 shrink-0 text-good" />}
        <div className="min-w-0 text-[13.5px] font-medium leading-snug">{question}</div>
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {options?.length ? (
          <Select value={v} onChange={(e) => { setV(e.target.value); onSave(e.target.value); }} className="flex-1">
            <option value="">{t('— choose —')}</option>
            {[...new Set([...options, ...(v && !options.includes(v) ? [v] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <Textarea rows={v.length > 90 ? 3 : 1} value={v} onChange={(e) => setV(e.target.value)} placeholder={t('Type the answer…')} className="flex-1 resize-y"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(v); }} />
        )}
        {changed && !options?.length && <Button size="sm" variant="primary" onClick={() => onSave(v)}>{t('Save')}</Button>}
        <IconButton label={t('Delete')} onClick={onDelete}><Trash2 className="size-4" /></IconButton>
      </div>
    </div>
  );
}

function AddAnswer({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (q: string, a: string) => void }) {
  const { t } = usePrefs();
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  return (
    <Modal open={open} onClose={onClose} title={t('Add answer')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" disabled={!q.trim()} onClick={() => { onAdd(q.trim(), a); setQ(''); setA(''); }}>{t('Add')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('Question')} hint={t('As it appears on forms, e.g. "How did you hear about us?"')}><Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
        <Field label={t('Answer')}><Textarea rows={4} value={a} onChange={(e) => setA(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
