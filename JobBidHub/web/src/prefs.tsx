// Look & feel preferences (theme, accent, density, menu position, language, views), kept in this browser.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DICT, type Lang } from './i18n';

export type Prefs = {
  theme: 'system' | 'light' | 'dark';
  accent: 'indigo' | 'blue' | 'teal' | 'green' | 'rose' | 'amber' | 'slate';
  density: 'comfortable' | 'compact';
  nav: 'side' | 'top';
  navCollapsed: boolean;
  lang: Lang;
  jobView: 'split' | 'cards' | 'table';
  profileId: string; // "viewing as" profile for scores on the job board ('' = best of all)
};

const DEFAULTS: Prefs = { theme: 'system', accent: 'blue', density: 'comfortable', nav: 'side', navCollapsed: false, lang: 'en', jobView: 'split', profileId: '' };
const KEY = 'jbhub.prefs';

function load(): Prefs {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
  // ?theme=dark&lang=ko&accent=teal in the address also works (handy for shared links / bookmarks).
  const q = Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => ['theme', 'lang', 'accent', 'density', 'nav'].includes(k)));
  return { ...DEFAULTS, ...saved, ...q } as Prefs;
}

type Ctx = { prefs: Prefs; set: (patch: Partial<Prefs>) => void; t: (s: string, vars?: Record<string, string | number>) => string };
const PrefsCtx = createContext<Ctx>(null as any);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);
  const set = (patch: Partial<Prefs>) => setPrefs((p) => {
    const next = { ...p, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: keep in memory */ }
    return next;
  });

  useEffect(() => {
    const html = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => html.classList.toggle('dark', prefs.theme === 'dark' || (prefs.theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    if (prefs.accent === 'indigo') delete html.dataset.accent; else html.dataset.accent = prefs.accent;
    html.dataset.density = prefs.density;
    html.lang = prefs.lang;
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme, prefs.accent, prefs.density, prefs.lang]);

  const t = (s: string, vars?: Record<string, string | number>) => {
    let out = (prefs.lang !== 'en' && DICT[prefs.lang]?.[s]) || s;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  };
  return <PrefsCtx.Provider value={{ prefs, set, t }}>{children}</PrefsCtx.Provider>;
}

export const usePrefs = () => useContext(PrefsCtx);
