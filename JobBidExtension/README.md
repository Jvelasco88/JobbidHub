# JobBid Autofill (Chrome extension)

Fills job applications on any site from saved candidate profiles, attaches the right resume, answers unusual questions with Gemini, and tracks where each profile has applied.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `JobBidExtension` folder.
4. Pin the ⚡ icon to the toolbar. The settings page opens on first install.

After editing any file here, click the reload ↻ icon on the extension card.

## Set up

1. **Settings tab:** pick an AI provider, paste its key, click **Load models** and choose one, then **Test key** and **Save settings**.
   - **Groq** (recommended, free): key at https://console.groq.com/keys, model `llama-3.3-70b-versatile`.
   - **OpenRouter** (free models): key at https://openrouter.ai/keys, pick a model ending in `:free`.
   - **Gemini**: free tier isn't available in every country/project.
   - "403 Access denied / check your network settings" means the provider blocks your country or VPN, not a bad key: use a VPN (US/EU) or switch provider.
   - **xAI Grok**: paid credits only.
2. **Profiles tab:** use *Import from resume* and pick a resume. JobBid reads it with its built-in reader (no AI needed: name, contact, headline, location, summary, skills, jobs with dates, education, years of experience; works with two-column PDFs too) and the AI, when available, improves on it. Do this once per person.
3. To add more versions of the same person's resume (e.g. MarcusDG / MarcusDW / MarcusDZ / MarcusDice), open that profile and use **Add another resume version** instead of importing again. Put `dice.com` under *Use on sites* for the Dice version so it's picked automatically there.
   When a new resume is added to an existing profile, JobBid asks **"Check this resume with AI and fill the empty fields?"**. If yes, it reads the resume and lists only the blanks it can fill (missing links, salary, new skills, new jobs or schools, missing dates on existing jobs) with checkboxes; nothing already filled is changed. Each resume file also has a **Fill blanks** button to run this any time. Without an AI key only contact details and links are read.
4. Fill in what resumes don't contain: birthday, work authorization, sponsorship, relocation, salary, EEO answers. Click **Save**.

## Dashboard

Right-click the extension icon → *Options*, or the ⚙ in the popup:
- **Home**: setup checklist, today / week / total, interviews, 14-day chart, recent applications.
- **Profiles**: drop resumes to import (same person → added as another version), sectioned editor that saves automatically, completeness meter.
- **Applications**: search/filter, set status (Applied, Interview, Offer, Rejected, No reply), export CSV.
- **Schedule**: daily/weekly work blocks (who applies when, with a goal per block), today's timeline with progress, "Fill a sample week", Windows reminders and automatic profile switching when a block starts.
- **Daily log**: per-day report: applications vs goal, active working time (breaks over 45 min excluded), timeline, by profile / schedule block / site, notes, last-30-days table and CSV export. Click a day name in the Schedule week view to open it.
- **AI keys**: add as many keys as you like (any provider, several per provider), each with its own model. They work together: *Failover* uses the first live key and switches to the next instantly when one fails or hits a rate limit; *Rotate* spreads requests across all live keys. Every key shows Live / Dead / Not checked / Off with reply time and the last error; **Check all keys** tests them at once. Keys that just failed are tried last for 10 minutes. Status shows as a dot in the menu and "AI: 2/3 keys live" in the popup.
- **Theme**: Settings → Appearance → Light / Dark / System (follows Windows). Quick switch with the moon/sun button in the dashboard menu and the popup. Applies to the dashboard, popup, side panel and on-page notifications.
- **AI provider** and **Settings**: provider, key, model; autofill toggles; backup/restore.

## Side panel

On application forms a panel opens on the left: profile switcher, job card (with the JobBid Fit Estimate once it has been made), already-applied / schedule notices, Fill button, "N/M required fields filled" progress and a Required / Optional checklist (green = filled, purple = AI, red = required and empty). Click an item to jump to that field. Works with forms inside iframes. Collapse it with ‹; reopen from the tab on the left edge. Turn it off in Settings → Side panel (the floating Fill button is used instead).

## JobBid Fit Estimate (Match tab)

How well a candidate's evidence fits one job's own requirements, with the evidence for every point. It is JobBid's estimate, not the score an employer's ATS computes, and it is not calibrated to match any other product.

**Pipeline** (files: `ats.js` engine, `resumedoc.js` file reading, `background.js` atsScore / atsOptimize / atsBuild):

1. **Job reading (AI).** The AI lists the job's requirements as JSON: a short standard name per requirement, its type (required skill, preferred skill, nice to have, responsibility, industry / domain, education, certification, soft skill), whether it is a hard eligibility gate, exact equivalents (`LLM` = Large Language Models, `Postgres` = PostgreSQL), related-but-different skills, and the posting's own words as a quote. JavaScript keeps only requirements whose name, equivalent or quote is really in the posting, merges duplicates, and reads years and seniority separately. Cached per job text.
2. **Evidence (rules).** The resume file (PDF / Word, parsed into sections: summary, skills, experience, projects, education...), the profile, or both, as chosen in the **Evidence** menu. The profile is never used in place of the resume unless chosen. Years come from employment dates and from stated years ("9+ years"); when sources disagree, the Years row shows each figure and which one was used. Nothing is inferred beyond dates or statements.
3. **Evidence review (AI).** For each requirement the AI returns Direct match / Equivalent match / Related experience / Not demonstrated / Contradiction, the evidence line ids, a quote, an explanation and a recommendation. JavaScript checks every judgment: cited lines must exist and the quote must be in them (otherwise "Not demonstrated"); "Direct" without the words becomes "Equivalent"; a tool the job reading itself called related (TensorFlow for PyTorch) can never be "Equivalent"; recommendations with numbers the evidence lacks are dropped; exact words always count as a direct match. Requirements the AI skipped are judged by exact words, and say so. Cached per job + evidence, so the same inputs give the same score.
4. **Score (rules).** Credit per requirement: direct 1, equivalent 0.9, related 0.35, not demonstrated / contradiction 0; required 3×, preferred 1.5×, nice-to-have 0.75×, soft skills half. Default weights (configurable in the optimizer's Details → Scoring weights; starting defaults, not validated ATS weights): required skills 35, relevant work experience 20 (years asked vs. shown, and skills shown in actual jobs rather than only listed), responsibilities 15, industry / domain 10, job title & seniority 10 (the job's own title words; an AI look-alike title counts 70%), preferred skills 5, education & certifications 5. Parts the job doesn't ask about are left out and the rest scaled to 100. Bands: Strong ≥ 80, Good ≥ 65, Partial ≥ 45, Limited below. Must-have requirements that aren't met are shown as a warning, not extra points.
5. **Score changes** since the last analysis of the same job + resume + evidence are explained: which parts, which requirement judgments, weights, evidence source or method changed.

**Without the AI** (no key, all keys failing, a broken answer): requirements come from the posting's words, evidence is matched by exact words, and every view says **Rules only** with the reason. A rules-only result is never shown as AI-reviewed.

**Resume readability** is a separate diagnostic, not part of the fit score: readable text, standard headings, employment date format, contact details, page-header contact details, tables, text boxes, columns, length, repeated keywords. It names risks ("some ATS…"), never claims every ATS rejects a layout.

**The Match tab** shows the estimate and band, AI-reviewed or rules only, the evidence used, unmet must-haves, why the score changed, the score parts, a **Resume vs job** table (job title, years, industry, required skills, preferred skills, responsibilities, education, certifications, summary; tap a row for each requirement's status, quoted evidence, explanation and recommended improvement, gaps first by importance), **How to improve** (built only on lines the resume already has), and readability. **Optimize resume** opens the optimizer (choose sections and keywords, review each change, rebuild the file and score it again with the same judgments).

## Daily use

1. Open a job's application form.
2. Click the floating **⚡ JobBid Fill** button, press **Alt+Shift+F**, or use the popup (where you can also switch person/resume).
3. Check the highlighted fields:
   - green = filled from profile
   - purple = written by AI, read it carefully
   - red = required, couldn't fill, needs you
4. Submit the application yourself, then use **Log this application** in the popup. Next time you open that job, a yellow banner warns if a profile already applied.

Multi-step forms (Workday, LinkedIn Easy Apply, Indeed): click Fill again on each step.

## Supported field types

Text boxes, native dropdowns, typeahead comboboxes, radio buttons (including hidden radios with styled labels), ARIA radios, Yes/No button groups, custom "Select ▾" dropdowns built from divs (opened, read and closed automatically), multi-select icon groups such as country flags (read from alt text, title, flag emoji or image file names like us.svg), date inputs and resume uploads.

## How filling works

1. **Rules:** name, email, phone, links, address, birthday/birth year/age, education, authorization, sponsorship, EEO, etc. are matched by field label on any site.
2. **Saved answers:** every question answered once is remembered per profile: by the AI, or by you typing/picking an answer on the form (a "Remembered N answers" chip appears, with Undo). Next time the same question is filled instantly without the AI. Sensitive fields (SSN, bank, card, passwords, date of birth) and job-specific essays ("Why this company?") are never saved. Questions nobody could answer are added to *Saved answers* with an empty answer (and their dropdown choices), marked "to answer": answer them once there and they're filled next time. Edit them in the profile's *Saved answers*; turn off in Settings → Remember my answers.
3. **Profile corrections from the form:** if you change a field that comes from the profile (LinkedIn, phone, salary, sponsorship...), JobBid saves it to the profile right away when the profile was empty, or asks "Update ... in profile?" when it had a different value.
4. **AI:** remaining questions are sent with the profile and job description; it picks from dropdown options or writes short tailored answers.

## Known limits

- Checkboxes (terms, consent) are never ticked automatically.
- Repeating "add another job / school" sections (e.g. Workday My Experience) fill the first entry only; add the rest by hand or let the site parse the uploaded resume.
- Some custom dropdowns may not open programmatically; those fields stay unmarked or red.
- Free AI keys have per-minute/per-day limits. If you see a rate-limit message, wait a minute.
- Fully automated submitting is intentionally not included: LinkedIn, Indeed and others ban it and can suspend accounts.

## Using JobBid in another Chrome (data file)

1. In this Chrome: **Settings → Data & other Chromes → Create data file...** and save `jobbid-data.json`. To share between computers, save it inside a OneDrive / Google Drive / Dropbox folder.
2. JobBid saves every change to that file automatically (a few seconds after it happens, and whenever the dashboard or popup opens).
3. In the other Chrome (another profile, or another PC): load this extension folder (chrome://extensions → Load unpacked), open the dashboard → **Settings → Open existing data file...** and pick the same file. Everything loads: profiles, resume files, saved answers, applications, schedule, daily notes, settings and API keys.
4. Both Chromes keep syncing through the file. If both changed at the same time, the changes are merged (nothing is lost; for the same item, the Chrome that syncs last wins). Each Chrome keeps its own active profile.
5. After Chrome restarts it may ask for file permission again: the dashboard shows **Reconnect** (choose "Allow on every visit" to avoid this).

The data file contains API keys and resumes: keep it private.

## Data

Everything (profiles, resume files, history, API key) stays in Chrome's local extension storage on this computer. Only profile text, resume text and job descriptions are sent to the AI provider you chose; birthday and birth year are never sent to AI. Use **Settings → Export backup** to move data to another PC.
