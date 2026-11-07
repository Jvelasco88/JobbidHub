// The bell: alerts about settings changes (yours, the admin's, other accounts'), with an unread count,
// a pop-up for each new one while the page is open, and the list of recent ones.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Settings as Cog, UserCog, UserPlus, Puzzle, CheckCheck } from 'lucide-react';
import { api, qc } from '../api';
import { usePrefs } from '../prefs';
import { Button, IconButton, Modal, ago, cx, useToast } from './ui';

export type Notice = {
  id: number; at: string; actor: string; actorId: string; mine: boolean; audience: string; kind: 'settings' | 'access' | 'signup' | 'prefs';
  unread: boolean; via?: 'dashboard' | 'extension'; target?: string; waiting?: boolean; changes?: { label: string; value: string }[];
};
type Notices = { items: Notice[]; unread: number; lastId: number; pendingSignups: number };

export const useNotices = () => useQuery({ queryKey: ['notices'], queryFn: () => api<Notices>('/notices'), refetchInterval: 8000 });

export function useNoticeText() {
  const { t } = usePrefs();
  return (n: Notice) => {
    const actor = n.actor || t('Someone');
    if (n.kind === 'signup') return n.waiting ? t('{actor} asked for an account', { actor }) : t('{actor} created an account', { actor });
    if (n.kind === 'access') return n.audience.startsWith('user:') && !n.target ? t('{actor} changed your account', { actor })
      : t('{actor} changed the account of {target}', { actor, target: n.target || '' });
    if (n.kind === 'prefs') return t('{actor} changed their own extension settings', { actor });
    return n.via === 'extension' ? t('{actor} changed settings in the extension', { actor }) : t('{actor} changed settings', { actor });
  };
}

export const changeLine = (t: (s: string, v?: any) => string, c: { label: string; value: string }) => `${t(c.label)}: ${t(c.value)}`;

const icon = (n: Notice) => (n.kind === 'signup' ? UserPlus : n.kind === 'access' ? UserCog : n.via === 'extension' ? Puzzle : Cog);

export function AlertsBell({ className }: { className?: string }) {
  const { t } = usePrefs();
  const toast = useToast();
  const text = useNoticeText();
  const { data } = useNotices();
  const [open, setOpen] = useState(false);
  const seen = useRef(0);

  // A pop-up for alerts that arrive while the page is open (not for old ones on first load).
  useEffect(() => {
    if (!data) return;
    if (seen.current) {
      for (const n of [...data.items].reverse()) {
        if (n.id > seen.current && !n.mine) {
          toast('info', <span><b>{text(n)}</b>{n.changes?.length ? <span className="block text-muted">{n.changes.slice(0, 3).map((c) => changeLine(t, c)).join(' · ')}</span> : null}</span>);
        }
      }
    }
    seen.current = Math.max(seen.current, data.lastId || 0) || -1;
  }, [data?.lastId]);

  const markRead = async () => {
    await api('/notices/read', { body: { upTo: data?.lastId } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['notices'] });
  };
  const unread = data?.unread || 0;

  return (
    <>
      <IconButton label={unread ? t('{n} new alerts', { n: unread }) : t('Alerts')} className={cx('relative', className)} onClick={() => { setOpen(true); if (unread) markRead(); }}>
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold leading-none text-white tnum">{unread > 99 ? '99+' : unread}</span>}
      </IconButton>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Alerts')}
        footer={<Button variant="ghost" icon={<CheckCheck className="size-4" />} onClick={() => { markRead(); setOpen(false); }}>{t('Close')}</Button>}>
        {data?.items.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.items.map((n) => {
              const I = icon(n);
              return (
                <li key={n.id} className="flex gap-3 py-2.5">
                  <span className={cx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', n.unread ? 'bg-accent/15 text-accent' : 'bg-sunken text-muted')}><I className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className={cx('text-[13px]', n.unread ? 'font-bold' : 'font-medium')}>{text(n)}{n.mine && <span className="ml-1.5 text-[11.5px] font-normal text-muted">({t('you')})</span>}</div>
                    {n.changes?.map((c, i) => <div key={i} className="text-[12.5px] text-ink2">{changeLine(t, c)}</div>)}
                    <div className="mt-0.5 text-[11.5px] text-muted">{ago(n.at, t)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="py-6 text-center text-[13px] text-muted">{t('No alerts yet. Settings changes show up here.')}</p>}
      </Modal>
    </>
  );
}
