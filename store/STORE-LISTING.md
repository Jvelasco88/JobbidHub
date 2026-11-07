# Chrome Web Store listing: JobBid Autofill

Upload `JobBidHub/release/jobbid-extension-<version>.zip` (make it with `cd JobBidHub/server && npm run pack-store`).

## Steps

1. Sign up at https://chrome.google.com/webstore/devconsole (one-time USD 5 fee, with the Google account that will own the extension).
2. **New item** → upload the zip.
3. **Distribution → Visibility: Unlisted**. Only people with the link can install it, and it doesn't appear in search. Choose **Private** instead if every user is in your Google Workspace domain.
4. Fill in the fields below, add the privacy policy link, then **Submit for review**. The first review usually takes a few days.
5. Send the store link to the team. Each Chrome should then remove the "Load unpacked" copy (the store copy has a different ID) and sign in to the hub again.
6. For later versions: bump `version` in `manifest.json`, run `npm run pack-store`, upload the zip under **Package**, and submit. Chrome updates everyone by itself.

## Single purpose

Fills job application forms with the user's saved candidate profiles and tracks the applications sent.

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `<all_urls>`, content scripts on all sites | Job applications are on thousands of company career sites and job boards (Greenhouse, Lever, Workday, company sites). The form filler must run wherever the user opens an application. |
| `storage`, `unlimitedStorage` | Keeps the candidate profiles, resume files, saved answers and the application tracker on the user's computer. |
| `activeTab`, `tabs`, `scripting` | Fills the form in the tab the user is on, and opens the application page when the user presses Apply. |
| `alarms` | Syncs with the user's team server every few minutes and runs the work schedule. |
| `notifications` | Tells the user when a fill finished or needs their input. |
| `proxy`, `webRequest`, `webRequestAuthProvider` | Optional, set by the team admin: sends AI requests (or all traffic) through the team's proxy, and answers that proxy's login. |
| Hosts `generativelanguage.googleapis.com`, `ipwho.is`, `ipapi.co`, `api.ipify.org` | AI answers (with the user's own API key), and showing the user's public IP and country next to the candidate's location. |

**Remote code:** none. All code ships in the package. The team server only sends data (profiles, settings), never code.

## Data use answers (Privacy practices tab)

- **Collects:** personally identifiable information, resumes, and website content (the application form being filled).
- **Used for:** the extension's single purpose only. Not sold, not used for ads or credit decisions.
- **Sent to:** the user's own team server (address entered by the user), and the AI provider whose key the user entered.

## Description (short)

Fill job applications in one click from saved candidate profiles. Answers screening questions with AI, attaches the right resume, and logs every application.
