# JobBid Hub

A local database and web dashboard for the JobBid extension. Everything runs on your own computer, at http://localhost:4417.

## Start

Double-click **start.bat**. The first run installs and builds everything, which takes a few minutes. After that it starts in a few seconds and opens the dashboard.

**Sign in:** username `admin`. A new hub makes a random password on its first start. It is shown in the hub window and saved in `data/first-admin-password.txt`. Change it after the first sign-in (click your name at the bottom of the menu, then **Change password**), then delete that file. The dashboard warns anyone whose password is short or still the old default.

**Run in the background (recommended):** right-click `service/install-service.ps1` and choose **Run with PowerShell**. The hub then starts when you sign in to Windows, runs without a window, and restarts by itself after a crash. Logs are kept in `logs/` for 14 days. `service/restart-hub.ps1` restarts it, and `service/uninstall-service.ps1` goes back to start.bat.

**Accounts** (admins only, in the menu):
- Create accounts as **User** or **Admin**, edit them, and reset passwords.
- Disable or delete accounts, and sign someone out on every device.
- **Signed in now** shows who is online, with device and IP.
- **Login history** shows every sign-in attempt, including wrong passwords. After 5 wrong passwords, that username is locked for 10 minutes from that computer. After 20 wrong sign-ins from one address (any usernames), that address is locked for 10 minutes.

**Connect each Chrome:** click the JobBid icon in the toolbar, enter the hub address (`http://127.0.0.1:4417` on this PC, or the office-network address on other PCs), and sign in. Until a Chrome is signed in, the extension shows nothing. After sign-in it gets only that account's profiles. Signing out removes the account's data from that Chrome.

## What it does

| Page | |
|---|---|
| Home | Today's numbers, 14-day chart, goals per profile, best new matches, what needs attention |
| Job board | Every job found by searches or opened in Chrome. It shows a match % and Qualified / Disqualified for each profile, with reasons. Actions: Open & apply, Mark applied, Save, Hide, AI check, cover letter |
| Job search | Saved searches that run by themselves every few hours (see the sources below) |
| Applications | All applications from all profiles: table or board view, status, notes, CSV export |
| Profiles | The same fields as the extension, plus resume files and **Apply criteria** (target titles, must-have skills, deal-breakers, remote/location, salary, levels, clearance, visa) |
| Answers | Saved answers for form questions. Questions waiting for an answer are listed first |
| Schedule | Weekly blocks per profile with goals. The extension sends the reminders and switches profiles |
| AI keys | The same keys as the extension, with test, order and "take turns" |
| Settings | Theme, accent colour, density, side or top menu, language (EN / 한 / 中), import / backup |

### Job search sources

- **On by default:**
  - Remote OK and Jobicy
  - Company career pages on Greenhouse, Lever and Ashby. A starter list of more than 70 companies is used; edit it on the Job search page.
- **May be blocked on some networks:** Remotive, Himalayas and Arbeitnow.
- **Optional:** Adzuna, which needs a free key.

## How sync works

- The hub stores the same data as the extension: profiles, resume files, applications, saved answers, AI keys, schedule and settings.
- The extension syncs both ways every minute, and a few seconds after any change.
- If both sides changed, nothing is dropped: applications and saved answers from both sides are kept.
- Each Chrome keeps its own active profile.
- If the hub is off, the extension works exactly as before and catches up later.

## Files

- `data/jobbid.db` holds all your data in one SQLite file.
- `data/secret.key` unlocks the saved job-site and proxy passwords. Without it the hub will not start, so it never quietly loses them.
- `backups/` gets a checked copy of the database, the key and the settings every day, and the newest 14 are kept. Set a second folder off this PC (OneDrive, a USB disk) in **Settings → Backups**. To restore, follow `README.txt` inside a backup folder.
- `server/` is the API (Node.js + Fastify, with SQLite built into Node).
- `web/` is the dashboard (React + Tailwind).

## Before shipping an extension change

- Bump `version` in `JobBidExtension/manifest.json`.
- Run the form tests: `cd tests && npm test`. See `tests/README.md`.
- To publish on the Chrome Web Store, run `cd server && npm run pack-store` and follow `store/STORE-LISTING.md`.

## Development

```
cd server && npm run dev        # API with auto-reload on :4417
cd web && npm run dev           # dashboard with hot reload on :5173 (uses the API on :4417)
```
