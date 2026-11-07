// Talks to the hub server (/api). Types mirror the extension's data shapes.
import { QueryClient, useQuery } from '@tanstack/react-query';

export type Resume = { id: string; name: string; type?: string; size?: number; sites?: string; addedAt?: string };
export type Criteria = {
  minScore?: number; titles?: string[]; mustHave?: string[]; dealBreakers?: string[]; excludeCompanies?: string[]; excludeTitleWords?: string[];
  workMode?: 'any' | 'remote' | 'hybrid' | 'onsite'; locations?: string[]; minSalary?: number; seniority?: string[]; maxAgeDays?: number;
  noClearance?: boolean; needsSponsorship?: 'auto' | boolean;
};
export type Profile = {
  id: string; label?: string; fullName?: string; firstName?: string; lastName?: string; email?: string; phone?: string;
  headline?: string; currentTitle?: string; currentCompany?: string; city?: string; state?: string; country?: string; zip?: string; address?: string;
  linkedin?: string; github?: string; website?: string; summary?: string; yearsExperience?: string; salaryExpectation?: string;
  skills?: string[]; experience?: any[]; education?: any[]; resumes?: Resume[]; defaultResumeId?: string;
  customAnswers?: Record<string, string>; answerOptions?: Record<string, string[]>; criteria?: Criteria; [k: string]: any;
};
export type Application = {
  id: string; date: string; profileId: string; profileName: string; title: string; company: string; url: string; key?: string;
  site?: string; notes?: string; status: string; jobId?: string; followUp?: string; contact?: string; salary?: string;
};
export type Score = { score: number; qualified: boolean; reasons: { ok: boolean; text: string }[]; matched: string[]; missing: string[]; seniority?: string; override?: string };
export type Job = {
  id: string; key: string; source: string; url: string; applyUrl?: string; title: string; company: string; location: string; remote: boolean;
  employmentType?: string; seniority?: string; salary?: string; salaryMin?: number; salaryMax?: number; description?: string; excerpt?: string;
  tags: string[]; postedAt?: string; foundAt: string; seenAt?: string; status: 'new' | 'saved' | 'hidden' | 'applied';
  searchIds: string[]; scores: Record<string, Score>; overrides: Record<string, string>; details: any;
  score?: number | null; qualified?: boolean | null; appliedBy?: Application[];
};
export type Search = {
  id: string; name: string; keywords: string[]; exclude: string[]; location: string; remote: 'any' | 'remote' | 'onsite'; maxAgeDays: number;
  sources: string[]; everyHours: number; enabled: boolean; profileId?: string; lastRun?: string; lastFound?: number; lastAdded?: number;
  lastErrors?: string[]; running?: boolean;
};
export type ScheduleBlock = { id: string; days: number[]; start: string; end: string; profileId: string; target?: number; task?: string };
export type Schedule = { blocks: ScheduleBlock[]; autoSwitch?: boolean; reminders?: boolean };
export type Bootstrap = {
  version: string; rev: string; profiles: Profile[]; settings: any; schedule: Schedule | null; hub: any; clients: any[];
  sources: Record<string, { name: string; remoteOnly: boolean; boards: boolean; needsKey: boolean; mayBlock?: boolean }>;
  starterBoards?: Record<string, string[]>;
  providers: Record<string, { defaultModel: string }>; modelCache: Record<string, { id: string; name?: string; free?: boolean }[]>;
};

export class ApiError extends Error { status = 0; }

// Session token (also kept as a cookie, but some browsers drop cookies). Stored per browser.
const TOKEN_KEY = 'jbhub.token';
let memToken = '';
export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || memToken; } catch { return memToken; } }
export function setToken(t: string) { memToken = t; try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode: memory only */ } }
// Links opened in a new tab (downloads) can't send headers, so they carry the token.
export const withToken = (url: string) => (getToken() ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}` : url);

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    const e = new ApiError('The JobBid Hub server is not running. Start it with start.bat.');
    e.status = 0;
    throw e;
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    // Session ended (signed out elsewhere, password changed, account disabled): back to the sign-in screen.
    if (res.status === 401 && !path.startsWith('/auth/')) { setToken(''); window.dispatchEvent(new Event('jb-signed-out')); }
    const e = new ApiError((data && data.error) || `Error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data as T;
}

export const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

// Shared queries.
export type User = { id: string; username: string; name: string; role: 'admin' | 'user'; disabled: boolean; pending?: boolean; profileIds?: string[]; email?: string; phone?: string; prefs?: Record<string, any>; note: string; createdAt: string; updatedAt: string;
  lastLogin: string; loginCount: number; passChangedAt: string; activeSessions?: number; lastSeen?: string };
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me').then((r) => r.user), retry: false, staleTime: 60_000,
  // While the server is down, keep checking so the page reconnects by itself.
  refetchInterval: (q) => ((q.state.error as any)?.status === 0 ? 4000 : false) });

export const useBoot = () => useQuery({ queryKey: ['boot'], queryFn: () => api<Bootstrap>('/bootstrap'), refetchInterval: 30_000 });
export const useApps = () => useQuery({ queryKey: ['apps'], queryFn: () => api<Application[]>('/applications'), refetchInterval: 30_000 });
export const useSearches = () => useQuery({ queryKey: ['searches'], queryFn: () => api<Search[]>('/searches'), refetchInterval: (q) => (q.state.data?.some((s) => s.running) ? 3000 : 30_000) });

export function refresh(...keys: string[]) {
  for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
}

export const profileName = (p?: Partial<Profile> | null) => p?.label || p?.fullName || [p?.firstName, p?.lastName].filter(Boolean).join(' ') || 'Unnamed profile';

export const fileToBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});
