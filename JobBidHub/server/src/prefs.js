// Each account's extension settings = the shared defaults (admin's Settings page) + that account's own changes.
import * as db from './db.js';
import { PREF_KEYS, getUser, setPrefs } from './auth.js';

export const DEFAULT_PREFS = { useAI: true, learnAnswers: true, overwrite: false, showPanel: true, panelPush: true, showButton: true, promptLog: true, autoSubmit: false, chatgptWeb: 'off', aiTimeout: 5, panelSide: 'left' };

export function defaultPrefs() {
  const s = db.getStore('settings', {}) || {};
  return Object.fromEntries(PREF_KEYS.map((k) => [k, s[k] ?? DEFAULT_PREFS[k]]));
}

// What this account's extension uses.
export function effectivePrefs(user) {
  return { ...defaultPrefs(), ...(user?.prefs || {}) };
}

// Settings as one account's Chrome should see them.
export function settingsFor(user, settings) {
  return user ? { ...(settings || {}), ...effectivePrefs(user) } : settings;
}

// A Chrome uploaded its settings: changes to the personal ones go to that account (not the shared defaults),
// and the shared copy keeps the defaults. Returns the personal changes made.
export function takePrefsFromUpload(user, incomingSettings) {
  if (!user || !incomingSettings) return [];
  const before = effectivePrefs(user);
  const mine = { ...(user.prefs || {}) };
  const changed = [];
  for (const k of PREF_KEYS) {
    if (!(k in incomingSettings)) continue;
    if (JSON.stringify(incomingSettings[k]) !== JSON.stringify(before[k])) { mine[k] = incomingSettings[k]; changed.push(k); }
  }
  const defs = defaultPrefs();
  for (const k of PREF_KEYS) incomingSettings[k] = defs[k];
  if (changed.length) setPrefs(user.id, mine, defs);
  return changed;
}

export const freshUser = (id) => getUser(id);
