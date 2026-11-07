import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Users, Plus, Save, FileUp, Trash2, Upload, FileText, Download, Star, Briefcase, GraduationCap, Target, User, ShieldCheck, Sparkles, X, RotateCcw, PenLine, KeyRound, Eye, EyeOff } from 'lucide-react';
import { api, withToken, fileToBase64, refresh, useApps, useBoot, profileName, type Criteria, type Profile } from '../api';
import { usePrefs } from '../prefs';
import { bufToBase64, readLocally, resumeText } from '../resumeText';
import { Avatar, Badge, Button, Card, Empty, Field, IconButton, Input, PageHeader, Progress, Segmented, Select, TagInput, Textarea, Toggle, cx, useAction, useToast } from '../components/ui';

const YESNO = ['', 'Yes', 'No'];
const EEO = {
  gender: ['', 'Male', 'Female', 'Non-binary', 'Decline to self-identify'],
  hispanic: ['', 'Yes', 'No', 'Decline to self-identify'],
  ethnicity: ['', 'White', 'Black or African American', 'Asian', 'Hispanic or Latino', 'American Indian or Alaska Native', 'Native Hawaiian or Other Pacific Islander', 'Two or More Races', 'Decline to self-identify'],
  veteran: ['', 'I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'Decline to self-identify'],
  lgbtq: ['', 'Yes', 'No', 'Decline to self-identify'],
  disability: ['', 'No, I do not have a disability', 'Yes, I have a disability (or previously had a disability)', 'I do not wish to answer'],
};
type F = [key: string, label: string, options?: string[]];
// Same sections and fields as the extension's profile editor.
const SECTIONS: { id: string; title: string; caption?: string; fields: F[] }[] = [
  { id: 'contact', title: 'Personal & contact', fields: [['label', 'Profile label'], ['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'],
    ['email', 'Email'], ['phone', 'Phone'], ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL'], ['website', 'Website / portfolio'], ['pronouns', 'Pronouns'],
    ['birthday', 'Birthday'], ['birthYear', 'Birth year (if only year known)']] },
  { id: 'location', title: 'Location', fields: [['address', 'Street address'], ['city', 'City'], ['state', 'State / province'], ['zip', 'ZIP / postal code'], ['country', 'Country']] },
  { id: 'work', title: 'Current role & expectations', fields: [['headline', 'Headline / target title'], ['currentTitle', 'Current title'], ['currentCompany', 'Current company'],
    ['yearsExperience', 'Years of experience'], ['salaryExpectation', 'Salary expectation'], ['noticePeriod', 'Notice period / start date'], ['workCountries', 'Countries you want to work in (comma separated)']] },
  { id: 'eligibility', title: 'Work eligibility', caption: 'Asked on almost every application', fields: [['workAuthorization', 'Authorized to work in the country?', YESNO],
    ['requiresSponsorship', 'Needs visa sponsorship?', YESNO], ['willingToRelocate', 'Willing to relocate?', YESNO]] },
  { id: 'screening', title: 'Screening questions', caption: 'Common Yes/No questions - answered once, used everywhere', fields: [
    ['over18', 'Are you 18 or older?', YESNO], ['essentialFunctions', 'Can do essential job functions?', YESNO], ['backgroundCheck', 'Background check OK?', YESNO],
    ['drugTest', 'Drug test OK?', YESNO], ['contactCurrent', 'Contact current employer?', YESNO], ['contactPast', 'Contact past employers?', YESNO],
    ['everFired', 'Ever fired / asked to resign?', YESNO], ['convicted', 'Ever convicted of a crime?', YESNO], ['nonCompete', 'Bound by a non-compete?', YESNO],
    ['relatives', 'Relatives at the company?', YESNO], ['workedHereBefore', 'Worked there before?', YESNO]] },
  { id: 'eeo', title: 'Voluntary self-identification', caption: 'Leave blank to let the form decline', fields: [['gender', 'Gender', EEO.gender], ['hispanic', 'Hispanic or Latino', EEO.hispanic],
    ['ethnicity', 'Race / ethnicity', EEO.ethnicity], ['veteran', 'Veteran status', EEO.veteran], ['disability', 'Disability status', EEO.disability], ['lgbtq', 'Identify as LGBTQ+', EEO.lgbtq]] },
];
const COMPLETENESS: [string, string][] = [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['country', 'Country'],
  ['linkedin', 'LinkedIn'], ['headline', 'Headline'], ['yearsExperience', 'Years of experience'], ['summary', 'Summary'], ['workAuthorization', 'Work authorization'],
  ['requiresSponsorship', 'Sponsorship'], ['salaryExpectation', 'Salary expectation']];
export function completeness(p: Profile) {
  const missing = COMPLETENESS.filter(([k]) => !String(p[k] ?? '').trim()).map(([, l]) => l);
  if (!(p.skills || []).length) missing.push('Skills');
  if (!(p.experience || []).length) missing.push('Experience');
  if (!(p.resumes || []).length) missing.push('Resume file');
  const total = COMPLETENESS.length + 3;
  return { pct: Math.round(((total - missing.length) / total) * 100), missing };
}

const TABS = [
  { value: 'details', label: 'Details', icon: User },
  { value: 'experience', label: 'Experience', icon: Briefcase },
  { value: 'resumes', label: 'Resumes', icon: FileText },
  { value: 'criteria', label: 'Apply criteria', icon: Target },
  { value: 'questions', label: 'Screening & EEO', icon: ShieldCheck },
  { value: 'templates', label: 'Answer templates', icon: PenLine },
];

export default function Profiles() {
  const { t } = usePrefs();
  const nav = useNavigate();
  const { id } = useParams();
  const { data: boot } = useBoot();
  const { data: apps = [] } = useApps();
  const { run, busy } = useAction();
  const profiles = boot?.profiles || [];
  const current = profiles.find((p) => p.id === id) || (!id ? profiles[0] : undefined);

  useEffect(() => { if (!id && profiles[0]) nav(`/profiles/${profiles[0].id}`, { replace: true }); }, [id, profiles.length]);

  const create = () => run('new', async () => {
    const p = await api<Profile>('/profiles', { body: { label: t('New profile') } });
    refresh('boot');
    nav(`/profiles/${p.id}?tab=details`);
  });

  // Import from resume: read each file here, the server reads it with AI and creates or updates the profile.
  const importRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [importing, setImporting] = useState('');
  const importFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    let lastId = '';
    for (const f of list) {
      setImporting(t('Reading {name}…', { name: f.name }));
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error(t('{name} is larger than 15 MB', { name: f.name }));
        const buf = await f.arrayBuffer();
        const text = await resumeText(f, buf);
        const local = await readLocally(text);
        setImporting(t('AI is reading {name}… (up to 2 minutes)', { name: f.name }));
        const r = await api<{ action: string; profileId: string; name: string; filled: number; aiUsed: boolean; aiError: string }>('/profiles/import',
          { body: { name: f.name, type: f.type, data: bufToBase64(buf), text, local } });
        lastId = r.profileId;
        const what = r.action === 'created' ? t('New profile: {name}', { name: r.name })
          : r.action === 'added' ? t('Added to {name}', { name: r.name }) : t('{name} already has this file', { name: r.name });
        const extra = [r.filled ? t('{n} empty fields filled', { n: r.filled }) : '', !r.aiUsed ? (r.aiError ? t('read without AI ({e})', { e: r.aiError }) : t('read without AI')) : ''].filter(Boolean).join(' · ');
        toast(r.aiUsed || !r.aiError ? 'ok' : 'warn', <span><b>{f.name}</b> → {what}{extra ? ` · ${extra}` : ''}</span>);
      } catch (e: any) {
        toast('err', `${f.name}: ${e.message}`);
      }
    }
    setImporting('');
    refresh('boot');
    if (lastId) nav(`/profiles/${lastId}?tab=details`);
  };

  return (
    <div className="fade-up">
      <PageHeader title={t('Profiles')} sub={t('Each profile is one candidate. Changes sync to the extension within a minute.')}
        actions={<>
          <input ref={importRef} type="file" multiple accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
          <Button icon={<FileUp className="size-4" />} busy={!!importing} onClick={() => importRef.current?.click()}>{t('Import from resume')}</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} busy={busy === 'new'} onClick={create}>{t('New profile')}</Button>
        </>} />
      {importing && <div className="card mb-[var(--gap)] flex items-center gap-2.5 px-4 py-3 text-[13px] text-ink2"><Sparkles className="size-4 animate-pulse text-accent" />{importing}</div>}
      {!profiles.length ? (
        <div className="card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer.files); }}>
          <Empty icon={<FileUp className="size-5" />} title={t('No profiles yet')}
            action={<div className="flex gap-2"><Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => importRef.current?.click()}>{t('Import from resume')}</Button><Button onClick={create}>{t('New profile')}</Button></div>}>
            {t('Drop resume files (PDF or Word) here: each becomes a filled-in profile. Or create one by hand.')}
          </Empty>
        </div>
      ) : (
        <div className="grid gap-d lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="card flex flex-col gap-0.5 self-start p-1.5 lg:sticky lg:top-4">
            {profiles.map((p) => {
              const c = completeness(p);
              const n = apps.filter((a) => a.profileId === p.id).length;
              return (
                <button key={p.id} onClick={() => nav(`/profiles/${p.id}`)}
                  className={cx('flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition', p.id === current?.id ? 'bg-accent/10' : 'hover:bg-sunken')}>
                  <Avatar name={profileName(p)} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[13.5px] font-semibold', p.id === current?.id && 'text-accent')}>{profileName(p)}</span>
                    <span className="block truncate text-[11.5px] text-muted">{t('{n} applied', { n })} · {c.pct}%</span>
                  </span>
                </button>
              );
            })}
          </div>
          {current ? <Editor key={current.id} profile={current} /> : <div className="card"><Empty title={t('Profile not found')} /></div>}
        </div>
      )}
    </div>
  );
}

function Editor({ profile }: { profile: Profile }) {
  const { t } = usePrefs();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'details';
  const [p, setP] = useState<Profile>(profile);
  const [dirty, setDirty] = useState(false);
  const { busy, run } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const c = completeness(p);
  const up = (patch: Partial<Profile>) => { setP((x) => ({ ...x, ...patch })); setDirty(true); };
  const upCrit = (patch: Partial<Criteria>) => up({ criteria: { ...(p.criteria || {}), ...patch } });

  // New data from the server (e.g. the extension synced): show it, unless the user is mid-edit.
  useEffect(() => { if (!dirty) setP(profile); }, [profile]);

  // Leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = () => run('save', async () => {
    const fresh = await api<Profile>(`/profiles/${p.id}`);
    // Resumes and saved answers are edited elsewhere (and the extension may have added some meanwhile): keep the server's.
    await api(`/profiles/${p.id}`, { method: 'PUT', body: { ...fresh, ...p, resumes: fresh.resumes, customAnswers: fresh.customAnswers, answerOptions: fresh.answerOptions } });
    setDirty(false);
    refresh('boot', 'jobs');
  }, 'Profile saved');
  const remove = () => confirm(t('Delete {name} and their resume files? Applications stay in the tracker.', { name: profileName(p) })) && run('del', async () => {
    // Privacy: a candidate who leaves can ask for everything to be removed.
    // Erasing can't be undone, so it needs the word typed (pressing Enter twice only deletes the profile).
    const erase = (prompt(t('The profile will be deleted. To also erase all their history (applications, fill reports, auto-bid queue), type ERASE. Leave empty to keep the history.')) || '').trim().toUpperCase() === 'ERASE';
    await api(`/profiles/${p.id}${erase ? '?erase=1' : ''}`, { method: 'DELETE' });
    refresh('boot');
    nav('/profiles');
  }, 'Profile deleted');
  const upload = (files: FileList | null) => files?.length && run('upload', async () => {
    let last: Profile | null = null;
    for (const f of Array.from(files)) {
      if (f.size > 15 * 1024 * 1024) { toast('err', t('{name} is larger than 15 MB', { name: f.name })); continue; }
      last = await api<Profile>(`/profiles/${p.id}/resumes`, { body: { name: f.name, type: f.type, data: await fileToBase64(f) } });
    }
    if (last) setP((x) => ({ ...x, resumes: last!.resumes, defaultResumeId: last!.defaultResumeId }));
    refresh('boot');
  }, 'Uploaded');
  const removeResume = (rid: string) => confirm(t('Delete this resume file?')) && run('rm', async () => {
    const out = await api<Profile>(`/profiles/${p.id}/resumes/${rid}`, { method: 'DELETE' });
    setP((x) => ({ ...x, resumes: out.resumes, defaultResumeId: out.defaultResumeId }));
    refresh('boot');
  });
  const setTab = (v: string) => setParams((x) => { const n = new URLSearchParams(x); n.set('tab', v); return n; }, { replace: true });

  const textField = ([k, label, opts]: F) => (
    <Field key={k} label={t(label)}>
      {opts ? (
        <Select value={p[k] || ''} onChange={(e) => up({ [k]: e.target.value })}>{opts.map((o) => <option key={o} value={o}>{o ? t(o) : '—'}</option>)}</Select>
      ) : <Input value={p[k] || ''} onChange={(e) => up({ [k]: e.target.value })} />}
    </Field>
  );
  const [showPw, setShowPw] = useState(false);
  const crit: Criteria = { minScore: 45, workMode: 'any', noClearance: true, needsSponsorship: 'auto', excludeTitleWords: ['intern'], ...(p.criteria || {}) };

  return (
    <div className="flex min-w-0 flex-col gap-d">
      <div className="card pad flex flex-wrap items-center gap-4">
        <Avatar name={profileName(p)} size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-extrabold tracking-tight">{profileName(p)}</div>
          <div className="truncate text-[13px] text-muted">{[p.headline || p.currentTitle, [p.city, p.state, p.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
          <div className="mt-2 flex max-w-sm items-center gap-2.5">
            <Progress value={c.pct} tone={c.pct >= 80 ? 'good' : 'warn'} /><span className="text-[12px] font-bold tnum">{c.pct}%</span>
          </div>
          {c.missing.length > 0 && <div className="mt-1 text-[11.5px] text-muted">{t('Missing')}: {c.missing.map((m) => t(m)).join(', ')}</div>}
        </div>
        <div className="flex gap-2">
          <IconButton label={t('Delete profile')} onClick={remove}><Trash2 className="size-4" /></IconButton>
          {dirty && <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => { setP(profile); setDirty(false); }}>{t('Undo')}</Button>}
          <Button variant="primary" icon={<Save className="size-4" />} busy={busy === 'save'} disabled={!dirty} onClick={save}>{dirty ? t('Save changes') : t('Saved')}</Button>
        </div>
      </div>

      <div className="scroll-thin overflow-x-auto"><Segmented value={tab} onChange={setTab} options={TABS.map(({ value, label, icon: I }) => ({ value, label: <><I className="size-4" />{t(label)}</> }))} /></div>

      {tab === 'details' && (
        <>
          {SECTIONS.slice(0, 3).map((s) => (
            <Card key={s.id} title={t(s.title)}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{s.fields.map(textField)}</div>
            </Card>
          ))}
          <Card title={t('Job site accounts')} icon={<KeyRound className="size-4" />}>
            <p className="-mt-1 mb-3 text-[12.5px] text-muted">{t('JobBid fills this password into sign-in and "create account" pages of job sites (Workday, iCIMS, Taleo...). The email used there is the profile email above. Stored encrypted; never sent to the AI.')}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label={t('Email for job sites')}><Input value={p.email || ''} disabled /></Field>
              <Field label={t('Job sites password')} hint={t('Leave empty to type it yourself on each site.')}>
                <div className="flex gap-2">
                  <Input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={p.sitePassword || ''} onChange={(e) => up({ sitePassword: e.target.value })} className="font-mono" />
                  <IconButton label={showPw ? t('Hide') : t('Show')} onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconButton>
                </div>
              </Field>
            </div>
          </Card>
          <Card title={t('Summary')}><Textarea rows={6} value={p.summary || ''} onChange={(e) => up({ summary: e.target.value })} /></Card>
          <Card title={t('Skills')} actions={<Badge>{(p.skills || []).length}</Badge>}>
            <TagInput value={p.skills || []} onChange={(v) => up({ skills: v })} placeholder={t('Type a skill and press Enter')} />
            <p className="mt-2 text-[12px] text-muted">{t('Skills drive the match score on the job board.')}</p>
          </Card>
        </>
      )}

      {tab === 'experience' && (
        <>
          <Card title={t('Work experience')} icon={<Briefcase className="size-4" />}
            actions={<Button size="sm" variant="soft" icon={<Plus className="size-3.5" />} onClick={() => up({ experience: [{ title: '', company: '', location: '', start: '', end: '', description: '' }, ...(p.experience || [])] })}>{t('Add')}</Button>}>
            <div className="flex flex-col gap-3">
              {(p.experience || []).map((x, i) => (
                <div key={i} className="rounded-[12px] border border-line p-3">
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[2fr_2fr_1.4fr_1fr_1fr_auto]">
                    {(['title', 'company', 'location', 'start', 'end'] as const).map((k) => (
                      <Field key={k} label={t({ title: 'Title', company: 'Company', location: 'Location', start: 'Start', end: 'End' }[k])}>
                        <Input value={x[k] || ''} placeholder={k === 'start' || k === 'end' ? 'MM/YYYY' : ''} onChange={(e) => up({ experience: (p.experience || []).map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)) })} />
                      </Field>
                    ))}
                    <div className="flex items-end"><IconButton label={t('Remove')} onClick={() => up({ experience: (p.experience || []).filter((_, j) => j !== i) })}><X className="size-4" /></IconButton></div>
                  </div>
                  <Textarea className="mt-2.5" rows={4} value={x.description || ''} placeholder={t('What you did, with results')} onChange={(e) => up({ experience: (p.experience || []).map((y, j) => (j === i ? { ...y, description: e.target.value } : y)) })} />
                </div>
              ))}
              {!(p.experience || []).length && <p className="text-[13px] text-muted">{t('No experience yet.')}</p>}
            </div>
          </Card>
          <Card title={t('Education')} icon={<GraduationCap className="size-4" />}
            actions={<Button size="sm" variant="soft" icon={<Plus className="size-3.5" />} onClick={() => up({ education: [...(p.education || []), { school: '', degree: '', field: '', start: '', end: '' }] })}>{t('Add')}</Button>}>
            <div className="flex flex-col gap-3">
              {(p.education || []).map((x, i) => (
                <div key={i} className="grid gap-2.5 rounded-[12px] border border-line p-3 sm:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1.6fr_1fr_1fr_auto]">
                  {(['school', 'degree', 'field', 'start', 'end'] as const).map((k) => (
                    <Field key={k} label={t({ school: 'School', degree: 'Degree', field: 'Field of study', start: 'Start', end: 'End' }[k])}>
                      <Input value={x[k] || ''} placeholder={k === 'start' || k === 'end' ? 'MM/YYYY' : ''} onChange={(e) => up({ education: (p.education || []).map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)) })} />
                    </Field>
                  ))}
                  <div className="flex items-end"><IconButton label={t('Remove')} onClick={() => up({ education: (p.education || []).filter((_, j) => j !== i) })}><X className="size-4" /></IconButton></div>
                </div>
              ))}
              {!(p.education || []).length && <p className="text-[13px] text-muted">{t('No education yet.')}</p>}
            </div>
          </Card>
        </>
      )}

      {tab === 'resumes' && (
        <Card title={t('Resume files')} icon={<FileText className="size-4" />}
          actions={<Button size="sm" variant="primary" icon={<Upload className="size-3.5" />} busy={busy === 'upload'} onClick={() => fileRef.current?.click()}>{t('Upload')}</Button>}>
          <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
            {(p.resumes || []).length ? (
              <ul className="flex flex-col gap-2">
                {(p.resumes || []).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2.5">
                    <span className="grid size-9 place-items-center rounded-[10px] bg-accent/10 text-[10px] font-extrabold uppercase text-accent">{(r.name.split('.').pop() || '').slice(0, 4)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">{r.name}</div>
                      <div className="text-[11.5px] text-muted">{r.size ? `${Math.round(r.size / 1024)} KB` : ''}{r.sites ? ` · ${t('used for')} ${r.sites}` : ''}</div>
                    </div>
                    {p.defaultResumeId === r.id
                      ? <Badge tone="accent"><Star className="size-3" />{t('Default')}</Badge>
                      : <Button size="sm" variant="ghost" onClick={() => up({ defaultResumeId: r.id })}>{t('Make default')}</Button>}
                    <IconButton label={t('Download')} onClick={() => window.open(withToken(`/api/files/${r.id}?download=1`), '_blank')}><Download className="size-4" /></IconButton>
                    <IconButton label={t('Delete')} onClick={() => removeResume(r.id)}><Trash2 className="size-4" /></IconButton>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<Upload className="size-5" />} title={t('Drop resume files here')}>{t('PDF or Word. The extension attaches the default one to applications.')}</Empty>
            )}
          </div>
          <p className="mt-3 text-[12px] text-muted">{t('To fill this profile from a resume automatically, use "Import from resume" at the top of this page.')}</p>
        </Card>
      )}

      {tab === 'criteria' && (
        <Card title={t('Apply criteria')} icon={<Target className="size-4" />}>
          <p className="mb-4 text-[13px] text-muted">{t('Jobs that break a rule here are marked Disqualified for this profile, with the reason. You can still override any job by hand.')}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('Target job titles')} hint={t('Empty = any title. e.g. "ML Engineer", "Data Scientist"')} className="md:col-span-2">
              <TagInput value={crit.titles || []} onChange={(v) => upCrit({ titles: v })} />
            </Field>
            <Field label={t('Must-have skills')} hint={t('The job must mention all of these')}><TagInput value={crit.mustHave || []} onChange={(v) => upCrit({ mustHave: v })} suggestions={p.skills} /></Field>
            <Field label={t('Deal-breakers')} hint={t('Skip a job that mentions any of these')}><TagInput value={crit.dealBreakers || []} onChange={(v) => upCrit({ dealBreakers: v })} placeholder="PHP, on-call 24/7" /></Field>
            <Field label={t('Skip titles with')}><TagInput value={crit.excludeTitleWords || []} onChange={(v) => upCrit({ excludeTitleWords: v })} placeholder="intern, manager" /></Field>
            <Field label={t('Skip companies')}><TagInput value={crit.excludeCompanies || []} onChange={(v) => upCrit({ excludeCompanies: v })} /></Field>
            <Field label={t('Work type')}>
              <Select value={crit.workMode} onChange={(e) => upCrit({ workMode: e.target.value as any })}>
                <option value="any">{t('Any')}</option><option value="remote">{t('Remote only')}</option><option value="hybrid">{t('Remote or hybrid')}</option><option value="onsite">{t('On-site only')}</option>
              </Select>
            </Field>
            <Field label={t('Locations (for non-remote jobs)')} hint={t('Any of these, e.g. "Chicago", "IL", "United States"')}><TagInput value={crit.locations || []} onChange={(v) => upCrit({ locations: v })} /></Field>
            <Field label={t('Lowest salary (yearly)')} hint={t('Only checked when the job lists a salary')}><Input type="number" min={0} step={5000} value={crit.minSalary || ''} onChange={(e) => upCrit({ minSalary: Number(e.target.value) || 0 })} placeholder="100000" /></Field>
            <Field label={t('Posted within (days)')} hint={t('0 = any age')}><Input type="number" min={0} value={crit.maxAgeDays || 0} onChange={(e) => upCrit({ maxAgeDays: Number(e.target.value) || 0 })} /></Field>
            <Field label={t('Levels')} hint={t('Empty = any level')} className="md:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {['Intern', 'Junior', 'Mid', 'Senior', 'Lead', 'Staff', 'Principal', 'Manager', 'Director'].map((lv) => {
                  const on = (crit.seniority || []).includes(lv);
                  return <button key={lv} type="button" onClick={() => upCrit({ seniority: on ? (crit.seniority || []).filter((x) => x !== lv) : [...(crit.seniority || []), lv] })}
                    className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold transition', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink2 hover:bg-sunken')}>{t(lv)}</button>;
                })}
              </div>
            </Field>
            <Field label={t('Minimum match score: {n}%', { n: crit.minScore ?? 45 })} className="md:col-span-2">
              <input type="range" min={0} max={90} step={5} value={crit.minScore ?? 45} onChange={(e) => upCrit({ minScore: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
            </Field>
            <div className="flex flex-col gap-3 md:col-span-2">
              <Toggle checked={crit.noClearance !== false} onChange={(v) => upCrit({ noClearance: v })} label={t('Skip jobs that need a security clearance')} />
              <Toggle checked={crit.needsSponsorship === 'auto' ? /^y/i.test(p.requiresSponsorship || '') : !!crit.needsSponsorship}
                onChange={(v) => upCrit({ needsSponsorship: v })} label={t('Skip jobs that don\'t sponsor visas')} hint={t('Follows "Needs visa sponsorship?" until you change it here')} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-[10px] bg-accent/5 px-3 py-2 text-[12.5px] text-ink2"><Sparkles className="size-4 text-accent" />{t('After saving, every job on the board is re-scored for this profile.')}</div>
        </Card>
      )}

      {tab === 'templates' && <Templates p={p} up={up} />}

      {tab === 'questions' && SECTIONS.slice(3).map((s) => (
        <Card key={s.id} title={t(s.title)}>
          {s.caption && <p className="-mt-1 mb-3 text-[12.5px] text-muted">{t(s.caption)}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{s.fields.map(textField)}</div>
        </Card>
      ))}

      {dirty && (
        <div className="card fade-up sticky bottom-4 z-20 flex items-center gap-3 px-4 py-2.5">
          <span className="text-[13px] font-semibold">{t('You have unsaved changes')}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => { setP(profile); setDirty(false); }}>{t('Undo')}</Button>
            <Button variant="primary" icon={<Save className="size-4" />} busy={busy === 'save'} onClick={save}>{t('Save changes')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Answer templates: the user's own texts for common open questions ----------
type Tpl = { id: string; kind?: string; name?: string; keywords?: string; text: string };
const KINDS: { kind: string; name: string; hint: string; example: string }[] = [
  { kind: 'whyCompany', name: 'Why this company', hint: '"Why are you interested in working at Voltus?", "What draws you to…", "Why do you want to join…"',
    example: "I want to work at {company} because … In my {years} years as a {myTitle} I have …, and I'd like to bring that to {role}." },
  { kind: 'aboutMe', name: 'About me', hint: '"Tell us about yourself", "Introduce yourself"',
    example: "I'm {myName}, a {myTitle} with {years} years of experience in {skills}. …" },
  { kind: 'coverNote', name: 'Additional info / cover note', hint: '"Anything else you would like us to know?", "Cover letter" text boxes',
    example: "Thank you for considering my application for {role} at {company}. …" },
];
const PLACEHOLDERS = ['{company}', '{role}', '{myName}', '{myTitle}', '{years}', '{skills}'];

// Outside Templates so the text box keeps focus while typing.
function TplEditor({ value, onChange, preview }: { value: string; onChange: (v: string) => void; preview: (s: string) => string }) {
  const { t } = usePrefs();
  return (
    <>
      <Textarea rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
      {value.trim() && <p className="mt-1.5 rounded-[8px] bg-sunken px-3 py-2 text-[12px] text-ink2"><b>{t('Preview')}:</b> {preview(value)}</p>}
    </>
  );
}

function Templates({ p, up }: { p: Profile; up: (patch: Partial<Profile>) => void }) {
  const { t } = usePrefs();
  const list: Tpl[] = p.answerTemplates || [];
  const set = (next: Tpl[]) => up({ answerTemplates: next });
  const byKind = (kind: string) => list.find((x) => x.kind === kind);
  const setKind = (kind: string, text: string) => {
    const cur = byKind(kind);
    set(cur ? list.map((x) => (x === cur ? { ...x, text } : x)) : [...list, { id: crypto.randomUUID(), kind, text }]);
  };
  const custom = list.filter((x) => !x.kind);
  const preview = (text: string) => text.replace(/\{company\}/gi, 'Voltus').replace(/\{role\}/gi, 'Senior Software Engineer')
    .replace(/\{myName\}/gi, profileName(p)).replace(/\{myTitle\}/gi, p.headline || p.currentTitle || '').replace(/\{years\}/gi, String(p.yearsExperience || ''))
    .replace(/\{skills\}/gi, (p.skills || []).slice(0, 3).join(', '));
  return (
    <>
      <Card title={t('Answer templates')} icon={<PenLine className="size-4" />}>
        <p className="-mt-1 text-[12.5px] text-muted">{t('Write each answer once in your own words. Fill puts it in automatically, with the job\'s company and title filled in - no AI and no waiting. Questions that say "no AI, use your own words" are answered only from these.')}</p>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">{t('Placeholders')}: {PLACEHOLDERS.map((x) => <code key={x} className="rounded bg-sunken px-1.5 py-0.5 text-ink2">{x}</code>)}</p>
      </Card>
      {KINDS.map((k) => (
        <Card key={k.kind} title={t(k.name)} actions={byKind(k.kind)?.text?.trim() ? <Badge tone="good">{t('In use')}</Badge> : <Badge>{t('Empty')}</Badge>}>
          <p className="-mt-1 mb-2 text-[12px] text-muted">{t('Used for')}: {k.hint}</p>
          <TplEditor value={byKind(k.kind)?.text || ''} onChange={(v) => setKind(k.kind, v)} preview={preview} />
          {!byKind(k.kind)?.text && <button className="mt-1.5 text-[12px] font-semibold text-accent" onClick={() => setKind(k.kind, k.example)}>{t('Start from an example')}</button>}
        </Card>
      ))}
      <Card title={t('Your own templates')} actions={<Button size="sm" variant="soft" icon={<Plus className="size-3.5" />} onClick={() => set([...list, { id: crypto.randomUUID(), name: '', keywords: '', text: '' }])}>{t('Add')}</Button>}>
        {custom.length ? custom.map((x) => (
          <div key={x.id} className="mb-3 rounded-[12px] border border-line p-3">
            <div className="mb-2 flex gap-2">
              <Field label={t('Used when the question contains (comma separated)')} className="flex-1">
                <Input value={x.keywords || ''} placeholder="climate, sustainability, energy" onChange={(e) => set(list.map((y) => (y === x ? { ...y, keywords: e.target.value } : y)))} />
              </Field>
              <div className="flex items-end"><IconButton label={t('Remove')} onClick={() => set(list.filter((y) => y !== x))}><X className="size-4" /></IconButton></div>
            </div>
            <TplEditor value={x.text} onChange={(v) => set(list.map((y) => (y === x ? { ...y, text: v } : y)))} preview={preview} />
          </div>
        )) : <p className="text-[13px] text-muted">{t('For other questions you get often: choose a few words from the question, and write the answer once.')}</p>}
      </Card>
    </>
  );
}
