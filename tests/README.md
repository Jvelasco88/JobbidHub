# Form-filling tests

Runs the extension's real `content.js` on saved application forms in headless Chrome, presses Fill as the
fake candidate in `profile.json`, and checks every box. Run it before shipping any `content.js` change.

```
cd tests
npm install        # first time only
npm test           # all forms
npm test -- greenhouse    # only files whose name contains "greenhouse"
npm test -- --show        # watch it in a visible window
```

## Adding a form (do this for every site bug you fix)

1. Copy the form's HTML from the site, or from the hub's Problems page (each problem keeps the question's page code), into `fixtures/<site>-<what>.html`.
2. Where the site's own script matters (dropdowns, city search, a box that locks), add a small script. `fixtures/react-select.js` already behaves like react-select. Load it with `<script src="react-select.js"></script>`.
3. Add `<script type="application/json" id="expect">` with `checks` (and optionally `noProblems`):
   - `{ "sel": "#email", "value": "alex.rivera@example.com" }`: the box's value
   - `{ "sel": "input[name=auth]", "picked": "Yes" }`: the checked radio button
   - `{ "sel": "input[name=consent]", "checked": true }`: a checkbox
   - `{ "sel": ".select__single-value", "text": "Yes" }`: what a custom dropdown shows
   - `{ ..., "contains": "555" }`: the value only has to contain this
   - `"noProblems": ["Location (City)"]`: these questions must not be reported to the hub as problems
   - `"mustReport": ["Location (City)"]`: these questions must be reported (the filler could not answer them)
   - `"autoBid": "auto"` (or `"review"`) with `"bidStatus": "review"`: run Auto bid on the form instead of a plain Fill and check its result (`submitted`, `review`, `needs`...)
   - `<script type="application/json" id="profile">{ "customAnswers": {...} }</script>`: change the test candidate for this form only
4. Run `npm test`. The new form should fail before your fix and pass after it.

`profile.json` is made-up test data. Never put a real candidate's details in this folder (it goes into git).
