import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Puzzle, ChevronDown, ShieldAlert, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { usePrefs } from '../prefs';
import { cx } from './ui';

// The JobBid version running in this browser: the extension stamps it on every page (data-jobbid-version,
// data-jobbid-auto = installed with the JobBid Updater). null = not seen (not installed, or older than 3.9.22).
function useInstalled() {
  const read = () => {
    const el = document.documentElement;
    const v = el.getAttribute('data-jobbid-version');
    return v ? { version: v, auto: el.getAttribute('data-jobbid-auto') === '1' ? true : el.getAttribute('data-jobbid-auto') === '0' ? false : null } : null;
  };
  const [got, setGot] = useState(read);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.source === window && e.data?.__jobbid === 'version') setGot(read()); };
    window.addEventListener('message', onMsg);
    const t = setInterval(() => setGot(read()), 1500); // the extension may load after this page
    return () => { window.removeEventListener('message', onMsg); clearInterval(t); };
  }, []);
  return got;
}
const verNum = (v: string) => v.split('.').map((n) => Number(n) || 0);
const older = (a: string, b: string) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };

// Download the JobBid Chrome extension from this hub, with install steps and help for proxy users.
export default function GetExtension({ className, startOpen = false }: { className?: string; startOpen?: boolean }) {
  const { t } = usePrefs();
  const info = useQuery({ queryKey: ['extInfo'], queryFn: () => api<{ ok: boolean; version?: string; lan?: string[]; publicUrl?: string }>('/extension/info'), retry: false });
  const [open, setOpen] = useState(startOpen);
  const [proxy, setProxy] = useState(false);
  const mine = useInstalled();
  const latest = info.data?.version || '';
  const behind = !!(mine && latest && older(mine.version, latest));
  // The address the friend's proxy must let through: this page's, or the hub's network address when opened on the hub PC.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const host = local ? info.data?.lan?.[0] ? new URL(info.data.lan[0]).hostname : '' : location.hostname;
  if (info.data && !info.data.ok) return null;
  return (
    <div className={cx('card p-4', className)}>
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent/10 text-accent"><Puzzle className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold">{t('JobBid Chrome extension')}</div>
          <div className="text-[12px] text-muted">{info.data?.version ? t('Version {v} · set up for this hub', { v: info.data.version }) : t('Set up for this hub')}</div>
        </div>
      </div>
      {latest && (
        <div className={cx('mt-3 rounded-[10px] border px-3 py-2 text-[12.5px]', !mine ? 'border-line text-ink2' : behind ? 'border-warn/30 bg-warn/10 text-warn' : 'border-good/25 bg-good/10 text-good')}>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>{t('Latest:')} <b className="font-mono">{latest}</b></span>
            <span>{t('This Chrome:')} <b className="font-mono">{mine ? mine.version : t('not found')}</b></span>
          </div>
          <div className="mt-0.5">
            {!mine ? t('JobBid was not seen in this browser: not installed here, or a version older than 3.9.22 (reload this page after installing).')
              : !behind ? t('Up to date.')
              : mine.auto === true ? t('Will update by itself within 30 minutes (auto-update is on). JobBid then reloads on its own.')
              : mine.auto === false ? t('Will not update by itself (installed from the zip). Download again below, or run the auto-update installer once.')
              : t('An update is waiting. With auto-update it installs within 30 minutes; otherwise download again below.')}
          </div>
        </div>
      )}
      {info.data?.publicUrl && (
        <div className="mt-3 rounded-[10px] border border-good/25 bg-good/10 px-3 py-2 text-[12.5px] text-good">
          {t('Internet address (works from anywhere, also through proxies):')} <b className="font-mono">{info.data.publicUrl}</b>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/api/extension/installer" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-3 text-[13px] font-semibold text-white hover:brightness-110">
          <RefreshCw className="size-4" />{t('Install with auto-update (Windows)')}
        </a>
        <a href="/api/extension/download" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-semibold text-ink2 hover:bg-sunken">
          <Download className="size-4" />{t('Zip only')}
        </a>
      </div>

      <button type="button" onClick={() => setOpen(!open)} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent">
        <ChevronDown className={cx('size-3.5 transition', open && 'rotate-180')} />{t('How to install')}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[12.5px] text-ink2">
          <div className="font-semibold">{t('With auto-update (recommended)')}</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t('Run "Install JobBid.bat" (if Windows warns: More info > Run anyway). It puts JobBid in your user folder and checks this hub for updates every 30 minutes.')}</li>
            <li>{t('In Chrome, open chrome://extensions and turn on Developer mode (top right).')}</li>
            <li>{t('Click "Load unpacked" and choose the JobBid folder in your user folder (the installer opens it). Remove any older JobBid first.')}</li>
            <li>{t('Pin JobBid (puzzle icon), click it and sign in with your hub account. The hub address is already filled in.')}</li>
          </ol>
          <div className="text-muted">{t('New versions then install by themselves - JobBid reloads on its own.')}</div>
          <div className="pt-1 font-semibold">{t('Zip only')}</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t('Unzip the downloaded file (right-click > Extract All). Keep the JobBid folder - Chrome uses it from there.')}</li>
          <li>{t('In Chrome, open chrome://extensions and turn on Developer mode (top right).')}</li>
          <li>{t('Click "Load unpacked" and choose the JobBid folder.')}</li>
          <li>{t('Pin JobBid (puzzle icon), click it and sign in with your hub account. The hub address is already filled in.')}</li>
          <li>{t('Updating: download again, replace the folder\'s files, then click the reload icon on JobBid in chrome://extensions.')}</li>
        </ol>
        </div>
      )}

      <button type="button" onClick={() => setProxy(!proxy)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent">
        <ChevronDown className={cx('size-3.5 transition', proxy && 'rotate-180')} />{t('Using a proxy or VPN?')}
      </button>
      {proxy && (
        <div className="mt-2 space-y-1.5 text-[12.5px] text-ink2">
          <p className="flex gap-1.5 text-warn"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{t('A proxy cannot reach this hub (it is on your local network), so the browser shows "Access denied / 403". Let the hub go direct, past the proxy:')}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('Windows proxy: Settings > Network & internet > Proxy > Manual proxy setup > Edit. In "Use the proxy server except for addresses that start with" add:')} <code className="rounded bg-sunken px-1 font-mono">{host ? `${host};` : ''}192.168.*;10.*;localhost</code></li>
            <li>{t('Proxy extension (SwitchyOmega, Proxy SwitchySharp...): add the same addresses to its bypass list / "direct" rules.')}</li>
            <li>{t('Anti-detect browser profile with its own proxy: install JobBid in a normal Chrome instead, or add the address to that profile\'s proxy bypass list.')}</li>
            <li>{t('VPN: turn on "allow local network access" (LAN sharing), or pause the VPN.')}</li>
          </ul>
          <p className="text-muted">{t('Job sites still go through your proxy - only the hub address goes direct.')}</p>
        </div>
      )}
    </div>
  );
}
