# Changelog

## 3.11.0 - 2026-11-10: JobBid Fit Estimate

Replaces the "Estimated ATS match" and the profile-based quick-fit card.

**Why:** the old score looked up the AI's long requirement phrases ("tested, reusable code", "model-performance measurement") word for word, so experience written differently counted as missing. Resume formatting (text boxes) took points from the fit score. The quick-fit card used a fixed list of about 200 skills and the profile, not the resume.

- **Job reading:** short standard requirement names, a type for each (required / preferred / nice-to-have skill, responsibility, domain, education, certification, soft skill), must-have flags, and the posting's own words as proof that is checked against the job text. Synonyms are merged; related tools are kept apart.
- **Evidence:** the resume file, the profile, or both (Evidence menu). The profile never stands in for the resume silently. Years come from dates and stated years per source, and a disagreement is shown with the source used.
- **AI evidence review:** Direct / Equivalent / Related / Not demonstrated / Contradiction for each requirement, with quotes, explanations and recommendations. Every judgment is checked against the evidence, and results are cached so the same inputs give the same score.
- **New score parts:** required skills 35, relevant work experience 20, responsibilities 15, industry 10, title & seniority 10, preferred skills 5, education 5. The weights can be changed, and parts that don't apply are dropped.
- **Readability** is a separate diagnostic.
- **Score changes are explained** by part, requirement, weights, evidence and method.
- **Rules-only fallback** when the AI is unavailable, always labelled.
- **Match tab redesign:** a Resume vs job table with expandable rows, "How to improve" built on real lines, and a readability check. The Job tab shows the estimate instead of the fixed-list skill match.
- **Optimizer:** uses the same judgments before and after a change, so scores compare. Skills the evidence shows in other words count as supported.
- **Tests:** `tests/fit.test.mjs` (58 checks) is new, alongside `ats.test.mjs` and `optimizer.ui.mjs`.

## 3.10.0 - 3.10.3

- **ATS matcher and resume optimizer:**
  - scores the real resume file;
  - checks each proposed edit for invented numbers, unconfirmed skills and locked lines;
  - edits Word files with new bullets in place;
  - edits PDFs in place, or rebuilds a clean ATS-friendly PDF;
  - reads the new file back and scores it again.
- Live step lists, a preview while the resume is written, and notifications.
- More robust job reading.
- Industry experience part, and stricter title matching.
