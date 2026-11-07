import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserCircle, Puzzle, RotateCcw, Save, Lock, Users } from 'lucide-react';
import { api, qc, type User } from '../api';
import { usePrefs } from '../prefs';
import { Avatar, Badge, Button, Card, Field, Input, Loading, PageHeader, Select, Toggle, cx, useAction } from '../components/ui';
import { ChatgptTest } from './Settings';

type Me = { user: User; prefs: Record<string, any>; own: Record<string, any>; defaults: Record<string, any>; profiles: 'all' | { id: string; name: string }[] };

// The account's own extension settings (each one can follow the default or be the account's own choice).
const SWITCHES: { key: string; label: string; hint: string }[] = [
  { key: 'useAI', label: 'Use AI for questions', hint: 'Answer open questions and pick options with AI when no saved answer fits' },
  { key: 'learnAnswers', label: 'Learn my answers', hint: 'Save what you type on forms so it is filled next time' },
  { key: 'overwrite', label: 'Overwrite filled fields', hint: 'Replace values a site already filled in' },
  { key: 'showPanel', label: 'Open the side panel by default', hint: 'Off = a small button on every page' },
  { key: 'panelPush', label: 'Push the page aside', hint: 'Make room for the panel so it never covers the form' },
  { key: 'promptLog', label: 'Ask to log after submitting', hint: '"Did you submit this application?"' },
  { key: 'autoSubmit', label: 'Auto-submit', hint: 'When no required field is empty, submit after 1 second (with Cancel)' },
];

export default function Account() {
  const { t } = usePrefs();
  const me = useQuery({ queryKey: ['me', 'account'], queryFn: () => api<Me>('/me') });
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  useEffect(() => { if (me.data) setF({ name: me.data.user.name, email: me.data.user.email || '', phone: me.data.user.phone || '' }); }, [me.data?.user.id, me.data?.user.updatedAt]);
  if (me.isLoading || !me.data) return <Loading />;
  const { user, prefs, own, defaults, profiles } = me.data;
  const changed = f.name !== user.name || f.email !== (user.email || '') || f.phone !== (user.phone || '');

  const save = (body: any, ok?: string) => run('save', async () => {
    const r = await api<Me>('/me', { method: 'PUT', body });
    qc.setQueryData(['me', 'account'], (old: Me | undefined) => ({ ...(old as Me), ...r }));
    qc.invalidateQueries({ queryKey: ['me'] });
  }, ok);
  const reset = (key?: string) => run('reset', async () => {
    const r = await api<Me>('/me/reset', { body: key ? { key } : {} });
    qc.setQueryData(['me', 'account'], (old: Me | undefined) => ({ ...(old as Me), ...r }));
  }, key ? undefined : 'Back to the defaults');
  const setPref = (key: string, value: any) => save({ prefs: { [key]: value } });

  // "Default" or "Your choice" next to each setting, with a way back to the default.
  const Origin = ({ k }: { k: string }) => (k in own
    ? <span className="inline-flex items-center gap-1.5"><Badge tone="accent">{t('Your choice')}</Badge><button className="text-[11.5px] font-semibold text-muted hover:text-accent" onClick={() => reset(k)}>{t('Use default')}</button></span>
    : <Badge>{t('Default')}</Badge>);

  return (
    <div className="fade-up">
      <PageHeader title={t('My account')} sub={t('Your details and how the JobBid extension works in your Chrome.')} />
      <div className="grid gap-d xl:grid-cols-2">
        <Card title={t('Account')} icon={<UserCircle className="size-4" />}
          actions={changed && <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} busy={busy === 'save'} onClick={() => save(f, 'Saved')}>{t('Save')}</Button>}>
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={f.name || user.username} size={48} />
            <div><div className="text-[15px] font-bold">{user.name}</div><div className="text-[12.5px] text-muted">@{user.username} · {user.role === 'admin' ? t('Admin') : t('User')}</div></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Display name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('Username')} hint={t('Only an admin can change it.')}><Input value={user.username} disabled /></Field>
            <Field label={t('Email')}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" /></Field>
            <Field label={t('Phone')}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted"><Lock className="size-3.5" />{t('Change your password: click your name at the bottom of the menu.')}</p>
        </Card>

        <Card title={t('My profiles')} icon={<Users className="size-4" />}>
          {profiles === 'all' ? <p className="text-[13px] text-ink2">{t('As an admin you can use every profile.')}</p>
            : profiles.length ? (
              <div className="flex flex-wrap gap-1.5">{profiles.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-line py-1 pl-1 pr-3 text-[12.5px] font-semibold"><Avatar name={p.name} size={20} />{p.name || t('Deleted profile')}</span>)}</div>
            ) : <p className="text-[13px] text-muted">{t('No profiles yet. Ask the admin to give you profiles, or create one on the Profiles page.')}</p>}
          <p className="mt-3 text-[12px] text-muted">{t('Only an admin can change which profiles you can use.')}</p>
        </Card>

        <Card className="xl:col-span-2" title={t('My extension settings')} icon={<Puzzle className="size-4" />}
          actions={Object.keys(own).length > 0 && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} busy={busy === 'reset'} onClick={() => reset()}>{t('All back to defaults')}</Button>}>
          <p className="-mt-1 mb-4 text-[12.5px] text-muted">{t('These apply to the JobBid extension in every Chrome where you are signed in. "Default" follows what the admin set for everyone.')}</p>
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            {SWITCHES.map((x) => (
              <div key={x.key} className="flex items-start gap-3">
                <div className="min-w-0 flex-1"><Toggle checked={!!prefs[x.key]} onChange={(v) => setPref(x.key, v)} label={t(x.label)} hint={t(x.hint)} /></div>
                <Origin k={x.key} />
              </div>
            ))}
            <div className="flex items-start gap-3">
              <Field className="flex-1" label={t('AI time limit')} hint={t('If the AI has not answered by then, skip it and save the questions')}>
                <Select value={String(prefs.aiTimeout ?? 5)} onChange={(e) => setPref('aiTimeout', Number(e.target.value))} className="max-w-[200px]">
                  {[5, 10, 20, 45, 90].map((n) => <option key={n} value={n}>{t('{n} seconds', { n })}</option>)}
                </Select>
              </Field>
              <Origin k="aiTimeout" />
            </div>
            <div className="flex items-start gap-3">
              <Field className="flex-1" label={t('ChatGPT website (no API key)')} hint={t('Asks ChatGPT in a background tab with the account signed in to Chrome. Slower (10-60 s per question), and against the OpenAI terms for automated use - the ChatGPT account could be limited.')}>
                <Select value={prefs.chatgptWeb || 'off'} onChange={(e) => setPref('chatgptWeb', e.target.value)} className="max-w-[300px]">
                  <option value="off">{t('Off')}</option><option value="backup">{t('Backup (when API keys fail)')}</option><option value="only">{t('Only (no API keys)')}</option>
                </Select>
              </Field>
              <Origin k="chatgptWeb" />
            </div>
          </div>
          <div className={cx('mt-4 border-t border-line pt-4')}><ChatgptTest /></div>
          <p className="mt-3 text-[12px] text-muted">{t('Defaults right now')}: {SWITCHES.filter((x) => defaults[x.key]).map((x) => t(x.label)).join(', ') || '—'}</p>
        </Card>
      </div>
    </div>
  );
}
