import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, ArrowUp, ArrowDown, Zap, CheckCircle2, XCircle, CircleDashed, Eye, EyeOff, RefreshCw , Settings2, ChevronDown } from 'lucide-react';
import { api, refresh, useBoot } from '../api';
import { usePrefs } from '../prefs';
import { Badge, Button, Card, Empty, Field, IconButton, Input, Modal, PageHeader, Segmented, Select, Toggle, ago, cx, useAction } from '../components/ui';

type Key = { id: string; provider: string; key: string; model: string; enabled?: boolean; label?: string; baseUrl?: string };
const PROVIDER_NAMES: Record<string, string> = {
  gemini: 'Google Gemini', openai: 'OpenAI (ChatGPT)', anthropic: 'Anthropic (Claude)', groq: 'Groq', openrouter: 'OpenRouter', xai: 'xAI Grok',
  deepseek: 'DeepSeek', mistral: 'Mistral', together: 'Together AI', custom: 'Custom (OpenAI-compatible)',
};
const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : '••••');
type ModelRow = { id: string; name?: string; free?: boolean };
// Shown immediately, and kept when the provider will not return a live list (region blocks answer 403).
const KNOWN_MODELS: Record<string, ModelRow[]> = {
  openai: [
    { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
    { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
    { id: 'gpt-5-mini', name: 'GPT-5 mini' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  ],
  anthropic: [
    { id: 'claude-opus-5-5', name: 'Claude Opus' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
    { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B' },
    { id: 'qwen/qwen3.8-27b', name: 'Qwen3.8 27B' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  ],
  mistral: [
    { id: 'mistral-small-latest', name: 'Mistral Small' },
    { id: 'mistral-large-latest', name: 'Mistral Large' },
  ],
  xai: [
    { id: 'grok-3-mini', name: 'Grok 3 Mini' },
    { id: 'grok-3', name: 'Grok 3' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo' },
  ],
};

export default function AiKeys() {
  const { t } = usePrefs();
  const { data: boot } = useBoot();
  const health = useQuery({ queryKey: ['aihealth'], queryFn: () => api<{ health: Record<string, any> }>('/ai/health'), refetchInterval: 20000 });
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Key | null>(null);
  const settings = boot?.settings || {};
  const keys: Key[] = Array.isArray(settings.aiKeys) ? settings.aiKeys : [];
  const h = health.data?.health || {};
  // Calls per key from every Chrome and the hub (today / last 7 days).
  const usage = useQuery({ queryKey: ['aiusage'], queryFn: () => api<{ keys: Record<string, Usage> }>('/admin/ai-usage?days=7'), refetchInterval: 60000 });
  const u = usage.data?.keys || {};

  const saveKeys = (aiKeys: Key[], ok?: string) => run('save', async () => { await api('/settings', { method: 'PUT', body: { settings: { aiKeys } } }); refresh('boot', 'aihealth'); }, ok);
  const move = (i: number, d: number) => { const n = [...keys]; [n[i], n[i + d]] = [n[i + d], n[i]]; saveKeys(n); };
  const test = (ids?: string[]) => run('test' + (ids?.[0] || 'all'), async () => { await api('/ai/test', { body: { ids } }); refresh('aihealth'); });

  return (
    <div className="fade-up">
      <PageHeader title={t('AI keys')} sub={t('Shared with the extension. If one key fails or hits its limit, the next one is used automatically.')}
        actions={<>
          <Button icon={<RefreshCw className="size-4" />} busy={busy === 'testall'} disabled={!keys.length} onClick={() => test()}>{t('Test all')}</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t('Add key')}</Button>
        </>} />

      <Card className="mb-[var(--gap)]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">{t('How keys are used')}</div>
            <div className="text-[12.5px] text-muted">{settings.aiStrategy === 'rotate' ? t('Take turns: spreads requests over all keys (good for free limits).') : t('In order: always the first working key, the others as backup.')}</div>
          </div>
          <Segmented value={settings.aiStrategy === 'rotate' ? 'rotate' : 'order'} onChange={(v) => run('s', async () => { await api('/settings', { method: 'PUT', body: { settings: { aiStrategy: v === 'rotate' ? 'rotate' : 'failover' } } }); refresh('boot'); })}
            options={[{ value: 'order', label: t('In order') }, { value: 'rotate', label: t('Take turns') }]} />
        </div>
      </Card>

      {!keys.length ? (
        <div className="card"><Empty icon={<KeyRound className="size-5" />} title={t('No AI keys yet')} action={<Button variant="primary" onClick={() => setAdding(true)}>{t('Add key')}</Button>}>
          {t('Free keys: OpenRouter (models ending in ":free") or Google AI Studio for Gemini.')}
        </Empty></div>
      ) : (
        <div className="flex flex-col gap-2">
          {keys.map((k, i) => {
            const st = h[k.id];
            return (
              <div key={k.id} className={cx('card flex flex-wrap items-center gap-3 px-4 py-3', k.enabled === false && 'opacity-60')}>
                <span className="grid size-7 place-items-center rounded-full bg-sunken text-[12px] font-bold text-muted tnum">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-bold">{k.label || PROVIDER_NAMES[k.provider] || k.provider}</span>
                    <span className="font-mono text-[12px] text-muted">{mask(k.key)}</span>
                  </div>
                  <div className="truncate text-[12px] text-muted">{k.model || boot?.providers?.[k.provider]?.defaultModel}</div>
                  <UsageLine u={u[k.id]} />
                </div>
                {st ? (
                  st.ok
                    ? <Badge tone="good" title={st.at}><CheckCircle2 className="size-3" />{t('Working')}{st.ms ? ` · ${(st.ms / 1000).toFixed(1)}s` : ''} · {ago(st.at, t)}</Badge>
                    : <Badge tone="bad" title={st.error}><XCircle className="size-3" />{t('Failed')} · {ago(st.at, t)}</Badge>
                ) : <Badge><CircleDashed className="size-3" />{t('Not tested')}</Badge>}
                <Toggle checked={k.enabled !== false} onChange={(v) => saveKeys(keys.map((x) => (x.id === k.id ? { ...x, enabled: v } : x)))} />
                <div className="flex items-center">
                  <Button size="sm" variant="ghost" icon={<Zap className="size-3.5" />} busy={busy === 'test' + k.id} onClick={() => test([k.id])}>{t('Test')}</Button>
                  <IconButton label={t('Key settings')} onClick={() => setEditing(k)}><Settings2 className="size-4" /></IconButton>
                  <IconButton label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="size-4" /></IconButton>
                  <IconButton label={t('Move down')} disabled={i === keys.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="size-4" /></IconButton>
                  <IconButton label={t('Delete')} onClick={() => confirm(t('Delete this key?')) && saveKeys(keys.filter((x) => x.id !== k.id), 'Deleted')}><Trash2 className="size-4" /></IconButton>
                </div>
                {st && !st.ok && st.error && <div className="w-full rounded-[8px] bg-bad/5 px-3 py-1.5 text-[12px] text-bad">{st.error}</div>}
              </div>
            );
          })}
        </div>
      )}
      <KeyDialog open={adding} onClose={() => setAdding(false)} onSave={(k) => { saveKeys([...keys, k], 'Key added'); setAdding(false); }} />
      <KeyDialog open={!!editing} editing={editing} onClose={() => setEditing(null)} onSave={(k) => { saveKeys(keys.map((x) => (x.id === k.id ? k : x)), 'Saved'); setEditing(null); }} />
    </div>
  );
}

type Usage = { today: { calls: number; ok: number; fail: number; quota: number }; week: { calls: number; ok: number; fail: number; quota: number; ms: number }; lastError: string; lastErrorAt: string };
function UsageLine({ u }: { u?: Usage }) {
  const { t } = usePrefs();
  if (!u || !u.week.calls) return <div className="text-[12px] text-muted">{t('Not used in the last 7 days')}</div>;
  const avg = u.week.ok ? (u.week.ms / u.week.calls / 1000).toFixed(1) : '';
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-ink2">
      <span>{t('Today: {n} calls', { n: u.today.calls })}{u.today.fail ? <span className="text-bad"> · {t('{n} failed', { n: u.today.fail })}</span> : null}</span>
      <span className="text-muted">{t('7 days: {n} calls', { n: u.week.calls })}{avg ? ` · ${t('avg {s}s', { s: avg })}` : ''}</span>
      {u.today.quota > 0 && <Badge tone="warn">{t('Quota used up today')}</Badge>}
    </div>
  );
}

// Add a key, or change one (name, model, the key itself). Leaving the key box empty keeps the current key.
function KeyDialog({ open, editing, onClose, onSave }: { open: boolean; editing?: Key | null; onClose: () => void; onSave: (k: Key) => void }) {
  const { t } = usePrefs();
  const { data: boot } = useBoot();
  const { busy, run } = useAction();
  const [provider, setProvider] = useState('openrouter');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listNote, setListNote] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (open && (editing?.id || 'new') !== openFor) {
    setOpenFor(editing?.id || 'new');
    setProvider(editing?.provider || 'openrouter'); setLabel(editing?.label || ''); setKey(''); setModel(editing?.model || ''); setBaseUrl(editing?.baseUrl || ''); setModels(null); setShow(false);
    setListOpen(false); setQuery(''); setListNote('');
  }
  if (!open && openFor !== null) setOpenFor(null);
  const list = models || boot?.modelCache?.[provider] || [];
  const withCurrent = model && !list.some((m) => m.id === model) ? [{ id: model }, ...list] : list;
  const keyForList = key.trim() || (editing && editing.provider === provider ? editing.key : '');
  const defaultModel = boot?.providers?.[provider]?.defaultModel || '';
  const known = KNOWN_MODELS[provider] || [];
  const load = () => {
    setListOpen(true);
    if (known.length) setModels((cur) => (cur?.length ? cur : known));
    return run('models', async () => {
      if (!keyForList) { setListNote(t('Enter an API key first, then load models.')); return; }
      try {
        const got = await api<ModelRow[]>('/ai/models', { body: { provider, apiKey: keyForList, baseUrl } });
        const arr = Array.isArray(got) ? got : [];
        if (arr.length) { setModels(arr); setListNote(''); return; }
      } catch { /* the network often refuses the provider; the known list stays */ }
      if (known.length) { setModels(known); setListNote(t('The provider did not return a live list, so these known models are shown instead.')); }
      else setModels([]);
    });
  };
  const pick = (id: string) => { setModel(id); setListOpen(false); setQuery(''); };
  const q = query.trim().toLowerCase();
  const shown = withCurrent.filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q));
  const showDefault = !q || 'default'.includes(q) || defaultModel.toLowerCase().includes(q);
  const chosen = !model ? `${t('Default')} (${defaultModel})` : (list.find((m) => m.id === model)?.name ? `${list.find((m) => m.id === model)?.name} · ${model}` : model);
  // Image, speech and video models can't answer questions.
  const badModel = /image|imagen|tts|audio|veo|embed|vision-only|robotics/i.test(model);
  const save = () => {
    onSave({ ...(editing || {}), id: editing?.id || crypto.randomUUID(), provider, label: label.trim(), key: key.trim() || editing?.key || '', model: model || boot?.providers?.[provider]?.defaultModel || '', ...(provider === 'custom' ? { baseUrl: baseUrl.trim() } : {}), enabled: editing?.enabled ?? true });
  };
  return (
    <Modal open={open} onClose={onClose} title={editing ? t('Key settings') : t('Add AI key')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" disabled={(!editing && !key.trim()) || (provider === 'custom' && (!baseUrl.trim() || !model))} onClick={save}>{editing ? t('Save') : t('Add key')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('Provider')}>
          <Select value={provider} onChange={(e) => { setProvider(e.target.value); setModels(null); setModel(''); setListOpen(false); setQuery(''); setListNote(''); }}>
            {Object.keys(boot?.providers || PROVIDER_NAMES).map((p) => <option key={p} value={p}>{PROVIDER_NAMES[p] || p}</option>)}
          </Select>
        </Field>
        <Field label={t('Name (optional)')} hint={t('e.g. "OpenRouter - personal", so you can tell keys apart')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={PROVIDER_NAMES[provider] || provider} />
        </Field>
        {provider === 'custom' && (
          <Field label={t('Server address')} hint={t('Any OpenAI-compatible API, e.g. https://api.example.com/v1 or http://localhost:11434/v1 for Ollama')}>
            <Input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setModels(null); }} placeholder="https://.../v1" className="font-mono" />
          </Field>
        )}
        <Field label={t('API key')} hint={editing ? t('Leave empty to keep the current key ({k}).', { k: mask(editing.key) }) : undefined}>
          <div className="flex gap-2">
            <Input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" className="font-mono" placeholder={editing ? mask(editing.key) : ''} />
            <IconButton label={show ? t('Hide') : t('Show')} onClick={() => setShow(!show)}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconButton>
          </div>
        </Field>
        <Field label={t('Model')} hint={badModel ? <span className="text-bad">{t('This looks like an image / speech model - it cannot answer questions. Pick a text model.')}</span> : listNote ? listNote : provider === 'openrouter' ? t('Only free models are listed.') : undefined}>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              {provider === 'custom' ? (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('Model name')} className="font-mono" />
              ) : (
                <button type="button" onClick={() => { if (listOpen) { setListOpen(false); return; } setListOpen(true); if (!list.length) load(); }}
                  className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line bg-card px-3 text-left text-[13.5px] outline-none hover:border-accent focus:border-accent focus:ring-2 focus:ring-accent/20">
                  <span className="min-w-0 flex-1 truncate">{chosen}</span>
                  <ChevronDown className={cx('size-4 shrink-0 text-muted transition', listOpen && 'rotate-180')} />
                </button>
              )}
              <Button busy={busy === 'models'} disabled={!keyForList || (provider === 'custom' && !baseUrl.trim())} onClick={load}>{t('Load models')}</Button>
            </div>
            {listOpen && (
              <div className="overflow-hidden rounded-[10px] border border-line bg-card">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search models')} autoFocus
                  className="h-8 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-muted" />
                <div className="scroll-thin max-h-52 overflow-y-auto py-1">
                  {showDefault && provider !== 'custom' && (
                    <button type="button" onClick={() => pick('')} className={cx('block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:bg-sunken', !model && 'bg-accent/10 font-semibold')}>
                      {t('Default')} ({defaultModel})
                    </button>
                  )}
                  {shown.map((m) => (
                    <button type="button" key={m.id} onClick={() => pick(m.id)} className={cx('block w-full truncate px-3 py-1.5 text-left text-[12.5px] hover:bg-sunken', model === m.id && 'bg-accent/10 font-semibold')}>
                      {m.name ? `${m.name} · ${m.id}` : m.id}
                    </button>
                  ))}
                  {busy === 'models' && !shown.length && <div className="px-3 py-3 text-[12.5px] text-muted">{t('Loading models…')}</div>}
                  {busy !== 'models' && !showDefault && !shown.length && <div className="px-3 py-3 text-[12.5px] text-muted">{t('No matching models')}</div>}
                </div>
              </div>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
