import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, Users, PanelLeft, Wand2, Sparkles, Gauge, FileText, Bot, Briefcase, LifeBuoy, Search, ChevronDown, ArrowRight, Radar, ListChecks, CalendarClock, ShieldCheck, Globe2, MessageSquareText } from 'lucide-react';
import { usePrefs } from '../prefs';
import { Card, Input, PageHeader, cx } from '../components/ui';

type Item = { q: string; a: ReactNode; text: string };
type Topic = { id: string; title: string; icon: typeof Rocket; link?: { to: string; label: string }; items: Item[] };

// a() keeps a plain-text copy of every answer for the search box.
const a = (q: string, ...lines: string[]): Item => ({
  q,
  text: lines.join(' '),
  a: lines.length === 1 ? <p>{lines[0]}</p> : <ul className="list-disc space-y-1 pl-5">{lines.map((l) => <li key={l}>{l}</li>)}</ul>,
});

const TOPICS: Topic[] = [
  {
    id: 'start', title: 'Getting started', icon: Rocket, link: { to: '/profiles', label: 'Open Profiles' },
    items: [
      a('What do I need?',
        'JobBid Hub running on this computer (start.bat) - this dashboard.',
        'The JobBid Chrome extension: the puzzle button at the bottom of the menu downloads it, with install steps.',
        'At least one profile (a candidate with a resume).',
        'AI: an API key (AI keys page, admins) or the ChatGPT website mode (My account). Without AI, profiles and saved answers still fill forms.'),
      a('First steps in order',
        'Start the hub with start.bat and sign in here.',
        'Install the extension in Chrome and sign in to the hub from the JobBid panel (left edge of any page).',
        'Profiles > Import from resume: drop a PDF or Word resume - it becomes a filled-in profile with the file attached.',
        'Check the profile: work authorization, sponsorship, phone, address, salary and job criteria.',
        'Open any job posting: the JobBid panel shows the job, your match, and fills the application.'),
    ],
  },
  {
    id: 'profiles', title: 'Profiles and resumes', icon: Users, link: { to: '/profiles', label: 'Open Profiles' },
    items: [
      a('What is a profile?', 'One candidate: contact details, experience, education, skills, answers to common questions (authorization, sponsorship, gender, veteran...) and one or more resume files. The panel\'s top-left switch picks which profile applies.'),
      a('Several resumes on one profile',
        'Add more files on the profile. The default one is attached normally.',
        'Give a resume "sites" (for example greenhouse.io) to use it on those sites automatically.',
        'In the panel\'s Apply tab, the resume picker changes the file for the page you are on.'),
      a('Saved answers', 'Questions JobBid could not answer can be saved ("Save unanswered questions" in the panel). Answer them once on the Answers page and they fill automatically next time. AI answers are saved there too, so the same question never asks the AI twice.'),
    ],
  },
  {
    id: 'panel', title: 'The JobBid panel (on job sites)', icon: PanelLeft,
    items: [
      a('Where is it?', 'On every page, at the left edge. Click the JobBid button to open it; drag it to move it, and drag its inner edge to change the width. A red number on the button = required fields still empty; a green check = form complete.'),
      a('The tabs',
        'Job: the posting read from the page (title, company, location, salary, level, sponsorship). "Analyze with AI" reads it more carefully.',
        'Match: how well the profile fits this job, the ATS score and what to improve. "Score with AI" asks the AI for a second opinion.',
        'Apply: the form on this page - required and optional fields, the resume, AI answers, cover letter.',
        'Profile: which profile is applying and the network IP (warns when the IP country is not the profile\'s country).',
        'Auto: auto-apply this job, or the hub\'s auto-bid queue.'),
    ],
  },
  {
    id: 'fill', title: 'Filling applications', icon: Wand2,
    items: [
      a('How filling works',
        'Press "Fill application" in the panel (or Alt+Shift+F). On a job posting, JobBid presses Apply first.',
        'Fields are filled in this order: profile rules (name, email, phone, links, authorization...), your saved answers, then AI for what is left.',
        'Dropdowns pick the closest option: "Male" when "Man" is not there, "7 - 15 years" for 7 years, and so on.',
        'A separate country phone code box means the phone number goes in without +1.'),
      a('Field colours and marks', 'Filled from the profile, filled by AI (please review), or required but empty. The panel lists every required field; "go to next" jumps to the next empty one.'),
      a('Questions JobBid leaves for you', 'Questions that ask for your own words (motivation, "why this company") are marked "own words" and never sent to the AI. Fill them yourself.'),
      a('Submitting', 'JobBid never submits unless Full auto is on (Auto tab or Auto bid). Always check the form, especially AI answers, before you press Submit.'),
    ],
  },
  {
    id: 'ai', title: 'AI answers', icon: Sparkles, link: { to: '/account', label: 'Open My account' },
    items: [
      a('API key or ChatGPT website?',
        'API keys (AI keys page, admins): fast and reliable. Several keys are tried in turn when one fails.',
        'ChatGPT website (My account > ChatGPT website): no key needed - JobBid asks ChatGPT in a pinned background tab with the account signed in to Chrome. Slower (10-60 s per question). "Backup" uses it only when no key works; "Only" always uses it.'),
      a('How the ChatGPT website mode asks',
        'The profile and answering rules are sent once per chat, then only short questions.',
        'Every question says what kind of answer it needs (Yes/No, one of the listed options, a number, a short text...), and the reply goes straight into the field.',
        'Each question carries a reference code so its reply is never mixed up with another one.',
        'Keep the pinned ChatGPT tab open and signed in. A new chat starts by itself after about 60 answers.'),
      a('The AI answered "unknown" or something odd', 'Choice questions must choose one of the options, and unknown facts are left empty instead of being guessed. If an answer is wrong, fix the field and add the correct answer on the Answers page or in the profile - it wins over the AI next time.'),
    ],
  },
  {
    id: 'match', title: 'Match and ATS score', icon: Gauge,
    items: [
      a('What the numbers mean',
        'Overall match: skills 45%, experience level 35%, industry 10%, job title 10%.',
        'ATS score (0-10): how many of the job\'s keywords are written in the profile and resume, plus title and industry. Under 6.0 is often filtered out.',
        'Green keywords are in the profile; grey ones are missing.'),
      a('Why other sites show different numbers', 'Every site uses its own formula. The quick score is computed from the page and the profile; "Score with AI" asks the AI to judge like a recruiter and an ATS, which is closer to sites like Jobright. The AI score is remembered for that job and profile.'),
    ],
  },
  {
    id: 'fix', title: 'Fix resume for this job', icon: FileText,
    items: [
      a('What it does', 'The AI rewrites the words of your resume file for one job: the job\'s keywords, its required skills, a stronger summary and bullets. The fixed file is uploaded to that application only.'),
      a('Your style never changes',
        'Only letters change. Layout, fonts, sizes, spacing, colours and line positions stay exactly as in your file.',
        'Word (.docx): the new words go into the original text runs, so bold labels and italics stay.',
        'PDF: each changed line is redrawn in place with the file\'s own font. A part that would need more room, or a letter the PDF font does not contain, is kept as it was.',
        'Names, contact details, companies, job titles, dates, schools and degrees are never changed.'),
      a('How to use it',
        'On the application form: press "Fix resume for this job" (Apply or Match tab) and it goes straight into the resume box.',
        'On the job posting: press it, wait for "Fixed resume ready", then press the job\'s Apply button. The form gets the fixed file, also in a new tab.'),
      a('It is temporary', 'The fixed file is never saved in the hub or synced. It lives in Chrome\'s memory until it is in the upload box (at most 3 hours) and is gone when Chrome closes. Your original file is never touched.'),
      a('Why is the button grey?', 'The profile has no resume file (PDF or Word), or AI is not set up. Hover over the button to see which.'),
      a('Things to know', 'The AI may add skills from the job that your resume did not show. Read the fixed resume before an interview. Scanned or password-protected PDFs and old .doc files cannot be fixed.'),
    ],
  },
  {
    id: 'autobid', title: 'Auto bid', icon: Bot, link: { to: '/autobid', label: 'Open Auto bid' },
    items: [
      a('What it does', 'Takes Qualified jobs from the Job board (Greenhouse, Lever and Ashby), opens each one in Chrome, fills it as the chosen profile and lets the AI answer the rest.'),
      a('Review first or Full auto',
        'Review first: every form is filled and left open; you check it and press Submit.',
        'Full auto: JobBid submits by itself. Anything it is unsure about is marked "Needs you".'),
      a('Limits and pauses', 'Set applications per profile per day, a random pause between jobs, and "One profile per company" so two of your profiles never apply to the same company. Keep Chrome open and signed in to the hub (and to ChatGPT when you use the website mode).'),
      a('Other sites', 'For a job on any other site (Workday...), open it and use "Auto-apply this job" in the panel\'s Auto tab.'),
    ],
  },
  {
    id: 'track', title: 'Jobs, applications and your day', icon: Briefcase, link: { to: '/jobs', label: 'Open Job board' },
    items: [
      a('Job board and Job search', 'Job search pulls new postings from the boards you add. The Job board scores every job against your profiles ("Viewing as" at the top of the menu picks whose scores you see). Jobs opened in Chrome with the panel are added too.'),
      a('Applications', 'Every application logged by the extension (or with "Log application" in the panel) with its date, site and profile. Update the status: Applied, Interview, Offer, Rejected, No reply. The panel warns "You already applied before!" on a job you applied to.'),
      a('Schedule and Daily log', 'Schedule: working blocks per profile with a daily goal - the extension can switch profiles and remind you. Daily log: applications per day against the goal, active time, sites, and a note for the day.'),
    ],
  },
  {
    id: 'trouble', title: 'Troubleshooting', icon: LifeBuoy, link: { to: '/settings', label: 'Open Settings' },
    items: [
      a('"Server not reachable"', 'JobBid Hub is not running. Start it with start.bat; the dashboard reconnects by itself.'),
      a('The panel says "AI not working"', 'Add an API key (AI keys) or switch on the ChatGPT website mode (My account). "Every key failed" means the keys are wrong, out of credit or rate-limited - test them on the AI keys page.'),
      a('ChatGPT does not answer',
        'Open the pinned ChatGPT tab: it must be signed in, with no login, captcha or "limit reached" message.',
        'Do not type in that tab while JobBid is asking.',
        'If replies keep failing, close the tab - JobBid opens a fresh one.'),
      a('The resume was not attached', 'Some sites only accept files through their own upload button. Use the picker and "Attach" in the Apply tab, or the site\'s button.'),
      a('A field was filled wrong', 'Correct it on the page. To fix it for next time, change the profile or add the answer on the Answers page - saved answers win over the AI.'),
      a('The extension seems outdated', 'An update bar appears in the panel when the hub has a newer version. Use "Auto-update" there, or download the zip from the puzzle button and reload it in chrome://extensions.'),
      a('Reporting a problem', 'Use "Copy debug info" from the panel menu and paste it with a screenshot. It contains no personal data.'),
    ],
  },
];

// What the product does, for someone seeing JobBid for the first time.
const FEATURES: { icon: typeof Rocket; title: string; text: string; topic: string }[] = [
  { icon: Wand2, title: 'One-click applications', text: 'Fills job applications on any site - Greenhouse, Lever, Ashby, Workday and more - from a saved candidate profile: contact details, work history, links, authorization, dropdowns and Yes/No questions.', topic: 'fill' },
  { icon: Sparkles, title: 'AI answers screening questions', text: 'Questions the profile cannot answer are answered by AI one by one, in the exact format the form wants (Yes/No, one of the options, a number, a paragraph). Works with API keys or the ChatGPT website.', topic: 'ai' },
  { icon: FileText, title: 'Resume tailored to each job', text: 'Rewrites the resume\'s words with the job\'s keywords and uploads it to that application only - the original layout, fonts and colours stay exactly the same.', topic: 'fix' },
  { icon: Gauge, title: 'Match and ATS score', text: 'Shows how well a candidate fits a job (skills, experience, industry, title), the ATS keyword score, and what to improve before applying.', topic: 'match' },
  { icon: Bot, title: 'Auto bid', text: 'Applies to qualified jobs by itself: opens each job, fills it, lets AI answer the rest, then waits for review or submits - with daily limits, pauses and one profile per company.', topic: 'autobid' },
  { icon: Users, title: 'Many candidates, one team', text: 'Any number of profiles, each with several resumes. Import a PDF or Word resume and it becomes a filled-in profile. Team accounts with admin approval.', topic: 'profiles' },
  { icon: Radar, title: 'Job search and job board', text: 'Collects new postings from job boards and scores every job against every profile, so the best matches are on top.', topic: 'track' },
  { icon: ListChecks, title: 'Application tracker', text: 'Every application is logged with date, site and profile; statuses from Applied to Offer; a warning before applying twice to the same job.', topic: 'track' },
  { icon: MessageSquareText, title: 'Learns your answers', text: 'Answer a new question once and it fills automatically from then on. AI answers are remembered too, so the same question never costs a second AI call.', topic: 'profiles' },
  { icon: CalendarClock, title: 'Schedule and daily log', text: 'Working hours per profile with daily goals and reminders, and a daily report of applications, active time and sites.', topic: 'track' },
  { icon: Globe2, title: 'Location check', text: 'Shows the network IP and warns when its country does not match the candidate\'s country.', topic: 'panel' },
  { icon: ShieldCheck, title: 'Private by design', text: 'Runs on your own computer. Birth dates never go to the AI, API keys never reach job sites, and tailored resumes are never stored.', topic: 'start' },
];

export default function Help() {
  const { t } = usePrefs();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ start: true });
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => TOPICS.map((tp) => ({
    ...tp,
    items: words.length ? tp.items.filter((it) => words.every((w) => `${tp.title} ${it.q} ${it.text}`.toLowerCase().includes(w))) : tp.items,
  })).filter((tp) => tp.items.length), [q]);
  const goTo = (id: string) => {
    setQ('');
    setOpen((o) => ({ ...o, [id]: true }));
    setTimeout(() => document.getElementById('help-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="fade-up">
      <PageHeader title={t('Help')} sub={t('What JobBid does, and how to use it step by step.')}
        actions={<div className="relative w-[280px] max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search help')} className="!pl-8" />
        </div>} />

      {!words.length && (
        <Card className="mb-[var(--gap)]" title={t('What JobBid can do')} icon={<Rocket className="size-4" />}>
          <p className="-mt-1 mb-3 text-[13px] text-muted">{t('A dashboard for your team plus a Chrome extension that does the applying - from finding jobs to the submitted application.')}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((f) => (
              <button key={f.title} onClick={() => goTo(f.topic)}
                className="flex gap-3 rounded-[12px] border border-line bg-sunken/40 p-3 text-left transition hover:border-accent/40 hover:bg-accent/5">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent/10 text-accent"><f.icon className="size-[18px]" /></span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-ink">{f.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink2">{f.text}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-[var(--gap)] flex flex-wrap gap-1.5">
        {TOPICS.map((tp) => (
          <button key={tp.id} onClick={() => goTo(tp.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-[12.5px] font-semibold text-ink2 hover:bg-sunken hover:text-ink">
            <tp.icon className="size-3.5" />{tp.title}
          </button>
        ))}
      </div>

      {!shown.length && <Card><p className="py-8 text-center text-[13px] text-muted">{t('Nothing found for "{q}".', { q })}</p></Card>}

      <div className="flex flex-col gap-[var(--gap)]">
        {shown.map((tp) => {
          const isOpen = words.length > 0 || !!open[tp.id];
          return (
            <section key={tp.id} id={'help-' + tp.id} className="card scroll-mt-4">
              <button onClick={() => setOpen((o) => ({ ...o, [tp.id]: !isOpen }))} aria-expanded={isOpen}
                className="flex w-full items-center gap-2.5 px-[var(--pad)] py-[calc(var(--pad)-4px)] text-left">
                <span className="grid size-8 place-items-center rounded-[10px] bg-accent/10 text-accent"><tp.icon className="size-4" /></span>
                <h2 className="text-[15px] font-bold tracking-tight">{tp.title}</h2>
                <span className="ml-auto text-[12px] text-muted">{tp.items.length}</span>
                <ChevronDown className={cx('size-4 text-muted transition', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-4 border-t border-line px-[var(--pad)] py-[var(--pad)]">
                  {tp.items.map((it) => (
                    <div key={it.q} className="text-[13.5px] leading-relaxed text-ink2">
                      <h3 className="mb-1 text-[13.5px] font-bold text-ink">{it.q}</h3>
                      {it.a}
                    </div>
                  ))}
                  {tp.link && (
                    <Link to={tp.link.to} className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
                      {tp.link.label}<ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
