import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, Briefcase, Radar, ListChecks, Users, MessageSquareText, CalendarClock, KeyRound, Settings as Cog, Sun, Moon, Monitor, PanelLeftClose, PanelLeftOpen, PanelTop, Languages, Menu as MenuIcon, X, WifiOff, ShieldCheck, LogOut, Lock, NotebookPen, UserCircle, Bot, Puzzle, CircleHelp, Link2, Bug, Network, ShieldAlert } from 'lucide-react';
import { api, qc, setToken, useBoot, useMe, profileName } from './api';
import { usePrefs } from './prefs';
import { Avatar, Button, cx, Field, IconButton, Input, Loading, Menu, MenuItem, Modal, useAction } from './components/ui';
import Home from './pages/Home';
import Jobs from './pages/Jobs';
import Searches from './pages/Searches';
import Applications from './pages/Applications';
import AutoBid from './pages/AutoBid';
import JobLinks from './pages/JobLinks';
import Profiles from './pages/Profiles';
import Answers from './pages/Answers';
import Problems from './pages/Problems';
import Schedule from './pages/Schedule';
import AiKeys from './pages/AiKeys';
import Settings from './pages/Settings';
import Accounts from './pages/Accounts';
import Proxies from './pages/Proxies';
import DailyLog from './pages/DailyLog';
import Account from './pages/Account';
import Login from './pages/Login';
import Help from './pages/Help';
import { AlertsBell, useNotices } from './components/Alerts';
import GetExtension from './components/GetExtension';

const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/jobs', label: 'Job board', icon: Briefcase },
  { to: '/searches', label: 'Job search', icon: Radar },
  { to: '/applications', label: 'Applications', icon: ListChecks },
  { to: '/autobid', label: 'Auto bid', icon: Bot },
  { to: '/joblinks', label: 'Job links', icon: Link2 },
  { to: '/profiles', label: 'Profiles', icon: Users },
  { to: '/answers', label: 'Answers', icon: MessageSquareText },
  { to: '/problems', label: 'Problems', icon: Bug },
  { to: '/schedule', label: 'Schedule', icon: CalendarClock },
  { to: '/daylog', label: 'Daily log', icon: NotebookPen },
  { to: '/account', label: 'My account', icon: UserCircle },
  { to: '/ai', label: 'AI keys', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Cog },
  { to: '/help', label: 'Help', icon: CircleHelp },
];

function ThemeButton() {
  const { prefs, set, t } = usePrefs();
  const next = { system: 'light', light: 'dark', dark: 'system' } as const;
  const Icon = prefs.theme === 'dark' ? Moon : prefs.theme === 'light' ? Sun : Monitor;
  return <IconButton label={t('Theme: {v}', { v: t(prefs.theme) })} onClick={() => set({ theme: next[prefs.theme] })}><Icon className="size-4" /></IconButton>;
}

// The extension download (and install / proxy help), one click away from every page.
function ExtButton() {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={t('Get the extension')} onClick={() => setOpen(true)}><Puzzle className="size-4" /></IconButton>
      <Modal open={open} onClose={() => setOpen(false)} title={t('JobBid Chrome extension')}>
        <GetExtension startOpen className="!border-0 !p-0 !shadow-none" />
      </Modal>
    </>
  );
}

function LangButton() {
  const { prefs, set, t } = usePrefs();
  const next = { en: 'ko', ko: 'zh', zh: 'en' } as const;
  return (
    <button title={t('Language')} onClick={() => set({ lang: next[prefs.lang] })}
      className="inline-flex h-8 items-center gap-1 rounded-[9px] px-2 text-[12px] font-bold text-ink2 hover:bg-sunken hover:text-ink">
      <Languages className="size-4" />{{ en: 'EN', ko: '한', zh: '中' }[prefs.lang]}
    </button>
  );
}

// "Viewing as": which profile's match scores the job board shows.
function ProfileSwitch({ compact }: { compact?: boolean }) {
  const { data } = useBoot();
  const { prefs, set, t } = usePrefs();
  const profiles = data?.profiles || [];
  const cur = profiles.find((p) => p.id === prefs.profileId);
  return (
    <Menu align="left" button={({ onClick }) => (
      <button onClick={onClick} className={cx('flex min-w-0 items-center gap-2.5 rounded-[12px] text-left hover:bg-sunken transition', compact ? 'p-1' : 'w-full p-2')}>
        {cur ? <Avatar name={profileName(cur)} size={compact ? 28 : 34} /> : <span className="grid size-[34px] place-items-center rounded-full bg-accent/10 text-accent"><Users className="size-4" /></span>}
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold">{cur ? profileName(cur) : t('All profiles')}</span>
            <span className="block truncate text-[11.5px] text-muted">{cur ? cur.headline || cur.currentTitle || cur.email : profiles.length === 1 ? t('1 profile') : t('{n} profiles', { n: profiles.length })}</span>
          </span>
        )}
      </button>
    )}>
      {(close) => (
        <>
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">{t('Viewing as')}</div>
          <MenuItem active={!cur} onClick={() => { set({ profileId: '' }); close(); }} icon={<Users className="size-4" />}>{t('All profiles')}</MenuItem>
          {profiles.map((p) => (
            <MenuItem key={p.id} active={p.id === prefs.profileId} onClick={() => { set({ profileId: p.id }); close(); }} icon={<Avatar name={profileName(p)} size={22} />}>{profileName(p)}</MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function ServerBanner() {
  const { error } = useBoot();
  const me = useMe();
  const { t } = usePrefs();
  // Only "can't reach the server" (status 0) - not other errors like a wrong request.
  if ((error as any)?.status !== 0 && (me.error as any)?.status !== 0) return null;
  return (
    <div className="mb-[var(--gap)] flex items-center gap-2.5 rounded-[12px] border border-bad/25 bg-bad/10 px-4 py-3 text-[13px] text-bad">
      <WifiOff className="size-4 shrink-0" />
      <span><b>{t('Server not reachable.')}</b> {t('Start JobBid Hub with start.bat, then this page reconnects by itself.')}</span>
    </div>
  );
}

// Signed in with the old default password or a short one: anyone could guess it through the internet address.
function WeakPasswordBanner() {
  const { data: me } = useMe();
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  if (!me?.weakPassword) return null;
  return (
    <>
    <ChangePassword open={open} onClose={() => setOpen(false)} />
    <div className="mb-[var(--gap)] flex flex-wrap items-center gap-2.5 rounded-[12px] border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] text-warn">
      <ShieldAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1"><b>{t('Your password is easy to guess.')}</b> {t('The hub can be opened from the internet, so use at least 10 characters that are not the default password.')}</span>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>{t('Change password')}</Button>
    </div>
    </>
  );
}

function NavItems({ collapsed, onPick }: { collapsed?: boolean; onPick?: () => void }) {
  const { t } = usePrefs();
  const { data: me } = useMe();
  // AI keys and Accounts are for admins only.
  // Red number on Accounts: sign-ups waiting for approval.
  const pending = useNotices().data?.pendingSignups || 0;
  const items = me?.role === 'admin' ? [...NAV, { to: '/accounts', label: 'Accounts', icon: ShieldCheck }, { to: '/proxies', label: 'Proxies', icon: Network }] : NAV.filter((n) => n.to !== '/ai');
  return (
    <>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={onPick} title={collapsed ? t(label) : undefined}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-[10px] px-3 h-9 text-[13.5px] font-semibold transition',
            isActive ? 'bg-accent/10 text-accent' : 'text-ink2 hover:bg-sunken hover:text-ink', collapsed && 'justify-center px-0')}>
          <span className="relative shrink-0"><Icon className="size-[18px]" />
            {to === '/accounts' && pending > 0 && collapsed && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{pending}</span>}</span>
          {!collapsed && <span className="truncate">{t(label)}</span>}
          {!collapsed && to === '/accounts' && pending > 0 && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1.5 text-[11px] font-bold text-white tnum" title={t('{n} waiting for approval', { n: pending })}>{pending}</span>}
        </NavLink>
      ))}
    </>
  );
}

// Signed-in account: name, change password, sign out.
function AccountMenu({ compact }: { compact?: boolean }) {
  const { t } = usePrefs();
  const { data: me } = useMe();
  const [pwOpen, setPwOpen] = useState(false);
  if (!me) return null;
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken('');
    location.replace('/');
  };
  return (
    <>
      <Menu align="left" button={({ onClick }) => (
        <button onClick={onClick} title={me.name} className={cx('flex min-w-0 items-center gap-2 rounded-[10px] text-left hover:bg-sunken', compact ? 'p-1' : 'flex-1 px-1.5 py-1')}>
          <Avatar name={me.name || me.username} size={28} />
          {!compact && <span className="min-w-0"><span className="block truncate text-[12.5px] font-bold">{me.name}</span>
            <span className="block truncate text-[11px] text-muted">{me.role === 'admin' ? t('Admin') : t('User')} · @{me.username}</span></span>}
        </button>
      )}>
        {(close) => (
          <div className="w-52">
            <MenuItem icon={<UserCircle className="size-4" />} onClick={() => { close(); location.assign('/account'); }}>{t('My account')}</MenuItem>
            <MenuItem icon={<Lock className="size-4" />} onClick={() => { close(); setPwOpen(true); }}>{t('Change password')}</MenuItem>
            <MenuItem danger icon={<LogOut className="size-4" />} onClick={() => { close(); signOut(); }}>{t('Sign out')}</MenuItem>
          </div>
        )}
      </Menu>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePrefs();
  const { busy, run } = useAction();
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const mismatch = f.again && f.password !== f.again;
  const save = () => run('pw', async () => {
    await api('/auth/password', { body: { current: f.current, password: f.password } });
    setF({ current: '', password: '', again: '' });
    qc.invalidateQueries({ queryKey: ['me'] });
    onClose();
  }, 'Password changed');
  return (
    <Modal open={open} onClose={onClose} title={t('Change password')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" busy={busy === 'pw'} disabled={!f.current || f.password.length < 8 || f.password !== f.again} onClick={save}>{t('Save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('Current password')}><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus /></Field>
        <Field label={t('New password')} hint={t('At least 8 characters (10 or more is better). Your other devices will be signed out.')}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label={t('New password again')} hint={mismatch ? <span className="text-bad">{t('The two passwords are different.')}</span> : undefined}><Input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icon.png" alt="" className={small ? 'size-7' : 'size-8'} />
      {!small && <span className="text-[15px] font-extrabold tracking-tight">JobBid <span className="text-accent">Hub</span></span>}
    </div>
  );
}

// Sign-in gate: the dashboard only renders for a signed-in account.
export default function App() {
  const me = useMe();
  useEffect(() => {
    const out = () => { setToken(''); location.replace('/'); };
    addEventListener('jb-signed-out', out);
    return () => removeEventListener('jb-signed-out', out);
  }, []);
  if (me.isLoading) return <Loading />;
  // Server not running at all: show the dashboard shell's "server not reachable" note instead of the sign-in form.
  if (me.error && (me.error as any).status === 0) return <div className="p-6"><ServerBanner /></div>;
  if (!me.data) return <Login />;
  return <Shell />;
}

// Live updates: the server's data revision changes whenever anything is saved (dashboard, another
// account or the extension's sync). When it does, reload every list on screen.
function useLiveRefresh() {
  useEffect(() => {
    let last = '';
    const tick = async () => {
      if (document.hidden) return;
      try {
        const h = await api<{ rev: string; jobs: string }>('/health');
        const now = `${h.rev}|${h.jobs}`;
        if (last && now !== last) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        last = now;
      } catch { /* server down: the banner shows it */ }
    };
    tick();
    const id = setInterval(tick, 4000);
    addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); removeEventListener('visibilitychange', tick); };
  }, []);
}

function Shell() {
  const { prefs, set, t } = usePrefs();
  const { data: me } = useMe();
  useLiveRefresh();
  const [mobileNav, setMobileNav] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileNav(false), [loc.pathname]);
  const top = prefs.nav === 'top';
  const collapsed = prefs.navCollapsed && !top;

  const tools: ReactNode = (
    <div className={cx('flex items-center gap-0.5', collapsed && 'flex-col')}>
      <AlertsBell />
      <ExtButton />
      <LangButton />
      <ThemeButton />
      <IconButton className="hidden md:inline-grid" label={top ? t('Menu on the side') : t('Menu on top')} onClick={() => set({ nav: top ? 'side' : 'top' })}>
        <PanelTop className="size-4" />
      </IconButton>
    </div>
  );

  const pages = (
    <main className="mx-auto w-full max-w-[1500px] p-4 md:p-6">
      <ServerBanner />
      <WeakPasswordBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/searches" element={<Searches />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/autobid" element={<AutoBid />} />
        <Route path="/joblinks" element={<JobLinks />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/profiles/:id" element={<Profiles />} />
        <Route path="/answers" element={<Answers />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/daylog" element={<DailyLog />} />
        <Route path="/account" element={<Account />} />
        {me?.role === 'admin' && <Route path="/ai" element={<AiKeys />} />}
        <Route path="/settings" element={<Settings />} />
        <Route path="/help" element={<Help />} />
        {me?.role === 'admin' && <Route path="/accounts" element={<Accounts />} />}
        {me?.role === 'admin' && <Route path="/proxies" element={<Proxies />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );

  // Phones: a top bar with a slide-in menu, whatever the desktop layout is.
  const mobileBar = (
    <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-card/90 px-3 py-2 backdrop-blur md:hidden">
      <IconButton label={t('Menu')} onClick={() => setMobileNav(true)}><MenuIcon className="size-5" /></IconButton>
      <Logo />
      <div className="ml-auto flex items-center gap-1"><ProfileSwitch compact />{tools}<AccountMenu compact /></div>
    </div>
  );
  const mobileDrawer = mobileNav && (
    <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setMobileNav(false)}>
      <aside className="fade-up flex h-full w-[260px] flex-col gap-1 bg-card p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center"><Logo /><IconButton label={t('Close')} className="ml-auto" onClick={() => setMobileNav(false)}><X className="size-4" /></IconButton></div>
        <NavItems />
      </aside>
    </div>
  );

  if (top) {
    return (
      <div className="min-h-full">
        {mobileBar}{mobileDrawer}
        <header className="sticky top-0 z-30 hidden border-b border-line bg-card/90 backdrop-blur md:block">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-6 py-2">
            <Logo />
            <nav className="scroll-thin ml-4 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"><NavItems /></nav>
            <ProfileSwitch compact />
            {tools}
            <AccountMenu compact />
          </div>
        </header>
        {pages}
      </div>
    );
  }

  return (
    <div className="flex min-h-full">
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-card md:flex transition-[width]', collapsed ? 'w-[68px]' : 'w-[236px]')}>
        <div className={cx('flex items-center px-4 pt-4 pb-3', collapsed && 'justify-center px-0')}>
          <Logo small={collapsed} />
          {!collapsed && <IconButton label={t('Collapse menu')} className="ml-auto" onClick={() => set({ navCollapsed: true })}><PanelLeftClose className="size-4" /></IconButton>}
        </div>
        <div className={cx('px-3 pb-2', collapsed && 'px-2')}><ProfileSwitch compact={collapsed} /></div>
        <nav className={cx('scroll-thin flex flex-1 flex-col gap-0.5 overflow-y-auto px-3', collapsed && 'px-2')}><NavItems collapsed={collapsed} /></nav>
        <div className={cx('flex items-center gap-0.5 border-t border-line p-2', collapsed && 'flex-col')}>
          {collapsed && <IconButton label={t('Expand menu')} onClick={() => set({ navCollapsed: false })}><PanelLeftOpen className="size-4" /></IconButton>}
          {tools}
        </div>
        <div className={cx('flex border-t border-line p-2', collapsed && 'justify-center')}><AccountMenu compact={collapsed} /></div>
      </aside>
      <div className="min-w-0 flex-1">
        {mobileBar}{mobileDrawer}
        {pages}
      </div>
    </div>
  );
}
