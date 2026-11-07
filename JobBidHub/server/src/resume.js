// "Import from resume": the dashboard reads the file's text in the browser (PDF/Word) and sends it with a
// first reading made without AI. Here the AI (when available) improves that reading, then the resume
// either joins the same person's existing profile (filling only blank fields) or becomes a new profile.
import * as db from './db.js';
import { ai, hasAi } from './ai.js';
import { uid, nowIso } from './util.js';

const PROFILE_SCHEMA_HINT = `{
  "firstName": "", "lastName": "", "fullName": "", "email": "", "phone": "",
  "address": "", "city": "", "state": "", "zip": "", "country": "",
  "linkedin": "", "github": "", "website": "",
  "headline": "current professional title",
  "summary": "professional summary paragraph",
  "yearsExperience": "number as string, e.g. 10",
  "currentTitle": "", "currentCompany": "",
  "skills": ["skill1", "skill2"],
  "experience": [{ "title": "", "company": "", "location": "", "start": "MM/YYYY", "end": "MM/YYYY or Present", "description": "" }],
  "education": [{ "school": "", "degree": "", "field": "", "start": "MM/YYYY or YYYY if no month", "end": "MM/YYYY or YYYY if no month" }]
}`;

const withHttps = (v) => { v = String(v || '').trim(); return v && !/^https?:\/\//i.test(v) ? 'https://' + v.replace(/^\/+/, '') : v; };
const nonEmpty = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Contact details any resume shows, found without AI.
export function quickExtract(text) {
  const out = {};
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+\w/);
  if (email) out.email = email[0];
  const phone = text.match(/\+?\d[\d\s().-]{8,}\d/);
  if (phone) out.phone = phone[0].trim();
  const li = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w%-]+\/?/i);
  if (li) out.linkedin = withHttps(li[0]);
  const gh = text.match(/(https?:\/\/)?(www\.)?github\.com\/[\w-]+/i);
  if (gh) out.github = withHttps(gh[0]);
  const nameLine = text.split('\n').map((l) => l.trim()).find((l) => /^[A-Za-zÀ-ž'.-]+(\s+[A-Za-zÀ-ž'.-]+){1,3}$/.test(l));
  if (nameLine) {
    const parts = nameLine.split(/\s+/);
    Object.assign(out, { fullName: nameLine, firstName: parts[0], lastName: parts[parts.length - 1] });
  }
  return out;
}

async function aiRead(text) {
  const prompt = `Extract this resume into JSON matching exactly this shape (use "" for unknown values, never invent data):
${PROFILE_SCHEMA_HINT}
"address" is the street line only (house number and street, e.g. "123 Main St, Apt 4"); leave it "" when the resume shows only a city or region - that goes in city/state.
Keep each experience description to the key bullet points joined by newlines. Return only JSON.`;
  const profile = await ai(prompt + '\n\nRESUME:\n' + text.slice(0, 30000), { temperature: 0.1, timeoutMs: 120000 });
  for (const k of ['linkedin', 'github', 'website']) if (profile[k]) profile[k] = withHttps(profile[k]);
  return profile;
}

// Fill only what the profile doesn't have yet; never overwrite what the user typed.
function fillBlanks(p, info) {
  let n = 0;
  for (const [k, v] of Object.entries(nonEmpty(info))) {
    if (['id', 'label', 'resumes', 'customAnswers', 'answerOptions', 'criteria'].includes(k)) continue;
    const cur = p[k];
    const empty = cur == null || cur === '' || (Array.isArray(cur) && !cur.length);
    if (empty) { p[k] = v; n++; }
  }
  return n;
}

export async function importResume({ name, type, data, text, local = {}, useAI = true }, { profiles: visible } = {}) {
  if (!name || !data) throw Object.assign(new Error('Missing file'), { statusCode: 400 });
  text = String(text || '');
  if (text.trim().length < 50) throw Object.assign(new Error(`${name}: no readable text (scanned image?)`), { statusCode: 400 });
  const size = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

  let info = { ...quickExtract(text), ...nonEmpty(local) };
  let aiUsed = false, aiError = '';
  if (useAI && hasAi()) {
    try {
      info = { ...info, ...nonEmpty(await aiRead(text)) };
      aiUsed = true;
    } catch (e) {
      aiError = e.message;
    }
  }

  // Only profiles this account can see can be matched (another user's candidate is never touched).
  const profiles = visible || db.listProfiles();
  const match = profiles.find((p) => same(p.email, info.email) || same(p.fullName, info.fullName));
  const fileId = uid();
  const meta = { id: fileId, name, type: type || 'application/octet-stream', size, sites: '', addedAt: nowIso() };

  if (match) {
    const dup = (match.resumes || []).some((r) => r.name === name && r.size === size);
    if (!dup) {
      db.saveFile(fileId, data);
      match.resumes = [...(match.resumes || []), meta];
      if (!match.defaultResumeId) match.defaultResumeId = fileId;
    }
    const filled = fillBlanks(match, info);
    db.saveProfile(match);
    return { action: dup ? 'existing' : 'added', profileId: match.id, name: match.label || match.fullName, filled, aiUsed, aiError };
  }

  db.saveFile(fileId, data);
  const p = {
    ...info,
    id: uid(),
    label: info.fullName || name.replace(/\.[^.]+$/, ''),
    skills: Array.isArray(info.skills) ? info.skills : [],
    experience: Array.isArray(info.experience) ? info.experience : [],
    education: Array.isArray(info.education) ? info.education : [],
    resumes: [meta],
    defaultResumeId: fileId,
    customAnswers: {},
    answerOptions: {},
  };
  db.saveProfile(p);
  return { action: 'created', profileId: p.id, name: p.label, filled: 0, aiUsed, aiError };
}
